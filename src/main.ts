import { CONFIG } from './config';
import { PLATE_URL } from './plate';
import { Renderer } from './render';
import type { Assets, CardState } from './types';

const DEFAULTS: CardState = {
  top: 'WORKS ON CONTINGENCY?',
  bottom: 'NO, MONEY DOWN!',
};

function el<T extends HTMLElement>(id: string): T {
  const node = document.getElementById(id);
  if (!node) throw new Error(`missing #${id}`);
  return node as T;
}

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.decoding = 'sync';
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error(`failed to load ${src}`));
    img.src = src;
  });
}

async function loadAssets(): Promise<Assets> {
  const plate = await loadImage(PLATE_URL);
  const marks = new Map(
    await Promise.all(
      CONFIG.marks.map(async m => [m.name, await loadImage(m.uri)] as const),
    ),
  );
  return { plate, marks };
}

/** Encode state into the URL fragment so a link reproduces the meme. */
function writeHash(state: CardState): void {
  const params = new URLSearchParams({ t: state.top, b: state.bottom });
  history.replaceState(null, '', `#${params}`);
}

function readHash(): CardState {
  if (!location.hash.length) return DEFAULTS;
  const params = new URLSearchParams(location.hash.slice(1));
  const top = params.get('t');
  const bottom = params.get('b');
  if (top === null && bottom === null) return DEFAULTS;
  return { top: top ?? '', bottom: bottom ?? '' };
}

async function main(): Promise<void> {
  const canvas = el<HTMLCanvasElement>('card');
  const topInput = el<HTMLTextAreaElement>('top');
  const bottomInput = el<HTMLTextAreaElement>('bottom');
  const hint = el<HTMLParagraphElement>('hint');
  const download = el<HTMLButtonElement>('download');
  const copy = el<HTMLButtonElement>('copy');
  const share = el<HTMLButtonElement>('share');

  await document.fonts.load(`400 16px ${CONFIG.font.family}`);
  await document.fonts.ready;

  const assets = await loadAssets();
  const renderer = new Renderer(canvas, CONFIG, assets);

  let state = readHash();
  topInput.value = state.top;
  bottomInput.value = state.bottom;

  const paint = (): void => {
    renderer.draw(state);
    writeHash(state);
  };

  // Text never shrinks to fit: the fields reject input that would overflow, so
  // every character keeps the card's measured size.
  const sync = (field: 'top' | 'bottom', input: HTMLTextAreaElement): void => {
    const candidate = { ...state, [field]: input.value };
    if (renderer.fits(candidate[field], field)) {
      state = candidate;
      input.removeAttribute('aria-invalid');
      hint.textContent = '';
    } else {
      input.value = state[field];
      input.setAttribute('aria-invalid', 'true');
      hint.textContent = 'That line is full — no more room on the card.';
    }
    paint();
  };

  topInput.addEventListener('input', () => sync('top', topInput));
  bottomInput.addEventListener('input', () => sync('bottom', bottomInput));

  download.addEventListener('click', async () => {
    const blob = await renderer.toBlob();
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = 'money-down.png';
    link.click();
    setTimeout(() => URL.revokeObjectURL(url), 2000);
    hint.textContent = 'Saved at 960×720.';
  });

  copy.addEventListener('click', async () => {
    try {
      const blob = await renderer.toBlob();
      await navigator.clipboard.write([
        new ClipboardItem({ 'image/png': blob }),
      ]);
      hint.textContent = 'Copied to clipboard.';
    } catch {
      hint.textContent = 'Clipboard blocked — use Download instead.';
    }
  });

  if (navigator.canShare) {
    share.hidden = false;
    share.addEventListener('click', async () => {
      const blob = await renderer.toBlob();
      const file = new File([blob], 'money-down.png', { type: 'image/png' });
      if (!navigator.canShare({ files: [file] })) {
        hint.textContent = 'This browser cannot share files.';
        return;
      }
      await navigator.share({ files: [file], title: 'Money down' });
    });
  }

  paint();
}

void main();
