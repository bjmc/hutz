/**
 * Render the card to a JPEG outside the browser, so `just compare` measures
 * the current code rather than whatever was last downloaded by hand.
 *
 * Uses the same @napi-rs/canvas backend as the tests: it rasterises the real
 * vendored woff2, so the output is directly comparable to the printed scan.
 */
import { writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import type { Canvas } from "@napi-rs/canvas";
import {
  installDocumentShim,
  loadCardAssets,
  loadMarks,
  realCanvas,
} from "../tests/harness";
import { CONFIG, DEFAULTS } from "../src/config";
import { Renderer } from "../src/render";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const OUT = resolve(ROOT, process.argv[2] ?? "preview/money-down.jpg");

async function main(): Promise<void> {
  installDocumentShim();
  const assets = { ...(await loadCardAssets()), marks: await loadMarks() };
  const canvas = realCanvas(960, 720);
  const renderer = new Renderer(canvas, CONFIG, assets);
  renderer.draw(DEFAULTS);

  // napi's canvas owns the JPEG encoder; the browser path uses toBlob instead
  const encoded = (canvas as unknown as Canvas).toBuffer("image/jpeg", 95);
  writeFileSync(OUT, encoded);
  console.log(`wrote ${OUT}`);
}

void main();
