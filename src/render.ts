import type { Assets, CardConfig, CardState } from './types';
import type { PlacedLine } from './layout';
import { Layout } from './layout';

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
  clamp(text: string, field: 'top' | 'bottom'): string {
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
      ...this.layout.build(state.top, 'top'),
      ...this.layout.build(state.bottom, 'bottom'),
    ];

    // Ink is rasterised once at final resolution into an offscreen layer, then
    // blurred a touch and multiplied into the photo. Drawing straight onto the
    // canvas leaves vector-sharp edges that read as a modern overlay on a
    // soft, JPEG-compressed screencap.
    const layer = this.textLayer(width, height, lines);
    ctx.save();
    ctx.globalCompositeOperation = 'multiply';
    ctx.globalAlpha = 0.94;
    if ('filter' in ctx) ctx.filter = 'blur(0.45px)';
    ctx.drawImage(layer, 0, 0);
    ctx.restore();
  }

  /** Paint the text and its edit marks into a transparent offscreen canvas. */
  private textLayer(
    width: number,
    height: number,
    lines: PlacedLine[],
  ): HTMLCanvasElement {
    if (!this.layer) {
      this.layer = document.createElement('canvas');
    }
    const layer = this.layer;
    layer.width = width;
    layer.height = height;
    const lctx = layer.getContext('2d');
    if (!lctx) throw new Error('canvas 2d unavailable');

    this.paint(lctx, lines);
    return layer;
  }

  /** Card space -> photo, i.e. the inverse of the configured homography. */
  private inverse(): number[] {
    if (this.inv) return this.inv;
    const [a, b, c, d, e, f, g, h, i] = this.cfg.homography as [
      number, number, number, number, number, number, number, number, number,
    ];
    const A = e * i - f * h;
    const B = -(d * i - f * g);
    const C = d * h - e * g;
    const det = a * A + b * B + c * C;
    this.inv = [
      A / det, -(b * i - c * h) / det, (b * f - c * e) / det,
      B / det, (a * i - c * g) / det, -(a * f - c * d) / det,
      C / det, -(a * h - b * g) / det, (a * e - b * d) / det,
    ];
    return this.inv;
  }

  /** Map a card-space point onto the photo. */
  private toPhoto(x: number, y: number): [number, number] {
    const h = this.inverse();
    const w = h[6]! * x + h[7]! * y + h[8]!;
    return [
      (h[0]! * x + h[1]! * y + h[2]!) / w,
      (h[3]! * x + h[4]! * y + h[5]!) / w,
    ];
  }

  /**
   * Local affine at a card-space point, as a canvas transform.
   *
   * Canvas2D flattens projective matrices (m14 is dropped), so the homography
   * cannot be set directly. Over one glyph the mapping is near-affine, so the
   * exact Jacobian is used instead: the pen lands on the mapped point and the
   * glyph is sheared by however the projection scales it locally.
   */
  private localTransform(
    x: number,
    y: number,
  ): [number, number, number, number, number, number] {
    const e = 0.5;
    const [x1, y1] = this.toPhoto(x + e, y);
    const [x0, y0] = this.toPhoto(x - e, y);
    const [x2, y2] = this.toPhoto(x, y + e);
    const [x3, y3] = this.toPhoto(x, y - e);
    const a = (x1 - x0) / (2 * e);
    const b = (y1 - y0) / (2 * e);
    const c = (x2 - x3) / (2 * e);
    const d = (y2 - y3) / (2 * e);
    const [px, py] = this.toPhoto(x, y);
    return [a, b, c, d, px - a * x - c * y, py - b * x - d * y];
  }

  private paint(ctx: CanvasRenderingContext2D, lines: PlacedLine[]): void {
    const [r, g, b] = this.cfg.ink.colour;
    const ink = `rgb(${r} ${g} ${b})`;
    const family = this.cfg.font.family;

    ctx.textBaseline = 'alphabetic';
    ctx.fillStyle = ink;

    for (const line of lines) {
      ctx.font = `italic 700 ${line.size}px ${family}`;
      for (const glyph of line.glyphs) {
        ctx.save();
        ctx.setTransform(...this.localTransform(glyph.x, line.baseline));
        ctx.fillText(glyph.ch, glyph.x, line.baseline);
        ctx.restore();
      }
      for (const placed of line.marks) {
        const img = this.assets.marks.get(placed.mark.name);
        if (!img) continue;
        ctx.save();
        ctx.setTransform(...this.localTransform(placed.x, placed.top));
        ctx.drawImage(img, placed.x, placed.top, placed.w, placed.h);
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
