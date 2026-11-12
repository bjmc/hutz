import { describe, expect, test } from 'bun:test';

import { editField } from '../src/edit';
import type { Field } from '../src/types';

/** A clamp that refuses anything longer than `limit` characters. */
const limited = (limit: number) =>
  (text: string, _field: Field) =>
    text.length <= limit ? text : text.slice(0, limit);

/**
 * A clamp that never truncates but does trim, as the real `Layout.clamp` does:
 * it normalises, then drops trailing whitespace before measuring.
 */
const roomy = (text: string) => text.trim();

describe('editField normalisation', () => {
  test('upper-cases what the user typed', () => {
    expect(editField('hello', 'top', roomy).value).toBe('HELLO');
    expect(editField('hello', 'top', roomy).shown).toBe('HELLO');
  });

  test('collapses runs of spaces', () => {
    expect(editField('A    B', 'top', roomy).value).toBe('A B');
  });

  test('a leading space is trimmed like the real clamp does', () => {
    // Layout.clamp trims before measuring, so a leading space never reaches
    // the card; the field itself is corrected by the caller
    expect(editField(' A', 'top', roomy).value).toBe('A');
  });

  test('an empty field stays empty', () => {
    const out = editField('', 'header', roomy);
    expect(out.value).toBe('');
    expect(out.shown).toBe('');
    expect(out.atLimit).toBe(false);
  });
});

describe('editField trailing space', () => {
  test('a typed trailing space is shown in the input', () => {
    // without this the user could never type a second word: the clamp trims
    // the space, and the field would fight them on every keystroke
    const out = editField('HI ', 'top', roomy);
    expect(out.shown).toBe('HI ');
  });

  test('but the card renders the trimmed text', () => {
    const out = editField('HI ', 'top', roomy);
    expect(out.value).toBe('HI');
  });

  test('the card never sees the space, even when clamped', () => {
    const out = editField('HELLO ', 'top', limited(5));
    expect(out.value).toBe('HELLO');
    expect(out.shown).toBe('HELLO ');
    expect(out.atLimit).toBe(false);
  });

  test('a double space does not become a trailing space', () => {
    const out = editField('HI  ', 'top', roomy);
    expect(out.value).toBe('HI');
    expect(out.shown).toBe('HI ');
  });

  test('no trailing space means shown equals value', () => {
    const out = editField('HI', 'top', roomy);
    expect(out.shown).toBe(out.value);
  });
});

describe('editField atLimit', () => {
  test('false while the text fits', () => {
    expect(editField('ABC', 'top', limited(5)).atLimit).toBe(false);
  });

  test('true once the clamp has to cut', () => {
    expect(editField('ABCDEF', 'top', limited(5)).atLimit).toBe(true);
  });

  test('exactly at the limit is not over it', () => {
    expect(editField('ABCDE', 'top', limited(5)).atLimit).toBe(false);
  });

  test('trailing whitespace alone does not report a full line', () => {
    // "AB " clamps to "AB", but nothing was lost, so the line is not full
    expect(editField('AB ', 'top', limited(2)).atLimit).toBe(false);
  });

  test('collapsing spaces does not look like truncation', () => {
    // "A  B" becomes "A B": shorter, but the user typed no excess
    expect(editField('A  B', 'top', limited(3)).atLimit).toBe(false);
  });

  test('a clamp that returns something unexpected still reports a limit', () => {
    const lossy = (t: string) => t.slice(0, 1);
    expect(editField('ABC', 'top', lossy).atLimit).toBe(true);
  });
});

describe('editField passes the field through', () => {
  test('each field is clamped independently', () => {
    const seen: Field[] = [];
    const spy = (t: string, f: Field) => { seen.push(f); return t; };
    editField('A', 'header', spy);
    editField('B', 'top', spy);
    editField('C', 'bottom', spy);
    expect(seen).toEqual(['header', 'top', 'bottom']);
  });
});
