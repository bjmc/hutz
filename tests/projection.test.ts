import { describe, expect, test } from 'bun:test';

import { invert3x3, localTransform } from '../src/projection';
import { CONFIG } from '../src/config';

/**
 * Test-side reference implementations.
 *
 * The app only ever needs the local affine that Canvas applies, so neither of
 * these is shipped. They live here to state what that affine *means*: `project`
 * is the projective map `localTransform` must agree with, and `applyTransform`
 * evaluates a canvas transform so a test can ask where it puts a point.
 */

/** Apply a row-major 3x3 homography to a point, dividing through by w. */
function project(
  m: readonly number[],
  x: number,
  y: number,
): [number, number] {
  const w = m[6]! * x + m[7]! * y + m[8]!;
  return [
    (m[0]! * x + m[1]! * y + m[2]!) / w,
    (m[3]! * x + m[4]! * y + m[5]!) / w,
  ];
}

/** Apply a canvas transform to a point. */
function applyTransform(
  t: readonly [number, number, number, number, number, number],
  x: number,
  y: number,
): [number, number] {
  return [t[0] * x + t[2] * y + t[4], t[1] * x + t[3] * y + t[5]];
}

const IDENTITY = [1, 0, 0, 0, 1, 0, 0, 0, 1];

/** Multiply two row-major 3x3 matrices. */
function mul(a: readonly number[], b: readonly number[]): number[] {
  const out = new Array<number>(9).fill(0);
  for (let r = 0; r < 3; r++) {
    for (let c = 0; c < 3; c++) {
      out[r * 3 + c] =
        a[r * 3]! * b[c]! +
        a[r * 3 + 1]! * b[3 + c]! +
        a[r * 3 + 2]! * b[6 + c]!;
    }
  }
  return out;
}

/** Element-wise numeric comparison, so `-0` and `0` count as equal. */
function expectClose(actual: readonly number[], expected: readonly number[]) {
  expect(actual).toHaveLength(expected.length);
  for (let i = 0; i < expected.length; i++) {
    expect(actual[i]!).toBeCloseTo(expected[i]!, 9);
  }
}

describe('invert3x3', () => {
  test('inverts the identity to itself', () => {
    expectClose(invert3x3(IDENTITY), IDENTITY);
  });

  test('a matrix times its inverse is the identity', () => {
    const m = CONFIG.homography;
    const product = mul(m, invert3x3(m));
    expectClose(product, IDENTITY);
  });

  test('scaling is inverted by scaling reciprocally', () => {
    const scale = [2, 0, 0, 0, 4, 0, 0, 0, 1];
    expectClose(invert3x3(scale), [0.5, 0, 0, 0, 0.25, 0, 0, 0, 1]);
  });

  test('translation is inverted by the negated offset', () => {
    const shift = [1, 0, 5, 0, 1, -3, 0, 0, 1];
    expectClose(invert3x3(shift), [1, 0, -5, 0, 1, 3, 0, 0, 1]);
  });

  test('a singular matrix throws rather than producing infinities', () => {
    // every row identical: no inverse exists
    expect(() => invert3x3([1, 1, 1, 1, 1, 1, 1, 1, 1])).toThrow(/not invertible/);
  });

  test('a non-3x3 input is rejected', () => {
    expect(() => invert3x3([1, 0, 0, 1])).toThrow(/3x3/);
  });

  test('inverting twice returns the original', () => {
    const m = CONFIG.homography;
    expectClose(invert3x3(invert3x3(m)), m);
  });
});

describe('project', () => {
  test('the identity leaves points alone', () => {
    expectClose(project(IDENTITY, 12, -7), [12, -7]);
  });

  test('translation shifts a point', () => {
    expectClose(project([1, 0, 10, 0, 1, -4, 0, 0, 1], 3, 3), [13, -1]);
  });

  test('divides through by the perspective term', () => {
    // w = 1 + 0.5x, so x=2 maps to 2/2 = 1
    const m = [1, 0, 0, 0, 1, 0, 0.5, 0, 1];
    const [x, y] = project(m, 2, 4);
    expect(x).toBeCloseTo(1, 9);
    expect(y).toBeCloseTo(2, 9);
  });

  test('card corners map inside the photo', () => {
    const inv = invert3x3(CONFIG.homography);
    for (const [cx, cy] of [[0, 0], [530, 0], [530, 484], [0, 484]]) {
      const [px, py] = project(inv, cx!, cy!);
      expect(px).toBeGreaterThanOrEqual(0);
      expect(px).toBeLessThanOrEqual(960);
      expect(py).toBeGreaterThanOrEqual(0);
      expect(py).toBeLessThanOrEqual(720);
    }
  });
});

describe('localTransform', () => {
  test('the identity yields the identity transform', () => {
    expectClose(localTransform(IDENTITY, 0, 0), [1, 0, 0, 1, 0, 0]);
  });

  test('the origin of a translated map lands on the offset', () => {
    const t = localTransform([1, 0, 10, 0, 1, -4, 0, 0, 1], 0, 0);
    expectClose(applyTransform(t, 0, 0), [10, -4]);
  });

  test('the transform places its own point on its projection', () => {
    // this is the invariant that matters: whatever the Jacobian says, the
    // glyph origin must land exactly where the projective map puts it
    const inv = invert3x3(CONFIG.homography);
    for (const [x, y] of [[0, 0], [261, 79], [124, 173], [443, 304], [530, 484]]) {
      const placed = applyTransform(localTransform(inv, x!, y!), x!, y!);
      const expected = project(inv, x!, y!);
      expect(placed[0]).toBeCloseTo(expected[0], 6);
      expect(placed[1]).toBeCloseTo(expected[1], 6);
    }
  });

  test('nearby points move consistently with the projected map', () => {
    // the affine is a derivative: over a short step it must agree with the
    // projective map to within the curvature of the homography
    const inv = invert3x3(CONFIG.homography);
    const x = 261, y = 173, h = 0.5;

    const affine = localTransform(inv, x, y);
    const stepped = applyTransform(affine, x + h, y);
    const exact = project(inv, x + h, y);

    expect(stepped[0]).toBeCloseTo(exact[0], 1);
    expect(stepped[1]).toBeCloseTo(exact[1], 1);
  });

  test('the linear part reflects the local scale of the projection', () => {
    // shrinking the map must shrink the transform's determinant
    const inset = localTransform([0.5, 0, 0, 0, 0.5, 0, 0, 0, 1], 10, 10);
    const det = inset[0] * inset[3] - inset[1] * inset[2];
    expect(det).toBeCloseTo(0.25, 9);
  });

  test('a pure rotation passes through with the right angle', () => {
    const t90 = [0, -1, 0, 1, 0, 0, 0, 0, 1];
    const t = localTransform(t90, 0, 0);
    // the x axis should now point along +y
    const [x, y] = applyTransform(t, 1, 0);
    expect(x).toBeCloseTo(0, 9);
    expect(y).toBeCloseTo(1, 9);
  });
});

describe('applyTransform', () => {
  test('composes translation after the linear part', () => {
    expectClose(applyTransform([1, 0, 0, 1, 5, 7], 1, 1), [6, 8]);
  });

  test('is the identity for the identity transform', () => {
    expectClose(applyTransform([1, 0, 0, 1, 0, 0], 3, -9), [3, -9]);
  });
});
