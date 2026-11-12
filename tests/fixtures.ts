/**
 * A config for Layout tests, shaped to make the arithmetic legible.
 *
 * Font metrics come from the real vendored font via tests/harness.ts, so tests
 * assert relationships ("this must equal that advance width") rather than magic
 * pixel numbers that would rot if the font were ever re-vendored.
 */
import type { CardConfig } from '../src/types';

export const CARD = { width: 1000, height: 800 };

/** Each field typesets inside a box spanning x 100..900, centred on 500. */
export const BOX = { left: 100, right: 900, center: 500, half: 400 };

/** Font size used by the test slots; a round number keeps sums readable. */
export const SIZE = 40;

export function makeConfig(overrides: Partial<CardConfig> = {}): CardConfig {
  const base: CardConfig = {
    source: [960, 720],
    roi: { x: 0, y: 0, w: 960, h: 720 },
    card: [CARD.width, CARD.height],
    // the identity, so card space and photo space coincide
    homography: [1, 0, 0, 0, 1, 0, 0, 0, 1],
    ink: { colour: [25, 11, 10] },
    font: { family: 'CardFont', weight: 500 },
    lines: [
      slot('H', 'header', 100),
      slot('A', 'top', 300),
      slot('B', 'top', 400),
      slot('C', 'bottom', 600),
    ],
    fields: {
      // the box starts at the printed width and may grow to the card edges
      header: { center: BOX.center, half: BOX.half, min_x: 10, max_x: 990 },
      top: { center: BOX.center, half: BOX.half, min_x: 10, max_x: 990 },
      bottom: { center: BOX.center, half: BOX.half, min_x: 10, max_x: 990 },
    },
    marks: {
      '?': mark(20, 40, 10),
      '!': mark(10, 40, 4, 0.2),
      ':': {
        w: 10,
        h: 44,
        bottom: 6,
        size: SIZE,
        parts: [
          { svg: 'period', dx: 0, dy: 24, w: 10, h: 8, rot: 0 },
          { svg: 'period', dx: 0, dy: 0, w: 12, h: 10, rot: 0 },
        ],
      },
    },
  };
  return { ...base, ...overrides };
}

function slot(
  band: string,
  field: 'header' | 'top' | 'bottom',
  baseline: number,
) {
  return { band, field, baseline, size: SIZE, letter_space: 0, word_space: 1 };
}

function mark(w: number, h: number, bottom: number, pad?: number) {
  const m = {
    w,
    h,
    bottom,
    size: SIZE,
    parts: [{ svg: 'qmark', dx: 0, dy: 0, w, h, rot: 0 }],
    ...(pad === undefined ? {} : { pad }),
  };
  return m;
}
