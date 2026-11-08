/**
 * The traced punctuation vectors, imported as text and inlined once.
 *
 * `src/config.ts` refers to these by filename so the vector lives in
 * `assets/punct` only; a shape reused by several marks (the period appears in
 * `.`, `:` and `;`) is still bundled a single time.
 */
import bang from '../assets/punct/bang.svg' with { type: 'text' };
import dash from '../assets/punct/dash.svg' with { type: 'text' };
import comma from '../assets/punct/comma.svg' with { type: 'text' };
import period from '../assets/punct/period.svg' with { type: 'text' };
import qmark from '../assets/punct/qmark.svg' with { type: 'text' };

const SOURCES: Record<string, string> = { bang, comma, dash, period, qmark };

/** Data URI for a traced mark, so the canvas can draw it as an image. */
export function markDataUri(name: string): string {
  const svg = SOURCES[name];
  if (svg === undefined) throw new Error(`unknown mark vector: ${name}`);
  // btoa needs latin-1; the traced SVGs are pure ASCII
  return `data:image/svg+xml;base64,${btoa(svg)}`;
}
