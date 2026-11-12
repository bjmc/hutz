/**
 * Test harness: real canvases backed by the vendored font.
 *
 * Layout is built on `measureText`, so a DOM mock is no use -- happy-dom
 * returns a null 2D context. `@napi-rs/canvas` rasterises the actual woff2 we
 * ship, so layout and rendering both run against the real font.
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

/** A canvas that can be handed to Renderer in place of a DOM one. */
export function realCanvas(
  width: number,
  height: number,
): HTMLCanvasElement {
  useRealFont();
  return createCanvas(width, height) as unknown as HTMLCanvasElement;
}

/**
 * Teach the global scope to make canvases, which `Renderer` asks the document
 * for when it builds its offscreen ink layer.
 *
 * Installed lazily so the layout-only tests never depend on it.
 */
export function installDocumentShim(): void {
  const g = globalThis as unknown as { document?: unknown };
  if (g.document) return;
  g.document = {
    createElement(tag: string) {
      if (tag !== 'canvas') throw new Error(`unsupported element: ${tag}`);
      return realCanvas(1, 1);
    },
  };
}

/** Pixels with any alpha, i.e. how much of the layer was drawn on. */
export function inkedPixels(canvas: HTMLCanvasElement): number {
  const ctx = canvas.getContext('2d')!;
  const { width, height } = canvas;
  const d = ctx.getImageData(0, 0, width, height).data;
  let n = 0;
  for (let i = 3; i < d.length; i += 4) if (d[i]! > 0) n++;
  return n;
}

/**
 * Count pixels matching a predicate over RGBA, for observing *which* layer
 * painted where rather than exact geometry.
 */
export function countPixels(
  canvas: HTMLCanvasElement,
  test: (r: number, g: number, b: number, a: number) => boolean,
): number {
  const ctx = canvas.getContext('2d')!;
  const { width, height } = canvas;
  const d = ctx.getImageData(0, 0, width, height).data;
  let n = 0;
  for (let i = 0; i < d.length; i += 4) {
    if (test(d[i]!, d[i + 1]!, d[i + 2]!, d[i + 3]!)) n++;
  }
  return n;
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
