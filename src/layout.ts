import type {
  CardConfig,
  Field,
  LineSlot,
  Mark,
  PlacedGlyph,
  PlacedLine,
  PlacedMark,
} from "./types";

interface GlyphItem {
  kind: "glyph";
  ch: string;
  advance: number;
  /** Horizontal shift applied before drawing, from the font's kerning pair. */
  kern: number;
  left: number;
  right: number;
}

interface SpaceItem {
  kind: "space";
  advance: number;
}

interface MarkItem {
  kind: "mark";
  mark: Mark;
  advance: number;
  /** Offset from the pen to the mark's left edge, centring it in its advance. */
  shift: number;
  w: number;
  h: number;
  /** Baseline to the mark's bottom edge, scaled to the run's cap. */
  drop: number;
}

type Item = GlyphItem | SpaceItem | MarkItem;

/**
 * A placed line plus the ink extents the fitter needs.
 *
 * The extents are scratch data for deciding whether a run fits; they never
 * reach the renderer, so they are kept out of `PlacedLine`.
 */
interface FittedLine extends PlacedLine {
  /** Leftmost ink of the letters, in card space. */
  left: number;
  /** Rightmost ink of the letters, in card space. */
  right: number;
  /** Rightmost ink including marks hanging past the last letter. */
  markRight: number;
}

/** A field's typesetting box: lines are centred on `center` within [x0, x1]. */
interface Box {
  x0: number;
  x1: number;
}

/**
 * How a slot's spacing and size have been relaxed to fit more text.
 *
 * Together these are one point on the fit axis. They are kept separate rather
 * than collapsed into one "pack" figure because word spaces are wide next to
 * the font's own gap, so they are the cheapest thing to give up and must be
 * spent before letter tracking is touched.
 */
interface Stage {
  box: Box;
  /** 0 = printed word space, 1 = the narrowest allowed by `fit`. */
  words: number;
  /** 0 = printed tracking, 1 = the tightest allowed by `fit`. */
  letters: number;
  /** 1 = printed size, `fit.min_scale` = the smallest allowed. */
  scale: number;
}

/** A wrapped field, and the stage that produced it. */
interface Fitted {
  lines: string[];
  overflow: boolean;
  stage: Stage;
}

/** The end of the fit axis: every measure fully spent. */
const MAX_PROGRESS = 4;

const MARK_GAP = 0.06; // of size, between the last letter and its edit mark

function clamp01(v: number): number {
  return v < 0 ? 0 : v > 1 ? 1 : v;
}

export class Layout {
  /**
   * Glyph metrics, keyed by size and character.
   *
   * The fitter rebuilds a run nine or ten times per call, at several type
   * sizes, so without this the same handful of characters is measured hundreds
   * of times for a single keystroke. `measureText` is the dominant cost, and
   * the answer never varies for a given size and character.
   *
   * Sizes are exact doubles, and the bisection visits the same ones on every
   * call, so this stays small and hits repeatedly.
   */
  private metrics = new Map<string, { advance: number; left: number; right: number }>();

  /** Kerning adjustments, keyed by size and the pair as drawn. */
  private kerns = new Map<string, number>();

  constructor(
    private ctx: CanvasRenderingContext2D,
    private cfg: CardConfig,
  ) { }

  private fontAt(size: number): void {
    this.ctx.font = `${this.cfg.font.weight} ${size}px ${this.cfg.font.family}`;
  }

  /** Advance and ink bounds of one character, measured at most once per size. */
  private glyph(size: number, ch: string): {
    advance: number; left: number; right: number;
  } {
    const key = `${size}|${ch}`;
    const hit = this.metrics.get(key);
    if (hit) return hit;
    this.fontAt(size);
    const m = this.ctx.measureText(ch);
    const out = {
      advance: m.width,
      left: -m.actualBoundingBoxLeft,
      right: m.actualBoundingBoxRight,
    };
    this.metrics.set(key, out);
    return out;
  }

  /** Kern adjustment for a pair, so the font's own spacing is preserved. */
  private kern(size: number, prev: string, ch: string): number {
    const key = `${size}|${prev}${ch}`;
    const hit = this.kerns.get(key);
    if (hit !== undefined) return hit;
    this.fontAt(size);
    const k = this.ctx.measureText(prev + ch).width -
      this.glyph(size, prev).advance -
      this.glyph(size, ch).advance;
    this.kerns.set(key, k);
    return k;
  }

