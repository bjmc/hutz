/**
 * Loading the card's pictures, and the small DOM helpers around it.
 *
 * The plate and the hand matte come from `<img>` elements in the markup rather
 * than from JavaScript, because the bundler inlines assets referenced from
 * HTML into the single-file build. The mark vectors are imported as text and
 * turned into data URIs, so nothing is fetched at runtime.
 */
import { CONFIG } from './config';
import { markDataUri } from './marks';
import type { Assets } from './types';

/** The element with this id, or a clear failure if the markup is wrong. */
export function el<T extends HTMLElement>(id: string): T {
  const node = document.getElementById(id);
  if (!node) throw new Error(`missing #${id}`);
  return node as T;
}

/** Wait for the app's webfont, so text is measured with the real metrics. */
export async function loadFont(): Promise<void> {
  await document.fonts.load(
    `${CONFIG.font.weight} 16px ${CONFIG.font.family}`,
  );
  await document.fonts.ready;
}

/** Load an image, rejecting rather than leaving a half-initialised element. */
function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.decoding = 'sync';
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error(`failed to load ${src}`));
    img.src = src;
  });
}

/** An `<img>` already in the document, once it has decoded. */
async function inlinedImage(id: string): Promise<HTMLImageElement> {
  const img = el<HTMLImageElement>(id);
  if (img.complete) return img;
  await new Promise<void>((resolve, reject) => {
    img.addEventListener('load', () => resolve(), { once: true });
    img.addEventListener('error', () => reject(new Error(`${id} failed`)),
      { once: true });
  });
  return img;
}

export async function loadAssets(): Promise<Assets> {
  const [plate, fingers] = await Promise.all([
    inlinedImage('plate'),
    inlinedImage('fingers'),
  ]);

  // keyed by SVG name: `:` and `;` both draw the period vector, and the four
  // dash-derived marks share one bar, so each vector is loaded exactly once
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
