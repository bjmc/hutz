import { CONFIG } from './config';
import { markDataUri } from './marks';
import { Renderer } from './render';
import type { Assets, CardState } from './types';

const DEFAULTS: CardState = {
  header: 'LIONEL HUTZ',
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
  // the plate comes from the <img> in the markup, so the bundler inlines it
  const plate = el<HTMLImageElement>('plate');
  if (!plate.complete) {
    await new Promise<void>((resolve, reject) => {
      plate.addEventListener('load', () => resolve(), { once: true });
      plate.addEventListener('error', () => reject(new Error('plate failed')),
        { once: true });
    });
  }
  // the finger cut-out comes from <img> too, for the same reason
  const fingers = el<HTMLImageElement>('fingers');
  // keyed by SVG name: `:` and `;` both draw the period vector, and the four
  // dash-derived marks share one bar, so each asset is loaded exactly once
  const names = new Set(
    Object.values(CONFIG.marks).flatMap(m => m.parts.map(p => p.svg)),
  );
  const marks = new Map<string, HTMLImageElement[]>(
    await Promise.all(
      [...names].map(async (n): Promise<[string, HTMLImageElement[]]> =>
        [n, [await loadImage(markDataUri(n))]]),
    ),
  );
  return { plate, fingers, marks };
}

/** Encode state into the URL fragment so a link reproduces the meme. */
function writeHash(state: CardState): void {
  const params = new URLSearchParams({
    h: state.header,
    t: state.top,
    b: state.bottom,
  });
  history.replaceState(null, '', `#${params}`);
}

function readHash(): CardState {
  if (!location.hash.length) return DEFAULTS;
  const params = new URLSearchParams(location.hash.slice(1));
  const header = params.get('h');
  const top = params.get('t');
  const bottom = params.get('b');
  if (header === null && top === null && bottom === null) return DEFAULTS;
  return {
    header: header ?? '',
    top: top ?? '',
    bottom: bottom ?? '',
  };
}

async function main(): Promise<void> {
  const canvas = el<HTMLCanvasElement>('card');
  const headerInput = el<HTMLInputElement>('header');
  const topInput = el<HTMLInputElement>('top');
  const bottomInput = el<HTMLInputElement>('bottom');
  const hint = el<HTMLParagraphElement>('hint');
  const download = el<HTMLButtonElement>('download');
  const copy = el<HTMLButtonElement>('copy');
  const share = el<HTMLButtonElement>('share');

  await document.fonts.load(
    `${CONFIG.font.weight} 16px ${CONFIG.font.family}`,
  );
  await document.fonts.ready;

  const assets = await loadAssets();
  const renderer = new Renderer(canvas, CONFIG, assets);

  // Every field is clamped to what the card can hold, so text never shrinks
  // and never spills off the edge.
  const initial = readHash();
  const state: CardState = {
    header: renderer.clamp(initial.header, 'header'),
    top: renderer.clamp(initial.top, 'top'),
    bottom: renderer.clamp(initial.bottom, 'bottom'),
  };
  headerInput.value = state.header;
  topInput.value = state.top;
  bottomInput.value = state.bottom;

  const paint = (): void => {
    renderer.draw(state);
    writeHash(state);
  };

  const sync = (
    field: 'header' | 'top' | 'bottom',
    input: HTMLInputElement,
  ): void => {
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
  headerInput.addEventListener('input', () => sync('header', headerInput));

  download.addEventListener('click', async () => {
    const blob = await renderer.toBlob();
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = 'money-down.jpg';
    link.click();
    setTimeout(() => URL.revokeObjectURL(url), 2000);
    hint.textContent = 'Saved at 960×720.';
  });

  copy.addEventListener('click', async () => {
    try {
      // the clipboard only accepts PNG
      const blob = await renderer.toPngBlob();
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
      const file = new File([blob], 'money-down.jpg', { type: 'image/jpeg' });
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