  /** The card only ever holds capitals with single spaces between words. */
  private normalise(raw: string): string {
    return raw.toUpperCase().replace(/\s+/g, " ").trim();
  }

  private items(text: string, size: number, wordSpace: number): Item[] {
    this.fontAt(size);
    const out: Item[] = [];
    let swallowSpace = false;
    // the immediately preceding letter, when nothing separates the two: that is
    // the only case where the font's kerning pair applies
    let prev: string | null = null;

    for (const ch of text) {
      if (swallowSpace && ch === " ") continue;
      swallowSpace = false;

      const mark = this.cfg.marks[ch];
      if (mark) {
        const scale = size / mark.size;
        const w = mark.w * scale;
        const pad = (MARK_GAP + (mark.pad ?? 0)) * size;
        out.push({
          kind: "mark",
          mark,
          advance: w + pad,
          shift: pad / 2,
          w,
          h: mark.h * scale,
          drop: mark.bottom * scale,
        });
        swallowSpace = true;
        prev = null;
        continue;
      }

      if (ch === " ") {
        out.push({ kind: "space", advance: wordSpace * size });
        prev = null;
        continue;
      }

      // The font's kern pair moves this glyph relative to where the previous
      // advance would land it, so it has to be carried on the glyph itself;
      // folding it into the previous advance would gap the wrong side.
      const m = this.glyph(size, ch);
      const kern = prev === null ? 0 : this.kern(size, prev, ch);
      prev = ch;

      out.push({
        kind: "glyph",
        ch,
        advance: m.advance,
        kern,
        left: m.left,
        right: m.right,
      });
    }
    return out;
  }

  /**
   * Walk a run, reporting where each item lands.
   *
   * Glyphs carry their own kern, applied before the item's pen position, so
   * the two callers below (measuring a span, and placing items) agree by
   * construction rather than by keeping two loops in step. Returns the pen
   * position just past the run.
   */
  private walk(
    items: Item[],
    track: number,
    visit: (item: Item, pen: number) => void,
  ): number {
    let pen = 0;
    if (items.length === 0) return 0;
    for (let i = 0; i < items.length; i++) {
      const it = items[i]!;
      // kerns accumulate down the run, exactly as the shaper would place them
      if (it.kind === "glyph") pen += it.kern;
      visit(it, pen);
      pen += it.advance + track;
    }
    // the loop has already added the last item's advance and tracking
    return pen - track;
  }

  /**
   * Ink span of a run, measured over the letters only.
   *
   * Red marks are edits the writer squeezed in afterwards; a trailing mark
   * hangs past the last letter instead of widening the justified run.
   */
  private span(items: Item[], track: number): number {
    let first = 0;
    let last = 0;
    let seen = false;

    this.walk(items, track, (it, pen) => {
      if (it.kind !== "glyph") return;
      if (!seen) {
        first = pen + it.left;
        seen = true;
      }
      last = pen + it.right;
    });
    return seen ? last - first : 0;
  }

  /** Per-glyph letter spacing in px at a given font size. */
  private trackFor(size: number, letterSpace: number): number {
    return letterSpace * size;
  }

  /** Index just past the last glyph; items beyond it are trailing edit marks. */
  private lastGlyphIndex(items: Item[]): number {
    let last = -1;
    for (let i = 0; i < items.length; i++) {
      if (items[i]!.kind === "glyph") last = i;
    }
    return last;
  }

