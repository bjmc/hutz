/**
 * Test harness: a real 2D context backed by the vendored font.
 *
 * Layout is built on `measureText`, so a DOM mock is no use -- happy-dom
 * returns a null 2D context. `@napi-rs/canvas` rasterises the actual woff2 we
 * ship and returns real advance widths and kerning, deterministically.
 */
import { createCanvas, GlobalFonts } from '@napi-rs/canvas';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

let registered = false;

/** Register the shipped font once per process. */
export function useRealFont(): void {
  if (registered) return;
  const ok = GlobalFonts.registerFromPath(
    resolve(ROOT, 'assets/fonts/card-font.woff2'),
    'CardFont',
  );
  if (!ok) throw new Error('could not register assets/fonts/card-font.woff2');
  registered = true;
}

/** A canvas context that measures against the real font. */
export function realContext(
  width = 8,
  height = 8,
): CanvasRenderingContext2D {
  useRealFont();
  return createCanvas(width, height).getContext('2d') as unknown as
    CanvasRenderingContext2D;
}

/**
 * Advance width of `text` at `size`, straight from the font.
 *
 * Assertions use this rather than magic numbers, so they keep meaning if the
 * font is ever re-vendored: the test states the relationship, not the value.
 */
export function advance(
  text: string,
  size: number,
  weight = 500,
): number {
  const ctx = realContext();
  ctx.font = `${weight} ${size}px CardFont`;
  return ctx.measureText(text).width;
}
