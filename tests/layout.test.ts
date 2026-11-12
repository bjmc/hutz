import { beforeEach, describe, expect, test } from 'bun:test';

import { Layout } from '../src/layout';
import type { CardConfig } from '../src/types';
import { BOX, CARD, SIZE, makeConfig } from './fixtures';
import { advance, realContext } from './harness';

let cfg: CardConfig;
let layout: Layout;

beforeEach(() => {
  cfg = makeConfig();
  layout = new Layout(realContext(), cfg);
});

/** Total ink spanned by a placed line, in card pixels. */
function ink(line: { glyphs: { x: number }[] }): number {
  const xs = line.glyphs.map(g => g.x);
  return xs.length ? xs[xs.length - 1]! - xs[0]! : 0;
}

describe('Layout.build', () => {
  test('places one line for a short run', () => {
    expect(layout.build('HI', 'top')).toHaveLength(1);
  });

  test('returns nothing for empty or whitespace-only text', () => {
    expect(layout.build('', 'top')).toEqual([]);
    expect(layout.build('   ', 'top')).toEqual([]);
  });

  test('upper-cases its input', () => {
    const [line] = layout.build('hi there', 'top');
    expect(line!.glyphs.map(g => g.ch).join('')).toBe('HITHERE');
  });

  test('collapses runs of whitespace', () => {
    const spaced = layout.build('A    B', 'top');
    const tight = layout.build('A B', 'top');
    expect(ink(spaced[0]!)).toBe(ink(tight[0]!));
  });

  test('centres a run inside its field box', () => {
    const [line] = layout.build('HI', 'top');
    const left = line!.glyphs[0]!.x;
    const right = line!.glyphs.at(-1)!.x + advance('I', SIZE);
    // the box is centred on BOX.center, so the run straddles it
    expect(Math.abs((left + right) / 2 - BOX.center)).toBeLessThan(1);
  });

  test('uses each slot of a field in order', () => {
    // narrow the printed box so the run must wrap onto the second slot
    const narrow = makeConfig();
    narrow.fields.top = { center: BOX.center, half: 180, min_x: 10, max_x: 990 };
    const lines = new Layout(realContext(), narrow)
      .build('ALPHA BRAVO CHARLIE', 'top');
    expect(lines.length).toBeGreaterThan(1);
    // the first line sits on band A's baseline, the second on band B's
    expect(lines[0]!.baseline).toBe(300);
    expect(lines[1]!.baseline).toBe(400);
  });

  test('never drops words when wrapping', () => {
    const text = 'ALPHA BRAVO CHARLIE DELTA ECHO';
    const lines = layout.build(text, 'top');
    const placed = lines
      .flatMap(l => l.glyphs.map(g => g.ch))
      .join('');
    expect(placed).toBe(text.replace(/ /g, ''));
  });

  test('a single line field keeps everything on one line', () => {
    expect(layout.build('A B C', 'header')).toHaveLength(1);
  });
});

describe('Layout sizes', () => {
  test('reports the slot size on the placed line', () => {
    cfg = makeConfig();
    cfg.lines[1]!.size = 55;
    layout = new Layout(realContext(), cfg);
    expect(layout.build('HI', 'top')[0]!.size).toBe(55);
  });

  test('a larger size advances further', () => {
    const small = makeConfig();
    small.lines[1]!.size = 20;
    const large = makeConfig();
    large.lines[1]!.size = 60;
    const a = new Layout(realContext(), small).build('HI', 'top');
    const b = new Layout(realContext(), large).build('HI', 'top');
    expect(ink(b[0]!)).toBeGreaterThan(ink(a[0]!));
  });
});

describe('Layout spacing', () => {
  test('negative letter_space tightens the run', () => {
    const tight = makeConfig();
    tight.lines[1]!.letter_space = -0.1;
    const loose = makeConfig();
    loose.lines[1]!.letter_space = 0;
    const a = new Layout(realContext(), tight).build('HIJ', 'top');
    const b = new Layout(realContext(), loose).build('HIJ', 'top');
    expect(ink(a[0]!)).toBeLessThan(ink(b[0]!));
  });

  test('letter_space scales with size', () => {
    const wide = makeConfig();
    wide.lines[1]!.letter_space = 0.1;
    const narrow = makeConfig();
    narrow.lines[1]!.letter_space = 0.05;
    const a = new Layout(realContext(), wide).build('HIJ', 'top');
    const b = new Layout(realContext(), narrow).build('HIJ', 'top');
    expect(ink(a[0]!)).toBeGreaterThan(ink(b[0]!));
  });

  test('word_space widens a two-word run', () => {
    const wide = makeConfig();
    wide.lines[1]!.word_space = 2;
    const narrow = makeConfig();
    narrow.lines[1]!.word_space = 0.2;
    const a = new Layout(realContext(), wide).build('A B', 'top');
    const b = new Layout(realContext(), narrow).build('A B', 'top');
    expect(ink(a[0]!)).toBeGreaterThan(ink(b[0]!));
  });

  test('word_space of zero still separates the words', () => {
    const zero = makeConfig();
    zero.lines[1]!.word_space = 0;
    const [line] = new Layout(realContext(), zero).build('A B', 'top');
    // the two glyphs must not land on the same pen position
    expect(line!.glyphs[1]!.x).toBeGreaterThan(line!.glyphs[0]!.x);
  });
});