  private place(text: string, slot: LineSlot, box: Box): FittedLine {
    const all = this.items(text, slot.size, slot.word_space);
    const track = this.trackFor(slot.size, slot.letter_space);

    // trailing marks hang past the text, so they take no part in centring
    const lastGlyph = this.lastGlyphIndex(all);
    const body = lastGlyph >= 0 ? all.slice(0, lastGlyph + 1) : all;
    const tail = lastGlyph >= 0 ? all.slice(lastGlyph + 1) : [];

    // centre the run's ink in the box, advancing by the font's own metrics
    const natural = this.span(body, track);
    const lead = body[0];
    const offset = lead !== undefined && lead.kind === "glyph" ? lead.left : 0;
    // centre the run's ink in the field's box, then apply this line's nudge:
    // the box is shared so wrapped lines reflow together, the nudge is not
    const start =
      (box.x0 + box.x1) / 2 - natural / 2 - offset + (slot.nudge ?? 0);

    const glyphs: PlacedGlyph[] = [];
    const marks: PlacedMark[] = [];
    let inkLeft = Infinity;
    let inkRight = -Infinity;
    let markRight = -Infinity;
    const push = (it: Item, pen: number): void => {
      if (it.kind === "glyph") {
        glyphs.push({ ch: it.ch, x: pen });
        inkLeft = Math.min(inkLeft, pen + it.left);
        inkRight = Math.max(inkRight, pen + it.right);
      }
      if (it.kind === "mark") {
        marks.push({
          mark: it.mark,
          x: pen + it.shift,
          y: slot.baseline + it.drop - it.h,
          w: it.w,
        });
        markRight = Math.max(markRight, pen + it.shift + it.w);
      }
    };

    // the body runs on the tracked grid; a trailing mark then sits just past
    // the last glyph's advance, its own advance already carrying the gap
    const bodyEnd = this.walk(body, track, (it, pen) => push(it, start + pen));
    this.walk(tail, 0, (it, pen) => push(it, start + bodyEnd + pen));

    const glyphRight = Number.isFinite(inkRight) ? inkRight : start;
    return {
      glyphs,
      marks,
      size: slot.size,
      baseline: slot.baseline,
      left: Number.isFinite(inkLeft) ? inkLeft : start,
      right: glyphRight,
      markRight: Number.isFinite(markRight) ? markRight : glyphRight,
    };
  }

  private slots(field: Field) {
    return this.cfg.lines.filter((l) => l.field === field);
  }

  /** Debug hook: natural width of a run before any centring. */
  measure(raw: string, field: Field): number[] {
    const slots = this.slots(field);
    const text = this.normalise(raw);
    return slots.map((s) =>
      this.span(
        this.items(text, s.size, s.word_space),
        this.trackFor(s.size, s.letter_space),
      ),
    );
  }

  /**
   * Fit `words` by spending the cheapest measures first.
   *
   * The measures are laid end to end on one axis, `p` in [0, 4]:
   *
   *   0..1  widen the justification box towards the card's edges
   *   1..2  narrow the word spaces towards `fit.word_space`
   *   2..3  tighten letter tracking towards `fit.letter_space`
   *   3..4  shrink the type towards `fit.min_scale`
   *
   * Each measure only starts once the previous one is exhausted, so the result
   * is always the least distorted typesetting that still holds the text. Word
   * spaces go before letter tracking because they are far wider than the font's
   * own gap, so closing them costs legibility far more slowly than crushing the
   * letters together would.
   *
   * Every measure is continuous in `p`, which is what lets one bisection find
   * the answer: the smallest `p` that fits is the least distortion available,
   * and no measure ever makes the text *less* likely to fit as `p` grows.
   *
   * Returns `overflow` when even `p = 4` cannot hold the text.
   */
  private fit(words: string[], field: Field): Fitted {
    const base = this.at(field, 0);
    const first = this.wrapAt(words, field, base);
    if (!first.overflow) return first;

    const full = this.at(field, MAX_PROGRESS);
    const last = this.wrapAt(words, field, full);
    if (last.overflow) return last;

    let lo = 0;
    let hi = MAX_PROGRESS;
    for (let n = 0; n < 14; n++) {
      const mid = (lo + hi) / 2;
      const attempt = this.wrapAt(words, field, this.at(field, mid));
      if (attempt.overflow) {
        lo = mid;
      } else {
        hi = mid;
      }
    }
    return this.wrapAt(words, field, this.at(field, hi));
  }

  /** The field's typesetting at progress `p` along the measure axis. */
  private at(field: Field, p: number): Stage {
    const { min_scale } = this.cfg.fit;
    return {
      box: this.boxAt(field, clamp01(p)),
      words: clamp01(p - 1),
      letters: clamp01(p - 2),
      scale: p <= 3 ? 1 : 1 + clamp01(p - 3) * (min_scale - 1),
    };
  }

  /** The field's box at growth `t`: 0 = original, 1 = the printed card. */
  private boxAt(field: Field, t: number): Box {
    const f = this.cfg.fields[field];
    const x0 = f.center - f.half;
    const x1 = f.center + f.half;
    return {
      x0: x0 + t * (f.min_x - x0),
      x1: x1 + t * (f.max_x - x1),
    };
  }

