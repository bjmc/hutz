import type { CardConfig, Mark } from './types';

interface GlyphItem {
  kind: 'glyph';
  ch: string;
  advance: number;
  left: number;
  right: number;
}

interface SpaceItem {
  kind: 'space';
  advance: number;
}

interface MarkItem {
  kind: 'mark';
  mark: Mark;
  advance: number;
  w: number;
  h: number;
  dy: number;
}

type Item = GlyphItem | SpaceItem | MarkItem;

export interface PlacedGlyph {
  ch: string;
  x: number;
}

export interface PlacedMark {
  mark: Mark;
  x: number;
  top: number;
  w: number;
  h: number;
}

export interface PlacedLine {
  field: 'top' | 'bottom';
  glyphs: PlacedGlyph[];
  marks: PlacedMark[];
  size: number;
  baseline: number;
  /** Leftmost ink of the letters, in card space. */
  left: number;
  /** Rightmost ink of the letters, in card space. */
  right: number;
  /** Rightmost ink including the marks that hang past the last letter. */
  markRight: number;
}

/** A field's typesetting box: lines are centred on `center` within [x0, x1]. */
interface Box {
  x0: number;
  x1: number;
}

const MARK_GAP = 0.06;      // of cap, between the last letter and its edit mark
const PROBE = 1000;         // font size used to read the font's own metrics

export class Layout {
  private byChar = new Map<string, Mark>();
  private ratio: number | null = null;

  constructor(
    private ctx: CanvasRenderingContext2D,
    private cfg: CardConfig,
  ) {
    for (const m of cfg.marks) this.byChar.set(m.char, m);
  }

  private fontAt(size: number): void {
    this.ctx.font = `${size}px ${this.cfg.font.family}`;
  }

  /** Cap height as a fraction of font size, read from the loaded font. */
  private capRatio(): number {
    if (this.ratio !== null) return this.ratio;
    this.fontAt(PROBE);
    const m = this.ctx.measureText('H');
    const ratio = (m.actualBoundingBoxAscent + m.actualBoundingBoxDescent) / PROBE;
    this.ratio = ratio > 0 ? ratio : this.cfg.font.cap_ratio;
    return this.ratio;
  }

  private sizeFor(cap: number): number {
    return cap / this.capRatio();
  }

  private items(text: string, cap: number): Item[] {
    this.fontAt(this.sizeFor(cap));
    const out: Item[] = [];
    let swallowSpace = false;

    for (const ch of text) {
      if (swallowSpace && ch === ' ') continue;
      swallowSpace = false;

      const mark = this.byChar.get(ch);
      if (mark) {
        const scale = cap / mark.cap;
        const w = mark.w * scale;
        out.push({
          kind: 'mark',
          mark,
          advance: w + MARK_GAP * cap,
          w,
          h: mark.h * scale,
          dy: mark.dy * scale,
        });
        swallowSpace = true;
        continue;
      }

      if (ch === ' ') {
        out.push({ kind: 'space', advance: this.cfg.font.word_space * cap });
        continue;
      }

      const m = this.ctx.measureText(ch);
      out.push({
        kind: 'glyph',
        ch,
        advance: m.width,
        left: -m.actualBoundingBoxLeft,
        right: m.actualBoundingBoxRight,
      });
    }
    return out;
  }

  /**
   * Ink span of a run, measured over the letters only.
   *
   * Red marks are edits the writer squeezed in afterwards; a trailing mark
   * hangs past the last letter instead of widening the justified run.
   */
  private span(items: Item[], track: number): number {
    let pen = 0;
    let first = 0;
    let last = 0;
    let seen = false;

    for (let i = 0; i < items.length; i++) {
      const it = items[i]!;
      if (it.kind === 'glyph') {
        if (!seen) {
          first = pen + it.left;
          seen = true;
        }
        last = pen + it.right;
      }
      if (i < items.length - 1) pen += it.advance + track;
    }
    return seen ? last - first : 0;
  }

