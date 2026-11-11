#!/usr/bin/env python3
"""Compare a rendered card against the source photograph.

The app's loop is config -> render -> compare against `original.jpg`, so this
reports what the numbers in `src/config.ts` actually produce. Export a card
from the app (the Download button), then:

    just compare                     # preview/money-down.jpg vs original.jpg
    just compare path/to/export.jpg

Both images are 960x720 photo space, so they are warped through the same
homography and measured on the card plane, where the text is upright.

For each band it reports the lettering's ink box and the cap height of the
tallest flat-topped letter, plus the mean absolute difference over the whole
card. A diff image is written for eyeballing the residual.
"""
import sys
from pathlib import Path

import cv2
import numpy as np

sys.path.insert(0, str(Path(__file__).resolve().parent))
from geometry import CARD_H, CARD_W, MEASURED, MEASURED_HEADER, QUAD  # noqa: E402

ROOT = Path(__file__).resolve().parent.parent
SRC = ROOT / "assets" / "source" / "original.jpg"
DEFAULT_RENDER = ROOT / "preview" / "money-down.jpg"
DIFF = ROOT / "preview" / "compare-diff.png"

# the red pen marks are edits, not type: they hang past the letters and would
# exaggerate a band's height, so the lettering is measured without them
BANDS = {"H": MEASURED_HEADER, **MEASURED}


def to_card(img):
    src = np.array([QUAD[k] for k in ("TL", "TR", "BR", "BL")], np.float32)
    dst = np.array([[0, 0], [CARD_W, 0], [CARD_W, CARD_H], [0, CARD_H]],
                   np.float32)
    m = cv2.getPerspectiveTransform(src, dst)
    return cv2.warpPerspective(img, m, (CARD_W, CARD_H),
                               flags=cv2.INTER_LANCZOS4)


def red_mask(card):
    b, g, r = (card[..., i].astype(int) for i in range(3))
    return (r > 90) & (r > g + 45) & (r > b + 45)


def ink_box(card, box, name, exclude=()):
    """Ink bounding box of one band, in card pixels.

    The vertical extent is grown outward from the band's own baseline until the
    ink stops, rather than read from a fixed window: the bands sit only ~45px
    apart and a neighbouring line's ascenders cross the midpoint between them,
    so any window that large reports the wrong line's height.
    """
    x0, x1 = box["x0"], box["x1"]
    base = box["baseline"]
    lo, hi = max(0, base - 2 * box["cap"]), min(CARD_H, base + box["cap"])

    grey = cv2.cvtColor(card[lo:hi, max(0, x0 - 12):min(CARD_W, x1 + 12)],
                        cv2.COLOR_BGR2GRAY)
    ink = grey < 130
    for m in exclude:
        ink &= ~m[lo:hi, max(0, x0 - 12):min(CARD_W, x1 + 12)]

    rows = ink.any(axis=1)
    if not rows.any():
        return None

    # a printed rule runs most of the card's width; stop growth there, or the
    # header's ink run swallows the top rule a few rows under its baseline
    wide = ink.sum(axis=1) > 0.6 * CARD_W

    def limit(start, step, edge):
        y, blank = start, 0
        last = start
        while 0 <= y < len(rows) and y != edge:
            if wide[y] and y != start:
                break
            if rows[y]:
                last, blank = y, 0
            else:
                blank += 1
                if blank > 3:
                    break
            y += step
        return last

    at = min(max(base - lo, 0), len(rows) - 1)
    top = limit(at, -1, -1)
    bottom = limit(at, 1, len(rows))

    band = ink[top:bottom + 1]
    ys, xs = np.nonzero(band)
    if len(xs) == 0:
        return None
    return dict(
        x=int(xs.min()), y=int(ys.min() + top),
        w=int(xs.max() - xs.min() + 1),
        h=int(ys.max() - ys.min() + 1),
        area=int(band.sum()),
    )


def report(original, render, name):
    """Print one band's measurements and the render's error against the print."""
    a, b = original, render
    if a is None or b is None:
        print(f"  {name}: no ink found")
        return
    dw = b["w"] - a["w"]
    dh = b["h"] - a["h"]
    print(f"  {name}: printed {a['w']:3d}x{a['h']:2d}  "
          f"render {b['w']:3d}x{b['h']:2d}   "
          f"width {dw:+3d}px ({dw / a['w'] * 100:+5.1f}%)  "
          f"height {dh:+2d}px")


def main(argv):
    path = Path(argv[1]) if len(argv) > 1 else DEFAULT_RENDER
    if not path.is_absolute():
        path = ROOT / path
    if not path.exists():
        sys.exit(f"no render at {path} — export one from the app with the "
                 f"Download button")
    original = to_card(cv2.imread(str(SRC)))
    render = to_card(cv2.imread(str(path)))
    if render.shape != original.shape:
        render = cv2.resize(render, (original.shape[1], original.shape[0]))

    print(f"{path.name} vs {SRC.name}\n")
    print("lettering, red marks excluded:")
    ro, rr = red_mask(original), red_mask(render)
    for name, box in BANDS.items():
        report(ink_box(original, box, name, [ro]),
               ink_box(render, box, name, [rr]), name)

    # whole-card agreement, and a diff image for the eye
    diff = cv2.absdiff(original, render)
    print(f"\n  mean abs difference: {diff.mean():.2f}/255")

    DIFF.parent.mkdir(parents=True, exist_ok=True)
    cv2.imwrite(str(DIFF), cv2.resize(diff, None, fx=2, fy=2,
                                      interpolation=cv2.INTER_NEAREST))
    print(f"  wrote {DIFF}")


if __name__ == "__main__":
    main(sys.argv)
