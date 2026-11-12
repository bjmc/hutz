import { beforeEach, describe, expect, test } from 'bun:test';

import { DEFAULTS } from '../src/config';
import { readHash, writeHash } from '../src/url';
import type { CardState } from '../src/types';

/**
 * `readHash` and `writeHash` talk to `location` and `history`, which Bun does
 * not provide. A pair of stubs is enough: the module only reads
 * `location.hash` and calls `history.replaceState`.
 */
let hash = '';

beforeEach(() => {
  hash = '';
  const g = globalThis as unknown as Record<string, unknown>;
  g.location = { get hash() { return hash; } };
  g.history = {
    replaceState(_state: unknown, _title: string, url: string) {
      hash = url.startsWith('#') ? url : `#${url}`;
    },
  };
});

/** Parse a fragment into its parameters, for assertions. */
function params(): URLSearchParams {
  return new URLSearchParams(hash.replace(/^#/, ''));
}

describe('readHash', () => {
  test('an empty fragment means defaults', () => {
    expect(readHash()).toEqual(DEFAULTS);
  });

  test('a fragment with no known keys means defaults', () => {
    hash = '#nonsense=1';
    expect(readHash()).toEqual(DEFAULTS);
  });

  test('reads all three fields', () => {
    hash = '#h=LIONEL+HUTZ&t=WORKS+ON&b=NO%2C+MONEY+DOWN%21';
    expect(readHash()).toEqual({
      header: 'LIONEL HUTZ',
      top: 'WORKS ON',
      bottom: 'NO, MONEY DOWN!',
    });
  });

  test('a missing key becomes empty, not the default', () => {
    // once the link sets any field it is describing a custom card, so the
    // untouched fields must not fall back to the printed text
    hash = '#h=NEW+NAME';
    expect(readHash()).toEqual({ header: 'NEW NAME', top: '', bottom: '' });
  });

  test('an explicitly empty value stays empty', () => {
    hash = '#h=&t=&b=';
    expect(readHash()).toEqual({ header: '', top: '', bottom: '' });
  });

  test('survives characters needing escaping', () => {
    const state = { header: 'A&B', top: '1=2', bottom: '?!#%' };
    writeHash(state);
    expect(readHash()).toEqual(state);
  });
});

describe('writeHash', () => {
  test('writes all three fields', () => {
    writeHash({ header: 'A', top: 'B', bottom: 'C' });
    expect(params().get('h')).toBe('A');
    expect(params().get('t')).toBe('B');
    expect(params().get('b')).toBe('C');
  });

  test('replaces rather than pushes, so Back leaves the page', () => {
    let calls = 0;
    const g = globalThis as unknown as Record<string, unknown>;
    const real = (g.history as { replaceState: () => void }).replaceState;
    g.history = {
      replaceState(s: unknown, t: string, u: string) {
        calls++;
        real.call(g.history, s, t, u);
      },
    };
    writeHash({ header: 'A', top: 'B', bottom: 'C' });
    writeHash({ header: 'A', top: 'B', bottom: 'D' });
    expect(calls).toBe(2);
  });

  test('an empty state still writes a fragment', () => {
    writeHash({ header: '', top: '', bottom: '' });
    expect(hash).toStartWith('#');
    expect(readHash()).toEqual({ header: '', top: '', bottom: '' });
  });
});

describe('round trip', () => {
  const cases: CardState[] = [
    DEFAULTS,
    { header: '', top: '', bottom: '' },
    { header: 'LIONEL HUTZ', top: '', bottom: 'X' },
    { header: 'ÜNÏCODE', top: 'A B  C', bottom: '100%' },
    { header: 'A&B=C', top: '#HASH', bottom: '+PLUS' },
  ];

  for (const state of cases) {
    test(`preserves ${JSON.stringify(state)}`, () => {
      writeHash(state);
      expect(readHash()).toEqual(state);
    });
  }
});