  /** Index just past the last glyph; items beyond it are trailing edit marks. */
  private lastGlyphIndex(items: Item[]): number {
    let last = -1;
    for (let i = 0; i < items.length; i++) {
      if (items[i]!.kind === 'glyph') last = i;
    }
    return last;
  }

  private place(
    text: string,
    cap: number,
    slot: { baseline: number; field: 'top' | 'bottom' },
    box: Box,
  ): PlacedLine {
    const all = this.items(text, cap);
    const size = this.sizeFor(cap);

    // trailing marks hang past the text, so they take no part in centring
    const lastGlyph = this.lastGlyphIndex(all);
    const body = lastGlyph >= 0 ? all.slice(0, lastGlyph + 1) : all;
    const tail = lastGlyph >= 0 ? all.slice(lastGlyph + 1) : [];

    // centre the run's ink in the box; spacing stays the font's own advance
    const natural = this.span(body, 0);
    const lead = body[0];
    const offset = lead !== undefined && lead.kind === 'glyph' ? lead.left : 0;
    const start = (box.x0 + box.x1) / 2 - natural / 2 - offset;

    const glyphs: PlacedGlyph[] = [];
    const marks: PlacedMark[] = [];
    let inkLeft = Infinity;
    let inkRight = -Infinity;
    let markRight = -Infinity;
    const push = (it: Item, pen: number): void => {
      if (it.kind === 'glyph') {
        glyphs.push({ ch: it.ch, x: pen });
        inkLeft = Math.min(inkLeft, pen + it.left);
        inkRight = Math.max(inkRight, pen + it.right);
      }
      if (it.kind === 'mark') {
        marks.push({
          mark: it.mark,
          x: pen,
          top: slot.baseline + it.dy - it.h,
          w: it.w,
          h: it.h,
        });
        markRight = Math.max(markRight, pen + it.w);
      }
    };

    let pen = start;
    for (let i = 0; i < body.length; i++) {
      push(body[i]!, pen);
      if (i < body.length - 1) pen += body[i]!.advance;
    }
    // a trailing mark sits immediately after the last glyph's advance; its own
    // advance already carries the gap
    pen += body[body.length - 1]?.advance ?? 0;
    for (const it of tail) {
      push(it, pen);
      pen += it.advance;
    }

    const glyphRight = Number.isFinite(inkRight) ? inkRight : start;
    return {
      field: slot.field,
      glyphs,
      marks,
      size,
      baseline: slot.baseline,
      left: Number.isFinite(inkLeft) ? inkLeft : start,
      right: glyphRight,
      markRight: Number.isFinite(markRight) ? markRight : glyphRight,
    };
  }

  private slots(field: 'top' | 'bottom') {
    return this.cfg.lines.filter(l => l.field === field);
  }

  private capFor(field: 'top' | 'bottom'): number {
    return this.slots(field)[0]?.cap ?? 0;
  }

  /** Debug hook: natural width of a run before any centring. */
  measure(raw: string, field: 'top' | 'bottom'): number[] {
    const slots = this.slots(field);
    const text = raw.toUpperCase().replace(/\s+/g, ' ').trim();
    return slots.map(s => this.span(this.items(text, s.cap), 0));
  }

  /**
   * Greedy wrap, widening the box only when the original one cannot hold the
   * text.
   *
   * `t` runs from 0 (the box the original was written in) to 1 (the printed
   * card). Left and right grow to their own limits, so a side with more card
   * beside it keeps expanding after the other has stopped. The smallest `t`
   * that fits wins, so the box grows only as far as the text needs.
   */
  private wrap(
    words: string[],
    field: 'top' | 'bottom',
  ): { lines: string[]; overflow: boolean; box: Box } {
    const base = this.boxAt(field, 0);
    const first = this.wrapAt(words, field, base);
    if (!first.overflow) return { ...first, box: base };

    const full = this.boxAt(field, 1);
    let fit = this.wrapAt(words, field, full);
    if (fit.overflow) return { ...fit, box: full };

    let lo = 0;
    let hi = 1;
    for (let n = 0; n < 12; n++) {
      const mid = (lo + hi) / 2;
      const attempt = this.wrapAt(words, field, this.boxAt(field, mid));
      if (attempt.overflow) {
        lo = mid;
      } else {
        fit = attempt;
        hi = mid;
      }
    }
    return { ...fit, box: this.boxAt(field, hi) };
  }

