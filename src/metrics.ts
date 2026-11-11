/**
 * Turning a desired cap height into a canvas font size.
 *
 * Canvas only takes a font size, but the card is specified in cap heights --
 * the height of a capital letter in card pixels. The conversion factor is a
 * property of the typeface (cap height / em), which EB Garamond sets at 0.6625.
 *
 * The ratio is not perfectly scale-invariant: rasterisers hint and round the
 * measured ascent, so a capital measured at 1000px reads slightly shorter per
 * unit than one measured at 40px. Probing at a size far from the one actually
 * drawn therefore bakes in a bias, so we solve at the target size instead.
 */

/** Size whose rendered cap is closest to `cap`, measuring at that size. */
export function sizeForCap(
  measureCap: (size: number) => number,
  cap: number,
  seedRatio: number,
  iterations = 4,
): number {
  let size = cap / seedRatio;
  for (let i = 0; i < iterations; i++) {
    const actual = measureCap(size);
    if (!(actual > 0)) break;
    const next = size * (cap / actual);
    // converged once the measured cap is within a thousandth of a pixel
    if (Math.abs(next - size) < 0.001) return next;
    size = next;
  }
  return size;
}
