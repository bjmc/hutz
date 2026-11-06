#!/usr/bin/env python3
"""Emit the geometry + typography constants the web app renders from.

Everything here is measured from the card, so the app never guesses: the
deskew matrix, per-line baselines and cap heights, the red marks, and the
tracking/word-space that reproduce the original line widths.
"""
import base64
import json
from pathlib import Path

import numpy as np
from PIL import Image, ImageDraw, ImageFont

ROOT = Path(__file__).resolve().parent.parent
ASSETS = ROOT / "assets"
# the shipped font itself, so regenerating needs no download cache
FONT = ASSETS / "fonts" / "card-italic.woff2"
OUT = ROOT / "src" / "config.ts"

LINE_TEXT = {"A": "WORKS ON", "B": "CONTINGENCY", "C": "NO MONEY DOWN"}
# Measured dark-ink extents and baselines in deskewed space. x1 is the *letter*
# extent: the red marks are appended after the text and hang past it, so
# including them here would over-spread the justification. fit_x1 is the card's
# usable right edge, which is the limit a mark may run out to.
MEASURED = {
    "A": dict(x0=78, x1=310, fit_x1=411, baseline=59, cap=30),
    "B": dict(x0=52, x1=341, fit_x1=411, baseline=102, cap=29),
    "C": dict(x0=3, x1=379, fit_x1=411, baseline=187, cap=28),
}
# Card corners, in photo pixels, measured once by hand off the photo. These
# constants are now the source of truth for the drawing bounds: the derived
# numbers live in src/config.ts under `fields`, so tweak those to adjust the
# layout rather than re-measuring. The bottom-right corner is torn, but no line
# of text reaches that far down.
CORNERS = {
    "TL": (251.6, 183.0),
    "TR": (758.5, 80.5),
    "BR": (780.3, 490.5),
    "BL": (268.5, 660.6),
}
# breathing room inside the printed edge, in card-space pixels
CARD_PAD = 14
# the red marks may hang out to here; the letters stop short of it
MARK_RIGHT = 411.0
# which measured line each traced mark came from
MARK_LINE = {"qmark": "B", "bang": "C", "comma": "C", "period": "C"}
MARK_CHAR = {"?": "qmark", "!": "bang", ",": "comma", ".": "period"}


def cap_ratio(ttf):
    """Cap height as a fraction of em, straight from the font's own metrics."""
    font = ImageFont.truetype(str(ttf), 400)
    b = font.getbbox("H")
    return (b[3] - b[1]) / 400.0


def advance_ratio(ttf):
    font = ImageFont.truetype(str(ttf), 400)
    return font.getlength("M") / 400.0


def ink_widths(ttf, text, size):
    """Ink width of each glyph, in px, at `size`. Spaces report zero."""
    font = ImageFont.truetype(str(ttf), size)
    out = []
    for ch in text:
        if ch == " ":
            out.append(0.0)
            continue
        b = font.getbbox(ch)
        img = Image.new("L", (b[2] + 60, size * 3), 255)
        ImageDraw.Draw(img).text((30 - b[0], size), ch, font=font, fill=0)
        cols = np.nonzero((np.asarray(img) < 128).any(0))[0]
        out.append(float(cols.max() - cols.min() + 1))
    return out


def word_space_ratio():
    """Word gap as a multiple of cap height, from the measured gaps.

    A: 25 px at cap 30, C: 23 px at cap 28 -- the card's own spacing, which the
    app keeps so wrapped text looks like the same hand.
    """
    return 0.83


def card_edges(m, roi):
    """Usable card width at each band's height, from the corner constants.

    The card is a trapezoid: its left edge leans as it descends, so the width
    available differs per band. Interpolate each edge between its two corners.
    """
    def to_card(px, py):
        v = m @ np.array([px - roi["x"], py - roi["y"], 1.0])
        return float(v[0]), float(v[1])

    c = {k: to_card(*p) for k, p in CORNERS.items()}

    def edge(top, bottom, y):
        (x0, y0), (x1, y1) = c[top], c[bottom]
        t = (y - y0) / (y1 - y0)
        return x0 + t * (x1 - x0)

    out = {}
    for band, d in MEASURED.items():
        y = d["baseline"] - d["cap"] / 2
        left = edge("TL", "BL", y) + CARD_PAD
        right = edge("TR", "BR", y) - CARD_PAD
        out[band] = (round(left, 1), round(right, 1))
    return out


