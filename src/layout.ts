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
}

const MARK_GAP = 0.06;      // of cap, between the last letter and its edit mark
const MAX_TRACK = 0.22;     // of cap; past this the line is centred, not spread
const MIN_TRACK = -0.06;
const FIT_SLACK = 1.02;     // a line may hang this far past its slot
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
    slot: { x0: number; x1: number; baseline: number; field: 'top' | 'bottom' },
  ): PlacedLine {
    const all = this.items(text, cap);
    const size = this.sizeFor(cap);

    // trailing marks hang past the text, so they take no part in justification
    const lastGlyph = this.lastGlyphIndex(all);
    const body = lastGlyph >= 0 ? all.slice(0, lastGlyph + 1) : all;
    const tail = lastGlyph >= 0 ? all.slice(lastGlyph + 1) : [];

    const gaps = Math.max(1, body.length - 1);
    const natural = this.span(body, 0);
    const width = slot.x1 - slot.x0;

    const wanted = (width - natural) / gaps;
    const track = Math.max(MIN_TRACK * cap, Math.min(MAX_TRACK * cap, wanted));

    const lead = body[0];
    const offset = lead !== undefined && lead.kind === 'glyph' ? lead.left : 0;
    const spread = natural + track * gaps;
    const start =
      Math.abs(wanted - track) < 1e-6
        ? slot.x0 - offset
        : slot.x0 + (width - spread) / 2 - offset;

    const glyphs: PlacedGlyph[] = [];
    const marks: PlacedMark[] = [];
    const push = (it: Item, pen: number): void => {
      if (it.kind === 'glyph') glyphs.push({ ch: it.ch, x: pen });
      if (it.kind === 'mark') {
        marks.push({
          mark: it.mark,
          x: pen,
          top: slot.baseline + it.dy - it.h,
          w: it.w,
          h: it.h,
        });
      }
    };

    let pen = start;
    for (let i = 0; i < body.length; i++) {
      push(body[i]!, pen);
      if (i < body.length - 1) pen += body[i]!.advance + track;
    }
    pen += (body[body.length - 1]?.advance ?? 0) + track;
    for (const it of tail) {
      push(it, pen);
      pen += it.advance + track;
    }

    return { field: slot.field, glyphs, marks, size, baseline: slot.baseline };
  }

  private slots(field: 'top' | 'bottom') {
    return this.cfg.lines.filter(l => l.field === field);
  }

  /** Greedy wrap at the slots' own size -- text never shrinks to fit. */
  private wrap(
    words: string[],
    slots: { x0: number; x1: number; cap: number }[],
  ): { lines: string[]; overflow: boolean } {
    const lines: string[] = [];
    let i = 0;

    for (let s = 0; s < slots.length && i < words.length; s++) {
      const slot = slots[s]!;
      const limit = (slot.x1 - slot.x0) * FIT_SLACK;
      let j = i + 1;
      while (j < words.length) {
        const candidate = words.slice(i, j + 1).join(' ');
        if (this.span(this.items(candidate, slot.cap), 0) > limit) break;
        j++;
      }
      lines.push(words.slice(i, j).join(' '));
      i = j;
    }

    return { lines, overflow: i < words.length };
  }

  /** True when `raw` fits its field at full size. The UI rejects input if not. */
  fits(raw: string, field: 'top' | 'bottom'): boolean {
    const slots = this.slots(field);
    const text = raw.toUpperCase().replace(/\s+/g, ' ').trim();
    if (!text) return true;
    if (!slots.length) return false;
    return !this.wrap(text.split(' '), slots).overflow;
  }

  /** Lay out one field's text at its measured size, wrapping across slots. */
  build(raw: string, field: 'top' | 'bottom'): PlacedLine[] {
    const slots = this.slots(field);
    if (!slots.length) return [];

    const text = raw.toUpperCase().replace(/\s+/g, ' ').trim();
    if (!text) return [];

    const { lines } = this.wrap(text.split(' '), slots);

    return lines.map((line, k) => {
      const slot = slots[Math.min(k, slots.length - 1)]!;
      return this.place(line, slot.cap, slot);
    });
  }
}
