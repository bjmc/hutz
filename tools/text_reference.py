#!/usr/bin/env python3
"""Extract text-only reference strips for font matching.

Red punctuation is traced SVG, not a font glyph, so it must be excluded or it
drags the fit.
"""
import sys
from pathlib import Path

import cv2
import numpy as np

sys.path.insert(0, str(Path(__file__).resolve().parent))
from build_assets import (DEBUG, handwriting_mask,  # noqa: E402
                          segmentation)

# line band -> the text without punctuation. The comma is a traced red mark, so
# it is not part of the font text and the mask below must not include it.
REF = {
    "A": (24, 64, "WORKS ON"),
    "B": (68, 106, "CONTINGENCY"),
    "C": (154, 192, "NO MONEY DOWN"),
}


def main():
    DEBUG.mkdir(parents=True, exist_ok=True)
    _img, _roi, colour, ink, _angle, _M = segmentation()
    hand = handwriting_mask(ink, colour)

    b, g, r = cv2.split(colour.astype(np.int16))
    red = (r - (g + b) // 2) > 45
    dark = ((hand > 0) & ~red).astype(np.uint8)

    out = {}
    for band, (y0, y1, text) in REF.items():
        seg = dark[y0:y1 + 6]
        ys, xs = np.nonzero(seg)
        crop = seg[ys.min():ys.max() + 1, xs.min():xs.max() + 1]
        cv2.imwrite(str(DEBUG / f"text_{band}.png"), (1 - crop) * 255)
        h, w = crop.shape
        # cap height from the tallest solid column run
        rows = crop.sum(1)
        out[band] = dict(text=text, w=int(w), h=int(h),
                         ink=int(crop.sum()), rows=rows.tolist())
        print(f"{band} '{text}': {w}x{h}  ink {crop.sum()}")

    a, bb = out["A"], out["B"]
    print(f"\nA/B width ratio {a['w'] / bb['w']:.3f} "
          f"(chars {len(a['text']) - 1}/{len(bb['text'])})")
    print("text-only strips ->", DEBUG)


if __name__ == "__main__":
    main()