  /**
   * A printed slot with this stage's packing and size folded in.
   *
   * The means are interpolated from the printed values towards their limits,
   * so `pack = 0`, `scale = 1` reproduces the card exactly.
   */
  private slotAt(slot: LineSlot, stage: Stage): LineSlot {
    const { letter_space, word_space } = this.cfg.fit;
    const { words, letters, scale } = stage;
    return {
      ...slot,
      size: slot.size * scale,
      letter_space:
        slot.letter_space + letters * (letter_space - slot.letter_space),
      word_space: slot.word_space + words * (word_space - slot.word_space),
      // the nudge is measured in card pixels at printed size, so it shrinks
      // with the type rather than pushing the line progressively off-centre
      nudge: (slot.nudge ?? 0) * scale,
    };
  }

  private wrapAt(words: string[], field: Field, stage: Stage): Fitted {
    const slots = this.slots(field);
    const lines: string[] = [];
    let i = 0;

    for (let s = 0; s < slots.length && i < words.length; s++) {
      const slot = this.slotAt(slots[s]!, stage);

      // a single word that cannot fit on its own line is an overflow, not a
      // line: greedy wrapping would otherwise admit it and spill off the card
      if (!this.fitsRun(words[i]!, slot, stage.box)) {
        return { lines, overflow: true, stage };
      }

      let j = i + 1;
      while (j < words.length) {
        const candidate = words.slice(i, j + 1).join(" ");
        if (!this.fitsRun(candidate, slot, stage.box)) break;
        j++;
      }
      lines.push(words.slice(i, j).join(" "));
      i = j;
    }

    return { lines, overflow: i < words.length, stage };
  }

  /**
   * Whether a run stays inside the box once centred in it.
   *
   * Only the letters are held to the box: a mark is an edit squeezed in after
   * the line was written, so it may hang past the last letter. It still has to
   * fall inside the printed card, which is what `max_x` records.
   */
  private fitsRun(text: string, slot: LineSlot, box: Box): boolean {
    // the nudge is a cosmetic shift applied after fitting; if it took part in
    // this test the box would grow to accommodate it, which would then move
    // the centred run back the other way
    const placed = this.place(text, { ...slot, nudge: 0 }, box);
    const card = this.cfg.fields[slot.field];
    return (
      placed.left >= box.x0 - 1 &&
      placed.right <= box.x1 + 1 &&
      placed.markRight <= card.max_x + 1
    );
  }

  /** True when `raw` fits its field. The UI rejects input if not. */
  fits(raw: string, field: Field): boolean {
    const text = this.normalise(raw);
    if (!text) return true;
    if (!this.slots(field).length) return false;
    return !this.fit(text.split(" "), field).overflow;
  }

  /**
   * Longest prefix of `raw` that still fits, so typing simply stops.
   *
   * Whole words are admitted first; a partially typed word is then extended
   * character by character. That way a long run of letters cannot spill off
   * the card even though it has no spaces to wrap on.
   */
  clamp(raw: string, field: Field): string {
    const text = this.normalise(raw);
    if (this.fits(text, field)) return text;

    const words = text.split(" ");
    let best = "";
    let taken = "";

    for (const word of words) {
      const candidate = taken ? `${taken} ${word}` : word;
      if (this.fits(candidate, field)) {
        taken = candidate;
        best = candidate;
        continue;
      }
      // this word does not fit whole: keep as much of it as the card allows
      for (let i = 1; i <= word.length; i++) {
        const partial = taken
          ? `${taken} ${word.slice(0, i)}`
          : word.slice(0, i);
        if (this.fits(partial, field)) best = partial;
        else break;
      }
      break;
    }
    return best;
  }

  /** Lay out one field's text, squeezing it only as far as it must. */
  build(raw: string, field: Field): PlacedLine[] {
    const slots = this.slots(field);
    if (!slots.length) return [];

    const text = this.normalise(raw);
    if (!text) return [];

    const { lines, stage } = this.fit(text.split(" "), field);

    return lines.map((line, k) => {
      const slot = this.slotAt(slots[Math.min(k, slots.length - 1)]!, stage);
      return this.place(line, slot, stage.box);
    });
  }
}
