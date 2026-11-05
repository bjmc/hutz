export interface Mark {
  name: string;
  char: string;
  w: number;
  h: number;
  dy: number;
  cap: number;
  uri: string;
}

export interface LineSlot {
  band: string;
  field: 'top' | 'bottom';
  x0: number;
  x1: number;
  fit_x1: number;
  baseline: number;
  cap: number;
}

export interface CardConfig {
  source: [number, number];
  roi: { x: number; y: number; w: number; h: number };
  deskew: number[];
  ink: { colour: [number, number, number] };
  font: {
    family: string;
    cap_ratio: number;
    advance_ratio: number;
    word_space: number;
  };
  lines: LineSlot[];
  marks: Mark[];
}

export interface CardState {
  top: string;
  bottom: string;
}

export interface Assets {
  plate: HTMLImageElement;
  marks: Map<string, HTMLImageElement>;
}
