#!/usr/bin/env bun
/**
 * Build the self-contained HTML page.
 *
 * Bun's standalone-HTML mode bundles the TS entry, the CSS, and the font into
 * `index.html` in one pass, so this only has to supply the plate as a data URI
 * (it is loaded via `define`, not referenced from the markup).
 */
import { resolve } from 'node:path';

const ROOT = resolve(import.meta.dir, '..');

const built = await Bun.build({
  entrypoints: [resolve(ROOT, 'index.html')],
  compile: true,
  target: 'browser',
  minify: true,
});

if (!built.success) {
  for (const log of built.logs) console.error(log);
  process.exit(1);
}

const html = await built.outputs[0]!.text();

// a standalone page must not point at anything on disk
const stray = html.match(/(?:src|href)="(?!data:|#)[^"]+"/g);
if (stray) {
  console.error('standalone build still references external files:');
  for (const s of stray) console.error('  ' + s);
  process.exit(1);
}

await Bun.write(resolve(ROOT, 'dist/index.html'), html);
console.log(`dist/index.html  ${(html.length / 1024).toFixed(0)} KB`);