def field_bounds(edges, field_of):
    """The centred box each field is typeset in, and how far it may grow.

    Both original lines share a centre, so one rectangle reproduces the
    original appearance: centred, wrapped. The box is sized to the *letters*,
    not to the red marks -- a mark is an edit squeezed in afterwards and is
    allowed to hang past the last letter, so including it here would leave a
    permanent gap at the right of every line. `min_x`/`max_x` are the card's own
    edges, so each side grows to its own limit.
    """
    out = {}
    for field in ("top", "bottom"):
        bands = [b for b in MEASURED if field_of[b] == field]
        left = min(MEASURED[b]["x0"] for b in bands)
        right = max(MEASURED[b]["x1"] for b in bands)
        center = (left + right) / 2
        out[field] = dict(
            center=round(center, 1),
            half=round((right - left) / 2, 1),
            min_x=round(min(edges[b][0] for b in bands), 1),
            max_x=round(max(edges[b][1] for b in bands), 1),
        )
    return out


def build_marks(manifest):
    """Place each traced mark against the baseline of the line it was drawn on.

    The vector ships inline as a data URI so the app has nothing to fetch.
    """
    out = []
    for m in manifest["marks"]:
        band = MARK_LINE[m["name"]]
        line = MEASURED[band]
        svg = (ASSETS / "punct" / f"{m['name']}.svg").read_text().strip()
        out.append(dict(
            name=m["name"],
            char=next(c for c, n in MARK_CHAR.items() if n == m["name"]),
            w=m["w"], h=m["h"],
            dy=(m["y"] + m["h"]) - line["baseline"],
            cap=line["cap"],
            uri="data:image/svg+xml;base64," +
                base64.b64encode(svg.encode()).decode(),
        ))
    return out


def ink_colour():
    """Core ink colour, excluding the red punctuation.

    The mean is lifted by antialiasing, so take the darkest neutral pixels --
    that is what the stroke actually deposits on the paper.
    """
    import cv2
    import sys
    sys.path.insert(0, str(Path(__file__).resolve().parent))
    from build_assets import (BANDS, handwriting_mask,  # noqa: E402
                              segmentation)

    _img, _roi, colour, ink, _angle, _m = segmentation()
    hand = handwriting_mask(ink, colour)
    b, g, r = cv2.split(colour.astype(np.int16))
    red = (r - (g + b) // 2) > 45
    lum = cv2.cvtColor(colour, cv2.COLOR_BGR2GRAY)

    keep = np.zeros(colour.shape[:2], bool)
    for _band, y0, y1, _f, _t, _slack in BANDS:
        keep[y0:y1 + 6] = True
    px = colour[keep & (hand > 0) & ~red & (lum < 75)]
    bgr = np.median(px, axis=0)
    return [int(round(v)) for v in bgr[::-1]]


def main():
    manifest = json.loads((ASSETS / "punct" / "manifest.json").read_text())

    # the deskew matrix, spelled out so the app can invert it exactly
    import cv2
    w, h = manifest["roi"]["w"], manifest["roi"]["h"]
    angle = manifest["deskew_deg"]
    m = cv2.getRotationMatrix2D((w / 2, h / 2), angle, 1.0)

    lines = [dict(band=b, field=next(l["field"] for l in manifest["lines"]
                                     if l["band"] == b), **MEASURED[b])
             for b in "ABC"]
    edges = card_edges(m, manifest["roi"])
    fields = field_bounds(edges, {b: next(l["field"] for l in manifest["lines"]
                                           if l["band"] == b) for b in "ABC"})
    mark_list = build_marks(manifest)

    # OpenCV returns [m00, m01, m02, m10, m11, m12]; canvas setTransform takes
    # (a, b, c, d, e, f) as [[a, c, e], [b, d, f]]. Same matrix, different order.
    m00, m01, m02, m10, m11, m12 = m.flatten()

    cfg = dict(
        source=[manifest["source"]["width"], manifest["source"]["height"]],
        roi=manifest["roi"],
        deskew=[round(float(v), 6) for v in (m00, m10, m01, m11, m02, m12)],
        ink={"colour": ink_colour()},
        font=dict(
            family="CardItalic",
            cap_ratio=round(cap_ratio(FONT), 5),
            advance_ratio=round(advance_ratio(FONT), 5),
            word_space=word_space_ratio(),
        ),
        lines=lines,
        fields=fields,
        marks=mark_list,
    )

    body = json.dumps(cfg, indent=2)
    OUT.parent.mkdir(parents=True, exist_ok=True)
    OUT.write_text(
        "// Generated by tools/gen_config.py -- do not edit by hand.\n"
        "import type { CardConfig } from './types';\n\n"
        f"export const CONFIG: CardConfig = {body};\n")
    print(f"wrote {OUT.relative_to(ROOT)}")
    print(f"  word space {word_space_ratio():.3f} cap")
    for band in "ABC":
        d = MEASURED[band]
        print(f"  {band} cap {d['cap']} baseline {d['baseline']} "
              f"x {d['x0']}..{d['x1']}")
    for m in mark_list:
        print(f"  {m['char']} {m['name']:7s} {m['w']}x{m['h']} "
              f"dy {m['dy']:+d} at cap {m['cap']}")


if __name__ == "__main__":
    main()
