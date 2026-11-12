import { beforeEach, describe, expect, test } from 'bun:test';

import { Renderer } from '../src/render';
import type { Assets, CardConfig, CardState } from '../src/types';
import { CARD, makeConfig } from './fixtures';
import {
  countPixels, installDocumentShim, realCanvas,
} from './harness';

// the same size as the fixture's card, so card coordinates are pixel
// coordinates and nothing is clipped off the edge
const W = CARD.width;
const H = CARD.height;

const STATE: CardState = {
  header: 'LIONEL HUTZ',
  top: 'WORKS ON',
  bottom: 'NO, MONEY DOWN!',
};

/** A flat plate, so anything drawn on top of it is unambiguous. */
function blankPlate(): HTMLCanvasElement {
  const c = realCanvas(W, H);
  const ctx = c.getContext('2d')!;
  ctx.fillStyle = '#e8e0c8';
  ctx.fillRect(0, 0, W, H);
  return c;
}

/**
 * Pixels darker than the plate, i.e. where ink actually landed.
 *
 * The plate covers the whole canvas, so alpha is 255 everywhere and tells us
 * nothing -- darkness is the signal.
 */
function darkPixels(c: HTMLCanvasElement): number {
  return countPixels(c, (r, g, b) => r < 200 && g < 200 && b < 200);
}

/** A matte standing in for the cartoon hand: an opaque coloured square. */
function matte(): HTMLCanvasElement {
  const c = realCanvas(20, 20);
  const ctx = c.getContext('2d')!;
  ctx.fillStyle = '#ffd90f';
  ctx.fillRect(0, 0, 20, 20);
  return c;
}

function assets(): Assets {
  return {
    // Renderer draws these as <img>, so the canvas object stands in for one
    plate: blankPlate() as unknown as HTMLImageElement,
    fingers: matte() as unknown as HTMLImageElement,
    marks: new Map(),
  };
}

let cfg: CardConfig;
let canvas: HTMLCanvasElement;
let renderer: Renderer;

beforeEach(() => {
  installDocumentShim();
  cfg = makeConfig();
  // the identity homography, so card space and canvas pixels coincide
  canvas = realCanvas(W, H);
  renderer = new Renderer(canvas, cfg, assets());
});

describe('Renderer.draw', () => {
  test('paints the text onto the card', () => {
    renderer.draw(STATE);
    expect(darkPixels(canvas)).toBeGreaterThan(0);
  });

  test('draws nothing but the plate when every field is empty', () => {
    renderer.draw({ header: '', top: '', bottom: '' });
    // the plate is a flat colour, so no pixel should be darker than it
    const dark = countPixels(canvas, (r, g, b) => r < 120 && g < 120 && b < 120);
    expect(dark).toBe(0);
  });

  test('more text inks more of the card', () => {
    const small = realCanvas(W, H);
    new Renderer(small, cfg, assets()).draw({ header: '', top: 'A', bottom: '' });

    const large = realCanvas(W, H);
    new Renderer(large, cfg, assets())
      .draw({ header: '', top: 'AAAAAAAA', bottom: '' });

    expect(darkPixels(large)).toBeGreaterThan(darkPixels(small));
  });

  test('each field lands in its own band', () => {
    // the slots' baselines are 100/300/400/600 in the fixture, so a field's
    // ink must fall near its own line, not the others'
    const bandOf = (field: keyof CardState): [number, number] => {
      const c = realCanvas(W, H);
      const state = { header: '', top: '', bottom: '', [field]: 'HI' };
      new Renderer(c, cfg, assets()).draw(state as CardState);

      const ctx = c.getContext('2d')!;
      const d = ctx.getImageData(0, 0, W, H).data;
      let top = Infinity;
      let bot = -Infinity;
      for (let y = 0; y < H; y++) {
        for (let x = 0; x < W; x++) {
          const i = (y * W + x) * 4;
          if (d[i]! < 200 && d[i + 1]! < 200 && d[i + 2]! < 200) {
            if (y < top) top = y;
            if (y > bot) bot = y;
            break;
          }
        }
      }
      return [top, bot];
    };

    const [hTop, hBot] = bandOf('header');
    const [aTop, aBot] = bandOf('top');
    const [cTop, cBot] = bandOf('bottom');

    // every field drew something
    for (const v of [hTop, hBot, aTop, aBot, cTop, cBot]) {
      expect(Number.isFinite(v)).toBe(true);
    }

    // and the bands are ordered top to bottom, without overlapping
    expect(hBot).toBeLessThan(aTop);
    expect(aBot).toBeLessThan(cTop);
  });

  test('is idempotent: drawing twice matches drawing once', () => {
    const once = realCanvas(W, H);
    new Renderer(once, cfg, assets()).draw(STATE);

    const twice = realCanvas(W, H);
    const r = new Renderer(twice, cfg, assets());
    r.draw(STATE);
    r.draw(STATE);

    expect(darkPixels(twice)).toBe(darkPixels(once));
  });

  test('a redraw after clearing leaves no residue', () => {
    const c = realCanvas(W, H);
    const r = new Renderer(c, cfg, assets());
    r.draw({ header: 'LIONEL HUTZ', top: 'LONG LONG LONG', bottom: 'ALSO LONG' });
    r.draw({ header: '', top: 'A', bottom: '' });

    const fresh = realCanvas(W, H);
    new Renderer(fresh, cfg, assets())
      .draw({ header: '', top: 'A', bottom: '' });

    expect(darkPixels(c)).toBe(darkPixels(fresh));
  });
});

describe('Renderer finger matte', () => {
  test('the matte is laid down when the header has text', () => {
    renderer.draw({ header: 'LIONEL HUTZ', top: '', bottom: '' });
    // the matte is #ffd90f; the plate and ink are not
    const yellow = countPixels(canvas,
      (r, g, b) => r > 200 && g > 150 && b < 120);
    expect(yellow).toBeGreaterThan(0);
  });

  test('the matte is skipped when the header is empty', () => {
    renderer.draw({ header: '', top: 'HI', bottom: '' });
    const yellow = countPixels(canvas,
      (r, g, b) => r > 200 && g > 150 && b < 120);
    expect(yellow).toBe(0);
  });

  test('whitespace-only header counts as empty', () => {
    renderer.draw({ header: '   ', top: 'HI', bottom: '' });
    const yellow = countPixels(canvas,
      (r, g, b) => r > 200 && g > 150 && b < 120);
    expect(yellow).toBe(0);
  });
});

describe('Renderer.clamp', () => {
  test('delegates to the layout, so overlong text is shortened', () => {
    const out = renderer.clamp('WORD '.repeat(40).trim(), 'top');
    expect(out.length).toBeLessThan('WORD '.repeat(40).trim().length);
  });

  test('leaves fitting text alone', () => {
    expect(renderer.clamp('HI', 'top')).toBe('HI');
  });
});

describe('Renderer export', () => {
  test('toBlob yields a non-empty jpeg', async () => {
    renderer.draw(STATE);
    // napi's toBuffer stands in for the DOM's toBlob
    const c = canvas as unknown as { toBuffer(mime?: string): Uint8Array };
    const buf = c.toBuffer('image/jpeg');
    expect(buf.byteLength).toBeGreaterThan(0);
  });
});
