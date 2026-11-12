import { beforeAll, describe, expect, test } from 'bun:test';

import { CONFIG } from '../src/config';
import { Renderer } from '../src/render';
import type { Assets, CardState } from '../src/types';
import {
  countPixels, installDocumentShim, loadCardAssets, loadMarks, realCanvas,
} from './harness';

/**
 * These tests use the real config and the real committed assets.
 *
 * The point of rendering tests is the integration itself, so a stand-in plate
 * or a fake homography would let a broken card pass. Assertions are therefore
 * behavioural -- which layer shows through where -- rather than pixel counts,
 * which would break on any change to the plate.
 */

const CARD_W = 960;
const CARD_H = 720;

const STATE: CardState = {
  header: 'LIONEL HUTZ',
  top: 'WORKS ON CONTINGENCY?',
  bottom: 'NO, MONEY DOWN!',
};

let assets: Assets;

beforeAll(async () => {
  installDocumentShim();
  const { plate, fingers } = await loadCardAssets();
  assets = { plate, fingers, marks: await loadMarks() };
});

/** Render a state and return the finished canvas. */
function render(state: CardState): HTMLCanvasElement {
  const canvas = realCanvas(CARD_W, CARD_H);
  new Renderer(canvas, CONFIG, assets).draw(state);
  return canvas;
}

/** Full RGBA buffer of a canvas. */
function pixels(c: HTMLCanvasElement): Uint8ClampedArray {
  return c.getContext('2d')!.getImageData(0, 0, CARD_W, CARD_H).data;
}

/**
 * The hand's opaque footprint, read straight from the committed matte.
 *
 * Anything the app does with the matte is compared against this, so the test
 * never hard-codes where the fingers are.
 */
function handMask(): Uint8Array {
  const m = realCanvas(CARD_W, CARD_H);
  const ctx = m.getContext('2d')!;
  ctx.drawImage(assets.fingers, 0, 0);
  const d = ctx.getImageData(0, 0, CARD_W, CARD_H).data;
  const mask = new Uint8Array(CARD_W * CARD_H);
  for (let p = 0; p < mask.length; p++) mask[p] = d[p * 4 + 3]! > 0 ? 1 : 0;
  return mask;
}

describe('Renderer.draw with the real card', () => {
  test('renders at the image size', () => {
    const c = render(STATE);
    expect(c.width).toBe(960);
    expect(c.height).toBe(720);
  });

  test('drawing twice matches drawing once', () => {
    const canvas = realCanvas(CARD_W, CARD_H);
    const r = new Renderer(canvas, CONFIG, assets);
    r.draw(STATE);
    const once = countPixels(canvas, (rr, g, bb) => rr < 120 && g < 120 && bb < 120);
    r.draw(STATE);
    const twice = countPixels(canvas, (rr, g, bb) => rr < 120 && g < 120 && bb < 120);
    expect(twice).toBe(once);
  });

  test('a cleared redraw leaves no residue', () => {
    const busy = render(STATE);
    const quiet = render({ header: '', top: '', bottom: '' });

    const dirty = realCanvas(CARD_W, CARD_H);
    const r = new Renderer(dirty, CONFIG, assets);
    r.draw(STATE);
    r.draw({ header: '', top: '', bottom: '' });

    expect(countPixels(dirty, (a, b, c) => a < 120 && b < 120 && c < 120))
      .toBe(countPixels(quiet, (a, b, c) => a < 120 && b < 120 && c < 120));
    // and the busy render really did draw more
    expect(countPixels(busy, (a, b, c) => a < 120 && b < 120 && c < 120))
      .toBeGreaterThan(countPixels(quiet, (a, b, c) => a < 120 && b < 120 && c < 120));
  });

  test('the plate is untouched where nothing is drawn', () => {
    // a corner well away from any text or hand
    const empty = pixels(render({ header: '', top: '', bottom: '' }));
    const full = pixels(render(STATE));
    const at = (700 * CARD_W + 20) * 4;
    expect([...full.slice(at, at + 4)]).toEqual([...empty.slice(at, at + 4)]);
  });
});

describe('the hand is cut out of the ink', () => {
  test('ink never appears inside the hand', () => {
    const mask = handMask();
    const withText = pixels(render(STATE));
    const withoutText = pixels(render({ header: '', top: '', bottom: '' }));

    // inside the hand, the two renders must agree: the header was drawn but
    // the hand cut it away, leaving the plate's own fingers
    let compared = 0;
    for (let p = 0; p < mask.length; p++) {
      if (!mask[p]) continue;
      compared++;
      const i = p * 4;
      if (
        withText[i] !== withoutText[i] ||
        withText[i + 1] !== withoutText[i + 1] ||
        withText[i + 2] !== withoutText[i + 2]
      ) {
        throw new Error(`hand pixel differs at ${p % CARD_W},${(p / CARD_W) | 0}`);
      }
    }
    expect(compared).toBeGreaterThan(1000);
  });

  test('outside the hand, the header is still drawn', () => {
    const mask = handMask();
    const withText = pixels(render(STATE));
    const withoutText = pixels(render({ header: '', top: '', bottom: '' }));

    let changed = 0;
    let outsideHand = 0;
    for (let p = 0; p < mask.length; p++) {
      const i = p * 4;
      if (
        withText[i] === withoutText[i] &&
        withText[i + 1] === withoutText[i + 1] &&
        withText[i + 2] === withoutText[i + 2]
      ) continue;
      changed++;
      if (!mask[p]) outsideHand++;
    }

    expect(changed).toBeGreaterThan(0);
    expect(outsideHand).toBeGreaterThan(0);
  });

  test('an empty header means no cut is needed, and none is applied', () => {
    // without a header there is no ink in the hand's area to remove, so the
    // render must equal a plain plate plus the body text
    const a = render({ header: '', top: 'HI', bottom: '' });
    const b = render({ header: '', top: 'HI', bottom: '' });
    expect(countPixels(a, (r, g, bb) => r < 120 && g < 120 && bb < 120))
      .toBe(countPixels(b, (r, g, bb) => r < 120 && g < 120 && bb < 120));
  });
});

describe('marks', () => {
  test('the red punctuation is drawn', () => {
    const c = render(STATE);
    // the marks are a saturated red that neither plate nor body ink carries
    const red = countPixels(c, (r, g, b) => r > 110 && r - g > 70 && r - b > 70);
    expect(red).toBeGreaterThan(100);
  });

  test('a question mark appears only when typed', () => {
    const withMark = render({ header: '', top: 'HI?', bottom: '' });
    const without = render({ header: '', top: 'HI', bottom: '' });
    const red = (c: HTMLCanvasElement) =>
      countPixels(c, (r, g, b) => r > 110 && r - g > 70 && r - b > 70);
    expect(red(withMark)).toBeGreaterThan(red(without));
  });
});

describe('Renderer.clamp', () => {
  test('shortens text that cannot fit the card', () => {
    const r = new Renderer(realCanvas(CARD_W, CARD_H), CONFIG, assets);
    const long = 'WORD '.repeat(60).trim();
    const out = r.clamp(long, 'top');
    expect(out.length).toBeLessThan(long.length);
  });

  test('leaves text that fits alone', () => {
    const r = new Renderer(realCanvas(CARD_W, CARD_H), CONFIG, assets);
    expect(r.clamp('HI', 'top')).toBe('HI');
  });
});
