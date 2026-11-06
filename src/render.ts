import type { Assets, CardConfig, CardState } from './types';
import type { PlacedLine } from './layout';
import { Layout } from './layout';

function inverse(m: number[]): [number, number, number, number, number, number] {
  const [a, b, c, d, e, f] = m as [number, number, number, number, number, number];
  const det = a * d - b * c;
  return [
    d / det, -b / det,
    -c / det, a / det,
    (c * f - d * e) / det,
    (b * e - a * f) / det,
  ];
}

export class Renderer {
  private ctx: CanvasRenderingContext2D;
  private layout: Layout;
  private layer: HTMLCanvasElement | null = null;

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

    lctx.setTransform(...this.cardTransform());
    this.paint(lctx, lines);
    return layer;
  }

  /** Map deskewed card space onto the photo's ROI. */
  private cardTransform(): [number, number, number, number, number, number] {
    const [a, b, c, d, e, f] = inverse(this.cfg.deskew);
    const { x, y } = this.cfg.roi;
    // undo the deskew, then shift the card back to its place in the photo
    return [a, b, c, d, e + x, f + y];
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
        ctx.fillText(glyph.ch, glyph.x, line.baseline);
      }
      for (const placed of line.marks) {
        const img = this.assets.marks.get(placed.mark.name);
        if (!img) continue;
        ctx.drawImage(img, placed.x, placed.top, placed.w, placed.h);
      }
    }
  }

  /** Export the current card as a PNG blob at native resolution. */
  toBlob(): Promise<Blob> {
    return new Promise((resolve, reject) => {
      this.canvas.toBlob(
        blob => (blob ? resolve(blob) : reject(new Error('png encode failed'))),
        'image/png',
      );
    });
  }
}
