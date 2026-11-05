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
const FIT_SLACK = 1.04;     // a line may hang this far past its slot

export class Layout {
  private byChar = new Map<string, Mark>();
  private capRatioCache: number | null = null;

  constructor(
    private ctx: CanvasRenderingContext2D,
    private cfg: CardConfig,
  ) {
    for (const m of cfg.marks) this.byChar.set(m.char, m);
  }

  /** Cap height as a fraction of font size, measured from the live font. */
  private capRatio(): number {
    if (this.capRatioCache !== null) return this.capRatioCache;
    const probe = 1000;
    this.ctx.font = `${probe}px ${this.cfg.font.family}`;
    const m = this.ctx.measureText('H');
    const ratio =
      (m.actualBoundingBoxAscent + m.actualBoundingBoxDescent) / probe;
    this.capRatioCache = ratio > 0 ? ratio : this.cfg.font.cap_ratio;
    return this.capRatioCache;
  }

  private sizeFor(cap: number): number {
    return cap / this.capRatio();
  }

  private items(text: string, cap: number): Item[] {
    this.ctx.font = `${this.sizeFor(cap)}px ${this.cfg.font.family}`;
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

  /** Ink span of a run: first item's left edge to last item's right edge. */
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
      } else if (it.kind === 'mark') {
        if (!seen) {
          first = pen;
          seen = true;
        }
        last = pen + it.w;
      }
      if (i < items.length - 1) pen += it.advance + track;
    }
    return seen ? last - first : 0;
  }

  private place(
    text: string,
    cap: number,
    slot: { x0: number; x1: number; baseline: number; field: 'top' | 'bottom' },
  ): PlacedLine {
    const items = this.items(text, cap);
    const size = this.sizeFor(cap);
    const gaps = Math.max(1, items.length - 1);
    const natural = this.span(items, 0);
    const width = slot.x1 - slot.x0;

    const wanted = (width - natural) / gaps;
    const track = Math.max(MIN_TRACK * cap, Math.min(MAX_TRACK * cap, wanted));

    const lead = items[0];
    const offset = lead !== undefined && lead.kind === 'glyph' ? lead.left : 0;
    const spread = natural + track * gaps;
    const start =
      Math.abs(wanted - track) < 1e-6
        ? slot.x0 - offset
        : slot.x0 + (width - spread) / 2 - offset;

    const glyphs: PlacedGlyph[] = [];
    const marks: PlacedMark[] = [];
    let pen = start;

    for (let i = 0; i < items.length; i++) {
      const it = items[i]!;
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
      if (i < items.length - 1) pen += it.advance + track;
    }

    return { field: slot.field, glyphs, marks, size, baseline: slot.baseline };
  }

  private wrap(
    words: string[],
    caps: number[],
    widths: number[],
  ): { lines: string[]; overflow: boolean } {
    const lines: string[] = [];
    let i = 0;

    for (let s = 0; s < widths.length && i < words.length; s++) {
      const cap = caps[s]!;
      const limit = widths[s]! * FIT_SLACK;
      let j = i + 1;
      while (j < words.length) {
        const candidate = words.slice(i, j + 1).join(' ');
        if (this.span(this.items(candidate, cap), 0) > limit) break;
        j++;
      }
      lines.push(words.slice(i, j).join(' '));
      i = j;
    }

    if (i < words.length) return { lines, overflow: true };
    return { lines, overflow: false };
  }

  /** Lay out one field's text across its slots, shrinking until it fits. */
  build(raw: string, field: 'top' | 'bottom'): PlacedLine[] {
    const slots = this.cfg.lines.filter(l => l.field === field);
    if (!slots.length) return [];

    const text = raw.toUpperCase().replace(/\s+/g, ' ').trim();
    if (!text) return [];

    const words = text.split(' ');
    const caps = slots.map(s => s.cap);
    const widths = slots.map(s => s.x1 - s.x0);

    // start at full size and step down until every word finds a slot; stop at
    // 55% so a pathological input cannot shrink the text into illegibility
    let scale = 1;
    let lines: string[] = [];
    for (; scale >= 0.55; scale -= 0.03) {
      const attempt = this.wrap(
        words,
        caps.map(c => c * scale),
        widths,
      );
      lines = attempt.lines;
      if (!attempt.overflow) break;
    }

    return lines.map((line, k) => {
      const slot = slots[Math.min(k, slots.length - 1)]!;
      return this.place(line, slot.cap * scale, slot);
    });
  }
}
