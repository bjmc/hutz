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

# The card's usable rows in card space. The homography maps the quad slightly
# beyond the printed face, so the first few and last few rows are the dark photo
# edge rather than card. The top rule sits at 87-89, the border at 481-483.
RULE_TOP, RULE_BOTTOM = 10, 480


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
    # the card's printed rules bound the lettering; starting outside them would
    # measure the dark photo edge, which bleeds into the first and last rows
    lo = max(RULE_TOP, base - 2 * box["cap"])
    hi = min(RULE_BOTTOM, base + box["cap"])

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
    full = cv2.cvtColor(card[lo:hi], cv2.COLOR_BGR2GRAY) < 130
    wide = (full & ~np.any([e[lo:hi] for e in exclude], axis=0)).sum(axis=1) \
        > 0.6 * CARD_W

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


def signed_diff(original, render):
    """Colour the two images against each other instead of a grey magnitude.

    Greyscale difference cannot say *which* image a pixel came from, so a
    systematic offset looks the same as random noise. Here each image owns one
    colour channel: ink in the print darkens green, ink in the render darkens
    red and blue. That way

      paper       -> white
      both inked  -> black
      print only  -> magenta (its channel is the one still lit)
      render only -> green

    Only the text region is returned. The rules, the scales logo and the
    photograph's dark border are identical in both images by construction, so
    they always agree and say nothing about the lettering.
    """
    def darkness(img):
        grey = cv2.cvtColor(img, cv2.COLOR_BGR2GRAY).astype(np.float32)
        # 0 on bare paper, 1 on solid ink
        return np.clip((210 - grey) / 170, 0, 1)

    dark_o = darkness(original)
    dark_r = darkness(render)

    out = np.empty_like(original)
    out[..., 0] = 255 * (1 - dark_r)   # B
    out[..., 1] = 255 * (1 - dark_o)   # G
    out[..., 2] = 255 * (1 - dark_r)   # R

    y0 = max(RULE_TOP, min(b["baseline"] - 2 * b["cap"] for b in BANDS.values()))
    y1 = min(RULE_BOTTOM, max(b["baseline"] + b["cap"] + 8
                              for b in BANDS.values()))
    x0 = max(0, min(b["x0"] for b in BANDS.values()) - 20)
    x1 = min(CARD_W, max(b["x1"] for b in BANDS.values()) + 20)
    return out[y0:y1, x0:x1]


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

    # whole-card agreement, and a signed diff image for the eye
    diff = cv2.absdiff(original, render)
    print(f"\n  mean abs difference: {diff.mean():.2f}/255")

    DIFF.parent.mkdir(parents=True, exist_ok=True)
    cv2.imwrite(str(DIFF), cv2.resize(signed_diff(original, render),
                                      None, fx=2, fy=2,
                                      interpolation=cv2.INTER_NEAREST))
    print(f"  wrote {DIFF}  (magenta = only in the print, "
          f"green = only in the render)")


if __name__ == "__main__":
    main(sys.argv)
