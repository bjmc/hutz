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

  /** Render the whole card at native size. */
  draw(state: CardState): void {
    const ctx = this.ctx;

    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
    ctx.drawImage(this.assets.plate, 0, 0);

    const lines = [
      ...this.layout.build(state.top, 'top'),
      ...this.layout.build(state.bottom, 'bottom'),
    ];

    // text is drawn through the card transform so glyphs rasterise once, at
    // final resolution, instead of being resampled after the warp
    ctx.save();
    ctx.setTransform(...this.cardTransform());
    this.paint(ctx, lines);
    ctx.restore();
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
      ctx.font = `${line.size}px ${family}`;
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