  /** The field's box at growth `t`: 0 = original, 1 = the printed card. */
  private boxAt(field: 'top' | 'bottom', t: number): Box {
    const f = this.cfg.fields[field];
    const x0 = f.center - f.half;
    const x1 = f.center + f.half;
    return {
      x0: x0 + t * (f.min_x - x0),
      x1: x1 + t * (f.max_x - x1),
    };
  }

  private wrapAt(
    words: string[],
    field: 'top' | 'bottom',
    box: Box,
  ): { lines: string[]; overflow: boolean } {
    const slots = this.slots(field);
    const lines: string[] = [];
    let i = 0;

    for (let s = 0; s < slots.length && i < words.length; s++) {
      const slot = slots[s]!;

      // a single word that cannot fit on its own line is an overflow, not a
      // line: greedy wrapping would otherwise admit it and spill off the card
      if (!this.fitsRun(words[i]!, slot, box)) {
        return { lines, overflow: true };
      }

      let j = i + 1;
      while (j < words.length) {
        const candidate = words.slice(i, j + 1).join(' ');
        if (!this.fitsRun(candidate, slot, box)) break;
        j++;
      }
      lines.push(words.slice(i, j).join(' '));
      i = j;
    }

    return { lines, overflow: i < words.length };
  }

  /**
   * Whether a run stays inside the box once centred in it.
   *
   * Only the letters are held to the box: a mark is an edit squeezed in after
   * the line was written, so it may hang past the last letter. It still has to
   * fall inside the printed card, which is what `max_x` records.
   */
  private fitsRun(
    text: string,
    slot: { baseline: number; field: 'top' | 'bottom' },
    box: Box,
  ): boolean {
    const placed = this.place(text, this.capFor(slot.field), slot, box);
    const card = this.cfg.fields[slot.field];
    return (
      placed.left >= box.x0 - 1 &&
      placed.right <= box.x1 + 1 &&
      placed.markRight <= card.max_x + 1
    );
  }

  /** True when `raw` fits its field at full size. The UI rejects input if not. */
  fits(raw: string, field: 'top' | 'bottom'): boolean {
    const text = raw.toUpperCase().replace(/\s+/g, ' ').trim();
    if (!text) return true;
    if (!this.slots(field).length) return false;
    return !this.wrap(text.split(' '), field).overflow;
  }

  /**
   * Longest prefix of `raw` that still fits, so typing simply stops.
   *
   * Whole words are admitted first; a partially typed word is then extended
   * character by character. That way a long run of letters cannot spill off
   * the card even though it has no spaces to wrap on.
   */
  clamp(raw: string, field: 'top' | 'bottom'): string {
    const text = raw.toUpperCase().replace(/\s+/g, ' ').trim();
    if (this.fits(text, field)) return text;

    const words = text.split(' ');
    let best = '';
    let taken = '';

    for (const word of words) {
      const candidate = taken ? `${taken} ${word}` : word;
      if (this.fits(candidate, field)) {
        taken = candidate;
        best = candidate;
        continue;
      }
      // this word does not fit whole: keep as much of it as the card allows
      for (let i = 1; i <= word.length; i++) {
        const partial = taken ? `${taken} ${word.slice(0, i)}` : word.slice(0, i);
        if (this.fits(partial, field)) best = partial;
        else break;
      }
      break;
    }
    return best;
  }

  /** Lay out one field's text at its measured size, wrapping across slots. */
  build(raw: string, field: 'top' | 'bottom'): PlacedLine[] {
    const slots = this.slots(field);
    if (!slots.length) return [];

    const text = raw.toUpperCase().replace(/\s+/g, ' ').trim();
    if (!text) return [];

    const { lines, box } = this.wrap(text.split(' '), field);

    return lines.map((line, k) => {
      const slot = slots[Math.min(k, slots.length - 1)]!;
      return this.place(line, slot.cap, slot, box);
    });
  }
}