describe('Layout nudge', () => {
  test('shifts a line without changing its width', () => {
    const base = new Layout(realContext(), makeConfig()).build('HI', 'top')[0]!;
    const nudged = makeConfig();
    nudged.lines[1]!.nudge = -12;
    const moved = new Layout(realContext(), nudged).build('HI', 'top')[0]!;

    expect(moved.glyphs[0]!.x - base.glyphs[0]!.x).toBeCloseTo(-12, 6);
    expect(ink(moved)).toBeCloseTo(ink(base), 6);
  });

  test('shifts marks with their line', () => {
    const base = new Layout(realContext(), makeConfig()).build('HI?', 'top')[0]!;
    const nudged = makeConfig();
    nudged.lines[1]!.nudge = -8;
    const moved = new Layout(realContext(), nudged).build('HI?', 'top')[0]!;

    expect(moved.marks[0]!.x - base.marks[0]!.x).toBeCloseTo(-8, 6);
  });

  test('does not feed back into fitting', () => {
    // a nudge must not make the box grow: the rendered width is unaffected, so
    // the number of lines for a long run stays the same
    const plain = new Layout(realContext(), makeConfig());
    const nudged = makeConfig();
    nudged.lines[1]!.nudge = -40;
    nudged.lines[2]!.nudge = -40;
    const shifted = new Layout(realContext(), nudged);

    const text = 'ONE TWO THREE FOUR FIVE';
    expect(shifted.build(text, 'top').length)
      .toBe(plain.build(text, 'top').length);
  });
});

describe('Layout.fits and clamp', () => {
  test('accepts short text', () => {
    expect(layout.fits('HI', 'top')).toBe(true);
  });

  test('rejects a run too long for the field', () => {
    const long = 'WORD '.repeat(40).trim();
    expect(layout.fits(long, 'top')).toBe(false);
  });

  test('empty input always fits', () => {
    expect(layout.fits('', 'header')).toBe(true);
  });

  test('clamp shortens until the text fits', () => {
    const long = 'WORD '.repeat(40).trim();
    const out = layout.clamp(long, 'top');
    expect(out.length).toBeLessThan(long.length);
    expect(layout.fits(out, 'top')).toBe(true);
  });

  test('clamp leaves fitting text untouched', () => {
    expect(layout.clamp('HI', 'top')).toBe('HI');
  });

  test('clamp never splits mid-word when whole words fit', () => {
    const long = 'ALPHA BRAVO CHARLIE DELTA ECHO FOXTROT GOLF HOTEL';
    const out = layout.clamp(long, 'top');
    // every word in the result must be complete except possibly the last
    const words = out.split(' ');
    const whole = long.split(' ');
    for (const w of words.slice(0, -1)) expect(whole).toContain(w);
  });
});

describe('Layout marks', () => {
  test('a mark is placed where its character appears', () => {
    const [line] = layout.build('HI?', 'top');
    expect(line!.marks).toHaveLength(1);
    expect(line!.marks[0]!.mark).toBe(cfg.marks['?']!);
  });

  test('a mark swallows the space that follows it', () => {
    const spaced = layout.build('HI? THERE', 'top');
    const tight = layout.build('HI?THERE', 'top');
    expect(ink(spaced[0]!)).toBeCloseTo(ink(tight[0]!), 6);
  });

  test('a stacked mark places both parts', () => {
    const [line] = layout.build('HI:', 'top');
    expect(line!.marks).toHaveLength(1);
    expect(line!.marks[0]!.mark.parts).toHaveLength(2);
  });

  test('marks scale with the slot size', () => {
    const small = makeConfig();
    small.lines[1]!.size = 20;
    const large = makeConfig();
    large.lines[1]!.size = 80;
    const a = new Layout(realContext(), small).build('HI?', 'top')[0]!;
    const b = new Layout(realContext(), large).build('HI?', 'top')[0]!;
    expect(b.marks[0]!.w).toBeGreaterThan(a.marks[0]!.w);
  });
});

describe('Layout.measure', () => {
  test('reports one width per slot of the field', () => {
    expect(layout.measure('HI', 'top')).toHaveLength(2);
    expect(layout.measure('HI', 'header')).toHaveLength(1);
  });

  test('grows with the text', () => {
    const short = layout.measure('HI', 'web')[0] ?? 0;
    const long = layout.measure('HIHIHI', 'header')[0] ?? 0;
    expect(long).toBeGreaterThan(short);
  });
});

describe('Layout field growth', () => {
  test('a run that does not fit the printed box may grow', () => {
    // start the box narrow so growth is required
    const narrow = makeConfig();
    narrow.fields.top = { center: BOX.center, half: 120, min_x: 10, max_x: 990 };
    const l = new Layout(realContext(), narrow);
    // 120 half-width cannot hold this, but the full card can
    expect(l.build('ALPHA BRAVO', 'top').length).toBeGreaterThan(0);
  });

  test('nothing can exceed the card width', () => {
    for (const line of layout.build('ONE TWO THREE', 'top')) {
      for (const g of line.glyphs) {
        expect(g.x).toBeGreaterThanOrEqual(0);
        expect(g.x).toBeLessThanOrEqual(CARD.width);
      }
    }
  });
});
