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
  const topInput = el<HTMLInputElement>('top');
  const bottomInput = el<HTMLInputElement>('bottom');
  const hint = el<HTMLParagraphElement>('hint');
  const download = el<HTMLButtonElement>('download');
  const copy = el<HTMLButtonElement>('copy');
  const share = el<HTMLButtonElement>('share');

  await document.fonts.load(`400 16px ${CONFIG.font.family}`);
  await document.fonts.ready;

  const assets = await loadAssets();
  const renderer = new Renderer(canvas, CONFIG, assets);

  // Both fields are clamped to what the card can hold, so text never shrinks
  // and never spills off the edge.
  const initial = readHash();
  const state: CardState = {
    top: renderer.clamp(initial.top, 'top'),
    bottom: renderer.clamp(initial.bottom, 'bottom'),
  };
  topInput.value = state.top;
  bottomInput.value = state.bottom;

  const paint = (): void => {
    renderer.draw(state);
    writeHash(state);
  };

  const sync = (field: 'top' | 'bottom', input: HTMLInputElement): void => {
    const raw = input.value;
    const upper = raw.toUpperCase().replace(/\s+/g, ' ');
    const clamped = renderer.clamp(upper, field);
    // a space the user just typed stays in the field, or they could never
    // reach the second word
    const shown = /\s$/.test(raw) ? `${clamped} ` : clamped;
    if (shown !== raw) {
      const caret = input.selectionStart;
      input.value = shown;
      if (caret !== null) {
        const at = Math.min(caret, shown.length);
        input.setSelectionRange(at, at);
      }
    }
    const atLimit = clamped !== upper.trim();
    state[field] = clamped;
    input.toggleAttribute('aria-invalid', atLimit);
    hint.textContent = atLimit
      ? 'That line is full — no more room on the card.'
      : '';
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
