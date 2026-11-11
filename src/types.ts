/** One drawing placed inside a mark; a colon or semicolon is two of these. */
export interface MarkPart {
  /** Which traced vector to draw; resolved from assets/punct. */
  svg: string;
  /** Offset from the mark box's left edge to this part's left edge. */
  dx: number;
  /** Offset from the mark box's top edge to this part's top edge. */
  dy: number;
  w: number;
  h: number;
  /** Rotation in degrees about the part's own centre; 0 for most marks. */
  rot: number;
}

export interface Mark {
  w: number;
  h: number;
  /** Offset from the baseline to the mark's bottom edge, in card pixels. */
  bottom: number;
  /** Font size the mark was traced at; the renderer scales from this. */
  size: number;
  /** Extra advance as a fraction of size, so a tall mark clears the letter. */
  pad?: number;
  parts: MarkPart[];
}

export interface LineSlot {
  band: string;
  field: 'header' | 'top' | 'bottom';
  x0: number;
  x1: number;
  baseline: number;
  /** Font size in card pixels; the letters are drawn at exactly this size. */
  size: number;
  /** Extra gap after every glyph, as a fraction of the em. Negative tightens. */
  letter_space: number;
  /** Width of a word space, as a multiple of the font size. */
  word_space: number;
  /**
   * Horizontal shift in card pixels, applied after centring. The field keeps
   * one justification box so wrapped lines reflow together; this nudges a
   * single line without changing what the field fits in.
   */
  nudge?: number;
}

/**
 * The box a field is typeset in: lines are centred on `center` and wrapped to
 * `half` either side. `min_x`/`max_x` are how far the box may grow, to the card.
 */
export interface FieldBounds {
  center: number;
  half: number;
  min_x: number;
  max_x: number;
}

export interface CardConfig {
  source: [number, number];
  roi: { x: number; y: number; w: number; h: number };
  /** Size of the rectangle the card quad is mapped onto. */
  card: [number, number];
  /** 3x3 row-major homography, photo pixels -> card space. */
  homography: number[];
  ink: { colour: [number, number, number] };
  font: {
    family: string;
    weight: number;
  };
  lines: LineSlot[];
  fields: { header: FieldBounds; top: FieldBounds; bottom: FieldBounds };
  /** Keyed by the character the mark draws, so lookups take the typed glyph. */
  marks: Record<string, Mark>;
}

export interface CardState {
  header: string;
  top: string;
  bottom: string;
}

/** A glyph ready to draw: its character and its pen position in card space. */
export interface PlacedGlyph {
  ch: string;
  x: number;
}

/** A mark ready to draw: where its box lands, in card space. */
export interface PlacedMark {
  mark: Mark;
  /** Left edge of the mark's box. */
  x: number;
  /** Top edge of the mark's box. */
  y: number;
  w: number;
}

/** One typeset line, as handed from layout to the renderer. */
export interface PlacedLine {
  glyphs: PlacedGlyph[];
  marks: PlacedMark[];
  size: number;
  baseline: number;
}

export interface Assets {
  plate: HTMLImageElement;
  /** Matte of the cartoon hand, drawn over the header so it occludes it. */
  fingers: HTMLImageElement;
  /** Keyed by SVG name; a shape shared by several marks is loaded once. */
  marks: Map<string, HTMLImageElement[]>;
}
