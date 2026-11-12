import { describe, expect, test } from 'bun:test';

import { markDataUri } from '../src/marks';
import { CONFIG } from '../src/config';

/** The SVG text carried by a data URI from `markDataUri`. */
function svgText(uri: string): string {
  const prefix = 'data:image/svg+xml;base64,';
  expect(uri.startsWith(prefix)).toBe(true);
  return atob(uri.slice(prefix.length));
}

describe('markDataUri', () => {
  for (const name of ['bang', 'comma', 'dash', 'period', 'qmark']) {
    test(`${name} resolves to an svg data uri`, () => {
      expect(markDataUri(name)).toStartWith('data:image/svg+xml;base64,');
    });
  }

  test('the payload is the traced vector, not an empty shell', () => {
    // a real trace always carries at least one path or ellipse
    for (const name of ['bang', 'comma', 'dash', 'period', 'qmark']) {
      const svg = svgText(markDataUri(name));
      expect(svg).toContain('<svg');
      expect(/<(path|ellipse|polygon)/.test(svg)).toBe(true);
    }
  });

  test('every vector is self-contained', () => {
    // a data URI is inlined into the canvas, so nothing may be fetched
    for (const name of ['bang', 'comma', 'dash', 'period', 'qmark']) {
      const svg = svgText(markDataUri(name));
      expect(svg).not.toMatch(/<(image|use|script)\b/);
      expect(svg).not.toContain('href="http');
    }
  });

  test('round-trips to well-formed svg markup', () => {
    // Bun has no DOMParser, and pulling in a DOM just to validate five static
    // files is not worth it; check the structural invariants instead
    for (const name of ['bang', 'comma', 'dash', 'period', 'qmark']) {
      const svg = svgText(markDataUri(name));

      // balanced root element, with the namespace a browser needs
      expect(svg.match(/<svg\b/g)).toHaveLength(1);
      expect(svg.match(/<\/svg>/g)).toHaveLength(1);
      expect(svg).toContain('xmlns="http://www.w3.org/2000/svg"');

      // declares the size it will be drawn at
      expect(svg).toMatch(/viewBox="[^"]+"/);
      expect(svg).toMatch(/width="\d/);

      // self-closing elements only: anything else would need a close tag, and
      // potrace emits none
      expect(svg).not.toMatch(/<(path|ellipse|polygon)[^>]*[^/]>\s*[^<]/);

      // decodes to text, not to binary
      expect(() => atob(btoa(svg))).not.toThrow();
    }
  });

  test('the same name always yields the same uri', () => {
    expect(markDataUri('qmark')).toBe(markDataUri('qmark'));
  });

  test('different names yield different uris', () => {
    expect(markDataUri('comma')).not.toBe(markDataUri('period'));
  });

  test('an unknown name throws rather than returning junk', () => {
    expect(() => markDataUri('nosuchmark')).toThrow(/unknown mark vector/);
  });

  test('the error names the missing vector, for a useful failure', () => {
    expect(() => markDataUri('nosuchmark')).toThrow('nosuchmark');
  });

  test('an empty name throws', () => {
    expect(() => markDataUri('')).toThrow(/unknown mark vector/);
  });
});

describe('config and sources agree', () => {
  test('every svg a mark refers to exists', () => {
    // this is the failure a per-name test cannot catch: adding a mark to the
    // config without adding its vector leaves the app broken at draw time
    const used = new Set(
      Object.values(CONFIG.marks).flatMap(m => m.parts.map(p => p.svg)),
    );
    expect(used.size).toBeGreaterThan(0);
    for (const name of used) {
      expect(() => markDataUri(name)).not.toThrow();
    }
  });

  test('no vector is shipped unused', () => {
    // a stale vector is dead weight in the single-file bundle
    const used = new Set(
      Object.values(CONFIG.marks).flatMap(m => m.parts.map(p => p.svg)),
    );
    for (const name of ['bang', 'comma', 'dash', 'period', 'qmark']) {
      expect(used.has(name)).toBe(true);
    }
  });
});
