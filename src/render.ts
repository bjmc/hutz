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

    // Ink is rasterised once at final resolution into an offscreen layer, then
    // blurred a touch and multiplied into the photo. Drawing straight onto the
    // canvas leaves vector-sharp edges that read as a modern overlay on a
    // soft, JPEG-compressed screencap.
    const layer = this.textLayer(width, height, lines, false);
    ctx.save();
    ctx.globalCompositeOperation = 'multiply';
    ctx.globalAlpha = 0.94;
    if ('filter' in ctx) ctx.filter = 'blur(0.45px)';
    ctx.drawImage(layer, 0, 0);
    ctx.restore();

    // The marks are pen on paper, so their colour was already sampled from the
    // photograph. Multiplying them again would darken that a second time.
    const marks = this.textLayer(width, height, lines, true);
    ctx.save();
    if ('filter' in ctx) ctx.filter = 'blur(0.45px)';
    ctx.drawImage(marks, 0, 0);
    ctx.restore();

    // The plate has no printed name, so the cartoon hand must be laid back over
    // the header. Its matte is the photograph's own hand, which is why the
    // fingers keep their drawn outline rather than being inpainted around.
    if (state.header.trim()) ctx.drawImage(this.assets.fingers, 0, 0);
  }

  /** Paint the text and its edit marks into a transparent offscreen canvas. */
  private textLayer(
    width: number,
    height: number,
    lines: PlacedLine[],
    marksOnly: boolean,
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
    const h = this.inverse();
    const w = h[6]! * x + h[7]! * y + h[8]!;
    const u = (h[0]! * x + h[1]! * y + h[2]!) / w;
    const v = (h[3]! * x + h[4]! * y + h[5]!) / w;
    // analytic Jacobian of the projective map at this point
    const a = (h[0]! - u * h[6]!) / w;
    const c = (h[1]! - u * h[7]!) / w;
    const b = (h[3]! - v * h[6]!) / w;
    const d = (h[4]! - v * h[7]!) / w;
    return [a, b, c, d, u - a * x - c * y, v - b * x - d * y];
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
      const imgs = this.assets.marks.get(placed.mark.name);
      if (!imgs) continue;
      const scale = placed.w / placed.mark.w;
      for (let i = 0; i < placed.mark.parts.length; i++) {
        const part = placed.mark.parts[i]!;
        const img = imgs[i];
        if (!img) continue;
        // each part is positioned from the baseline by its own height; using
        // the composed mark's total height would push the upper dot upward
        const py = line.baseline + (part.bottom - part.h) * scale;
        const px = placed.x + part.dx * scale;
        const pw = part.w * scale;
        const ph = part.h * scale;
        ctx.save();
        ctx.setTransform(...this.localTransform(placed.x, py));
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
