/**
 * The card's state as a URL fragment, so a link reproduces the meme.
 *
 * Short keys keep the fragment readable: `#h=LIONEL+HUTZ&t=...&b=...`.
 */
import { DEFAULTS } from './config';
import type { CardState } from './types';

/** Encode state into the fragment, replacing the current history entry. */
export function writeHash(state: CardState): void {
  const params = new URLSearchParams({
    h: state.header,
    t: state.top,
    b: state.bottom,
  });
  history.replaceState(null, '', `#${params}`);
}

/**
 * Read state from the fragment.
 *
 * A fragment with none of the keys means "no state was shared", so the card
 * starts at its defaults. Once any key is present the rest default to empty,
 * so a link that only sets the header does not resurrect the original name.
 */
export function readHash(): CardState {
  if (!location.hash.length) return DEFAULTS;
  const params = new URLSearchParams(location.hash.slice(1));
  const header = params.get('h');
  const top = params.get('t');
  const bottom = params.get('b');
  if (header === null && top === null && bottom === null) return DEFAULTS;
  return {
    header: header ?? '',
    top: top ?? '',
    bottom: bottom ?? '',
  };
}
