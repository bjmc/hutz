import type {
  Assets, CardConfig, CardState, PlacedLine,
} from './types';
import { Layout } from './layout';
import { invert3x3, localTransform } from './projection';

export class Renderer {
  private ctx: CanvasRenderingContext2D;
  private layout: Layout;
  private layer: HTMLCanvasElement | null = null;
  private inv: number[] | null = null;

  constructor(
    private canvas: HTMLCanvasElement,
    private cfg: CardConfig,
    private assets: Assets,
  ) {
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('canvas 2d unavailable');
    this.ctx = ctx;
    this.layout = new Layout(ctx, cfg);
  }

  /** Longest prefix of `text` that still fits its field. */
  clamp(text: string, field: 'header' | 'top' | 'bottom'): string {
    return this.layout.clamp(text, field);
  }

  /** Render the whole card at native size. */
  draw(state: CardState): void {
    const ctx = this.ctx;
    const { width, height } = this.canvas;

    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, width, height);
    ctx.drawImage(this.assets.plate, 0, 0);

    const lines = [
      ...this.layout.build(state.header, 'header'),
      ...this.layout.build(state.top, 'top'),
      ...this.layout.build(state.bottom, 'bottom'),
    ];

    // The plate already shows the fingers, so the ink must never print over
    // them. Cutting the hand out of the ink layers leaves the plate's own
    // fingers visible, which is why no third layer is drawn.
    const hand = state.header.trim() ? this.assets.fingers : null;
    const ink = this.textLayer(width, height, lines, false, hand);
    ctx.save();
    ctx.globalCompositeOperation = 'multiply';
    ctx.globalAlpha = 0.94;
    if ('filter' in ctx) ctx.filter = 'blur(0.45px)';
    ctx.drawImage(ink, 0, 0);
    ctx.restore();

    // The marks are pen on paper, so their colour was already sampled from the
    // screencap. Multiplying them again would darken that a second time.
    const marks = this.textLayer(width, height, lines, true, hand);
    ctx.save();
    if ('filter' in ctx) ctx.filter = 'blur(0.45px)';
    ctx.drawImage(marks, 0, 0);
    ctx.restore();
  }

  /**
   * Paint the text and its edit marks into a transparent offscreen canvas.
   *
   * When `cut` is given, its alpha is punched out of the layer, so nothing is
   * drawn where the cartoon hand sits.
   */
  private textLayer(
    width: number,
    height: number,
    lines: PlacedLine[],
    marksOnly: boolean,
    cut: HTMLImageElement | null,
  ): HTMLCanvasElement {
    if (!this.layer) {
      this.layer = document.createElement('canvas');
    }
    const layer = this.layer;
    layer.width = width;
    layer.height = height;
    const lctx = layer.getContext('2d');
    if (!lctx) throw new Error('canvas 2d unavailable');

    this.paint(lctx, lines, marksOnly);

    if (cut) {
      // `destination-out` keeps only pixels the mask is transparent over
      lctx.globalCompositeOperation = 'destination-out';
      lctx.drawImage(cut, 0, 0);
      lctx.globalCompositeOperation = 'source-over';
    }
    return layer;
  }

  /** Card space -> image, i.e. the inverse of the configured homography. */
  private inverse(): number[] {
    if (this.inv) return this.inv;
    this.inv = invert3x3(this.cfg.homography);
    return this.inv;
  }

  /** Local affine at a card-space point, as a canvas transform. */
  private localTransform(
    x: number,
    y: number,
  ): [number, number, number, number, number, number] {
    return localTransform(this.inverse(), x, y);
  }

  private paint(
    ctx: CanvasRenderingContext2D,
    lines: PlacedLine[],
    marksOnly: boolean,
  ): void {
    const [r, g, b] = this.cfg.ink.colour;
    const ink = `rgb(${r} ${g} ${b})`;
    const family = this.cfg.font.family;

    ctx.textBaseline = 'alphabetic';
    ctx.fillStyle = ink;

    for (const line of lines) {
      if (marksOnly) {
        this.paintMarks(ctx, line);
        continue;
      }
      ctx.font = `${this.cfg.font.weight} ${line.size}px ${family}`;
      for (const glyph of line.glyphs) {
        ctx.save();
        ctx.setTransform(...this.localTransform(glyph.x, line.baseline));
        ctx.fillText(glyph.ch, glyph.x, line.baseline);
        ctx.restore();
      }
    }
  }

  private paintMarks(ctx: CanvasRenderingContext2D, line: PlacedLine): void {
    for (const placed of line.marks) {
      const scale = placed.w / placed.mark.w;
      for (const part of placed.mark.parts) {
        const img = this.assets.marks.get(part.svg)?.[0];
        if (!img) continue;
        // each part is placed from its own box, so a stacked mark like `:`
        // does not drag its upper dot upward with the composed height
        const px = placed.x + part.dx * scale;
        const py = placed.y + part.dy * scale;
        const pw = part.w * scale;
        const ph = part.h * scale;
        ctx.save();
        ctx.setTransform(...this.localTransform(placed.x, placed.y));
        if (part.rot !== 0) {
          // rotate about the part's own centre, in card space
          const cx = px + pw / 2;
          const cy = py + ph / 2;
          ctx.translate(cx, cy);
          ctx.rotate((part.rot * Math.PI) / 180);
          ctx.translate(-cx, -cy);
        }
        ctx.drawImage(img, px, py, pw, ph);
        ctx.restore();
      }
    }
  }

  /**
   * Export the current card as a JPEG blob at native resolution.
   *
   * The plate came from a JPEG screencap, so a PNG export would only inflate
   * the file without recovering anything.
   */
  toBlob(quality = 0.95): Promise<Blob> {
    return new Promise((resolve, reject) => {
      this.canvas.toBlob(
        blob => (blob ? resolve(blob) : reject(new Error('jpeg encode failed'))),
        'image/jpeg',
        quality,
      );
    });
  }

  /** PNG is only needed for the clipboard, which will not take a JPEG. */
  toPngBlob(): Promise<Blob> {
    return new Promise((resolve, reject) => {
      this.canvas.toBlob(
        blob => (blob ? resolve(blob) : reject(new Error('png encode failed'))),
        'image/png',
      );
    });
  }
}
