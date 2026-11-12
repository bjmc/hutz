/**
 * The card-to-photo projection, as pure functions.
 *
 * The card is described in a flat rectangle (530x484) but drawn on a photograph
 * of a card held at an angle. A homography maps card points to photo pixels.
 *
 * Canvas2D cannot apply a projective matrix -- `setTransform` takes 3x2 and
 * silently drops the perspective terms. So each glyph is placed with the exact
 * Jacobian of the homography at that point: over one glyph the map is near
 * affine, and the local derivative is affine by construction.
 */

/** Row-major 3x3 inverse. Throws if the matrix is singular. */
export function invert3x3(m: readonly number[]): number[] {
  if (m.length !== 9) throw new Error('expected a 3x3 matrix');
  const [a, b, c, d, e, f, g, h, i] = m as [
    number, number, number, number, number, number, number, number, number,
  ];

  const A = e * i - f * h;
  const B = -(d * i - f * g);
  const C = d * h - e * g;
  const det = a * A + b * B + c * C;
  if (det === 0) throw new Error('matrix is not invertible');

  return [
    A / det, -(b * i - c * h) / det, (b * f - c * e) / det,
    B / det, (a * i - c * g) / det, -(a * f - c * d) / det,
    C / det, -(a * h - b * g) / det, (a * e - b * d) / det,
  ];
}

/**
 * The affine that best approximates `inv` at a point, as a canvas transform.
 *
 * `inv` must map card space to photo space. The result places a glyph so its
 * origin lands on the projected point and its axes follow the local derivative,
 * which is what makes upright card lettering appear correctly foreshortened on
 * the photograph. The canvas applies it; see the module comment.
 */
export function localTransform(
  inv: readonly number[],
  x: number,
  y: number,
): [number, number, number, number, number, number] {
  const w = inv[6]! * x + inv[7]! * y + inv[8]!;
  const u = (inv[0]! * x + inv[1]! * y + inv[2]!) / w;
  const v = (inv[3]! * x + inv[4]! * y + inv[5]!) / w;

  // analytic Jacobian of the projective map at this point
  const a = (inv[0]! - u * inv[6]!) / w;
  const c = (inv[1]! - u * inv[7]!) / w;
  const b = (inv[3]! - v * inv[6]!) / w;
  const d = (inv[4]! - v * inv[7]!) / w;
  return [a, b, c, d, u - a * x - c * y, v - b * x - d * y];
}
