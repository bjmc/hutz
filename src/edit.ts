/**
 * What a keystroke should do to one field.
 *
 * The card can only hold so much text per line, so every edit is clamped: the
 * user types freely and any excess is trimmed, with the field marked as full.
 * Two details are easy to get wrong and are handled here, away from the DOM:
 *
 * - a trailing space survives, or a second word could never be started;
 * - the value the card renders is the trimmed text, not what the field shows.
 */
import type { Field } from './types';

export interface Edit {
  /** The text the card should render: trimmed and clamped. */
  value: string;
  /** The text the input should show, which may keep a typed trailing space. */
  shown: string;
  /** True when text had to be cut, so the line is full. */
  atLimit: boolean;
}

/**
 * Resolve one keystroke.
 *
 * `clamp` is the layout's fitter; passing it in keeps this function pure and
 * lets a test exercise the rules without a canvas.
 */
export function editField(
  raw: string,
  field: Field,
  clamp: (text: string, field: Field) => string,
): Edit {
  const upper = raw.toUpperCase().replace(/\s+/g, ' ');
  const value = clamp(upper, field);

  // keep the space the user just typed, or they can never type a second word
  const shown = /\s$/.test(raw) ? `${value} ` : value;

  // the clamp reports "trimmed" rather than "unchanged": compare against the
  // normalised input, not the raw keystroke
  const atLimit = value !== upper.trim();

  return { value, shown, atLimit };
}
