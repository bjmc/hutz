#!/usr/bin/env python3
"""Emit the geometry + typography constants the web app renders from.

Everything here is measured from the card, so the app never guesses: the
deskew matrix, per-line baselines and cap heights, the red marks, and the
tracking/word-space that reproduce the original line widths.
"""
import base64
import json
import math
from pathlib import Path

import numpy as np
from PIL import Image, ImageDraw, ImageFont

ROOT = Path(__file__).resolve().parent.parent
ASSETS = ROOT / "assets"
# the shipped font itself, so regenerating needs no download cache
FONT = ASSETS / "fonts" / "card-font.woff2"
# the weight `tools/vendor_font.py` instantiates the variable font at; the app
# asks for the same one so the browser picks the face we measured
FONT_WEIGHT = 500
OUT = ROOT / "src" / "config.ts"

LINE_TEXT = {"A": "WORKS ON", "B": "CONTINGENCY", "C": "NO MONEY DOWN"}
# Measured dark-ink extents and baselines in deskewed space. x1 is the *letter*
# extent: the red marks are appended after the text and hang past it, so
# including them here would over-spread the justification. fit_x1 is the card's
# usable right edge, which is the limit a mark may run out to.
# The card is photographed with perspective, so the correction is a homography
# fitted to the four printed border rules (see tools/fit_borders.py). A pure
# rotation cannot square the card: it levels the top/bottom rules but leaves the
# sides sheared, which makes upright lettering measure as italic.
QUAD = {
    "TL": (245.29709, 178.12656),
    "TR": (764.42084, 72.32128),
    "BR": (789.44867, 554.71550),
    "BL": (265.98930, 663.23865),
}
CARD_W, CARD_H = 530, 484     # the rectangle the quad maps onto

MEASURED = {
    "A": dict(x0=124, x1=353, baseline=173, cap=27),
    "B": dict(x0=107, x1=391, baseline=218, cap=28),
    "C": dict(x0=74, x1=443, baseline=304, cap=27),
}
# The printed name at the top of the card, in the same card space. It is set
# larger than the body text: ink runs x 53..470, y 36..79, so the baseline is 79
# and the cap 41. Bounds come from the ink, not the card edge, because the
# whole point of the field is to replace a line that was already typeset.
MEASURED_HEADER = dict(x0=53, x1=470, baseline=79, cap=41)
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
# The card has no colon or semicolon, so these are stacked from the shapes it
# does have. A period's dot traces narrower than a comma's, so it is scaled to
# match; the comma stays at its traced size.
COMPOSED = {
    ":": ("period", "period"),
    ";": ("comma", "period"),
}
PERIOD_DOT_SCALE = 1.12
DOT_GAP = 0.02      # of cap, clearance between the stacked marks
DOT_PAD = 0.26      # of cap, extra advance so a stacked mark clears the letter

# The dash is the bang's stroke, dot removed and rotated flat (tools/make_dash.py).
# Only its length varies between hyphen and en/em dash; the thickness is held
# constant so all three read as the same pen. Drawn stretched, which Canvas does
# natively, so the taper is preserved.
DASH_SVG = "dash"
DASH_THICK = 0.20                  # of cap; a bar needs to be much longer than thick
DASHES = {
    "-": 0.62,                     # of cap; hyphen
    "–": 0.95,                # en dash
    "—": 1.30,                # em dash
}
DASH_LIFT = 0.40                   # of cap, centre above the baseline
DASH_PAD = 0.20                    # of cap, breathing room either side

# Double marks built from the dash: two parallel bars, or a cross. `gap` is the
# clearance between the bars and `rel` their length, both fractions of cap.
PAIR_REL = 0.72
PAIR_GAP = 0.30
# Angled marks are the same bar turned about its centre; chevrons stack two of
# them apex to apex. Lengths are fractions of cap.
SLASH_REL = 0.92
CHEVRON_REL = 0.52


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
    """Word gap as a multiple of cap height.

    The font's own space is 0.32 cap, which sets the card's lines about 10%
    narrower than the printed lettering; the printed word gaps measure closer
    to 0.9-1.0 cap.
    """
    return 1.0


def tracking_ratio():
    """Per-glyph tracking, as a fraction of the em.

    The printed lettering is ticked in about 0.05em tighter than the font's
    default advances, which is what brings the long lines down to their
    measured widths.
    """
    return -0.05


def card_edges():
    """Usable width per band. The homography squares the card, so it is the
    card box inset by the padding, the same at every height."""
    return {band: (CARD_PAD, CARD_W - CARD_PAD) for band in MEASURED}


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


def header_bounds(edge):
    """The box the header is typeset in: one line, spanning the name's own width.

    Unlike the body, the header never wraps -- a name is short -- so the box is
    the printed name's extent and it may grow to the card edges.
    """
    left = MEASURED_HEADER["x0"]
    right = MEASURED_HEADER["x1"]
    return dict(center=round((left + right) / 2, 1),
                half=round((right - left) / 2, 1),
                min_x=round(edge[0], 1), max_x=round(edge[1], 1))


# the period is not used by the default meme, so it is scaled from the bang
PERIOD_FROM_BANG = dict(w=18 / 34, h=17 / 65)
PERIOD_LIFT = 5   # px above the baseline for a period's bottom edge


def mark_parts(manifest):
    """Each traced mark as (svg, dx, dy, w, h), dy being its bottom offset.

    The box comes from the trace itself: `build_assets` already measured where
    the mark sits in the card plane, and a separate hand-measured box would
    stretch the vector to a slightly different shape.
    """
    manual = {
        "qmark": dict(x=394, y=158, w=44, h=78),
        "comma": dict(x=135, y=293, w=20, h=20),
        "bang": dict(x=442, y=242, w=29, h=63),
    }
    traced = {m["name"]: m for m in manifest["marks"]}

    parts = {}
    for name in MARK_LINE:
        line = MEASURED[MARK_LINE[name]]
        svg = (ASSETS / "punct" / f"{name}.svg").read_text().strip()
        t = traced.get(name)
        box = dict(x=t["x"], y=t["y"], w=t["w"], h=t["h"]) if t else manual.get(name)
        if box is None:
            # the period is not in the default meme; scale it from the bang
            bang = traced.get("bang") or manual["bang"]
            w = round(bang["w"] * PERIOD_FROM_BANG["w"] / (29 / 34))
            h = round(bang["h"] * PERIOD_FROM_BANG["h"] / (63 / 65))
            # sit just above the baseline, as a period does
            y = line["baseline"] - h + PERIOD_LIFT
            box = dict(x=0, y=y, w=w, h=h)
        dy = (box["y"] + box["h"]) - line["baseline"]
        parts[name] = (svg, 0, dy, box["w"], box["h"])
    return parts


def build_marks(manifest):
    """Place each mark against the baseline of its line.

    The vector ships inline as a data URI so the app has nothing to fetch.
    """
    parts = mark_parts(manifest)

    def encode(part, name, rot=0):
        # the SVG file is named, not inlined: the app imports it, so the vector
        # lives in assets/ only, and a reused shape is not duplicated per mark
        _svg, dx, dy, w, h = part
        return dict(svg=name, dx=dx, bottom=dy, w=w, h=h, rot=rot)

    out = []
    for char, name in MARK_CHAR.items():
        p = parts[name]
        out.append(dict(
            name=name, char=char,
            w=p[3], h=p[4], bottom=p[2], cap=MEASURED[MARK_LINE[name]]["cap"],
            pad=0.0, parts=[encode(p, name)],
        ))

    # dashes: one traced stroke, three lengths, one thickness
    cap = MEASURED["C"]["cap"]
    dash_svg = (ASSETS / "punct" / f"{DASH_SVG}.svg").read_text().strip()
    thick = DASH_THICK * cap
    for char, rel in DASHES.items():
        length = rel * cap
        h = thick
        # box bottom relative to the baseline; negative sits above it
        dy = -(DASH_LIFT * cap - h / 2)
        out.append(dict(
            name=char, char=char,
            w=round(length, 1), h=round(h, 1), bottom=round(dy, 1),
            cap=cap, pad=DASH_PAD,
            # dash.svg is already horizontal, so no rotation is needed
            parts=[encode((dash_svg, 0, round(dy, 1), round(length, 1), round(h, 1)),
                          DASH_SVG, 0)],
        ))

    # marks built from rotated copies of the horizontal dash bar
    def extent(length, thick_, rot):
        a = math.radians(rot)
        return (abs(length * math.cos(a)) + abs(thick_ * math.sin(a)),
                abs(length * math.sin(a)) + abs(thick_ * math.cos(a)))

    def angled(char, pieces):
        """Assemble a mark from rotated bars, optically centred on the dash.

        `pieces` are (centre_x, centre_y_above_baseline, length, thick, rot).
        Rotation is about the box centre, so a piece's visual centre is its box
        centre; only its extent changes.
        """
        spans = [extent(q[2], q[3], q[4]) for q in pieces]
        y0 = min(q[1] - s[1] / 2 for q, s in zip(pieces, spans))
        y1 = max(q[1] + s[1] / 2 for q, s in zip(pieces, spans))
        lift = DASH_LIFT * cap - (y0 + y1) / 2
        pieces = [(cx, cy + lift, *rest) for cx, cy, *rest in pieces]
        y0 += lift
        y1 += lift
        spans = [extent(q[2], q[3], q[4]) for q in pieces]
        x0 = min(q[0] - s[0] / 2 for q, s in zip(pieces, spans))
        x1 = max(q[0] + s[0] / 2 for q, s in zip(pieces, spans))
        parts = []
        for (cx, cy, length, thick_, rot), span in zip(pieces, spans):
            # dx and bottom position the pre-rotation box, whose centre is the
            # visual centre once the canvas rotates it in place
            parts.append(encode(
                (dash_svg, round(cx - x0 - length / 2, 1),
                 round(thick_ / 2 - cy, 1), round(length, 1),
                 round(thick_, 1)), DASH_SVG, rot))
        out.append(dict(
            name=char, char=char,
            w=round(x1 - x0, 1), h=round(y1 - y0, 1), bottom=round(-y0, 1),
            cap=cap, pad=DASH_PAD, parts=parts,
        ))

    base = DASH_LIFT * cap
    bar = PAIR_REL * cap
    pair_gap = PAIR_GAP * cap

    angled("=", [(bar / 2, base - pair_gap / 2, bar, thick, 0),
                 (bar / 2, base + pair_gap / 2, bar, thick, 0)])
    angled("+", [(bar / 2, base, bar, thick, 0),
                 (bar / 2, base, bar, thick, 90)])

    slash = SLASH_REL * cap
    angled("/", [(0, base, slash, thick, -45)])
    angled("\\", [(0, base, slash, thick, 45)])

    # chevrons: two strokes meeting at an apex, mirrored for each direction
    chev = CHEVRON_REL * cap
    d = chev / math.sqrt(2)
    angled("<", [(d / 2, base + d / 2, chev, thick, -45),
                 (d / 2, base - d / 2, chev, thick, 45)])
    angled(">", [(-d / 2, base + d / 2, chev, thick, 45),
                 (-d / 2, base - d / 2, chev, thick, -45)])

    for char, (lower, upper) in COMPOSED.items():
        cap = MEASURED["C"]["cap"]
        low_svg, low_dx, low_dy, low_w, low_h = parts[lower]
        up_svg, up_dx, up_dy, up_w, up_h = parts[upper]
        if upper == "period":
            s = PERIOD_DOT_SCALE
            up_w, up_h, up_dy = up_w * s, up_h * s, up_dy * s
        # lift the upper mark so its bottom clears the lower mark's top
        up_dy -= low_h + DOT_GAP * cap
        pieces = [
            (low_svg, low_dx, round(low_dy, 1), round(low_w, 1), round(low_h, 1)),
            (up_svg, up_dx, round(up_dy, 1), round(up_w, 1), round(up_h, 1)),
        ]
        top = min(q[2] - q[4] for q in pieces)
        bottom = max(q[2] for q in pieces)
        out.append(dict(
            name=char, char=char,
            w=max(q[3] for q in pieces),
            h=round(bottom - top, 1),
            bottom=round(bottom, 1),
            cap=cap, pad=DOT_PAD,
            parts=[encode(q, n) for q, n in zip(pieces, (lower, upper))],
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

    # the card correction, as a full homography from photo to card plane
    import cv2
    src = np.array([QUAD["TL"], QUAD["TR"], QUAD["BR"], QUAD["BL"]], np.float32)
    dst = np.array([[0, 0], [CARD_W, 0], [CARD_W, CARD_H], [0, CARD_H]],
                   np.float32)
    m = cv2.getPerspectiveTransform(src, dst)

    lines = [dict(band=b, field=next(l["field"] for l in manifest["lines"]
                                     if l["band"] == b), **MEASURED[b])
             for b in "ABC"]
    # the header is one unwrapped line above the body, with its own size
    lines.insert(0, dict(band="H", field="header", **MEASURED_HEADER))
    edges = card_edges()
    fields = field_bounds(edges, {b: next(l["field"] for l in manifest["lines"]
                                           if l["band"] == b) for b in "ABC"})
    fields["header"] = header_bounds(edges["A"])
    mark_list = build_marks(manifest)

    # the full 3x3, row-major; render.ts maps points through it in JS
    homography = [round(float(v), 8) for v in m.flatten()]

    cfg = dict(
        source=[manifest["source"]["width"], manifest["source"]["height"]],
        roi=manifest["roi"],
        card=[CARD_W, CARD_H],
        homography=homography,
        ink={"colour": ink_colour()},
        font=dict(
            family="CardFont",
            weight=FONT_WEIGHT,
            cap_ratio=round(cap_ratio(FONT), 5),
            advance_ratio=round(advance_ratio(FONT), 5),
            word_space=word_space_ratio(),
            tracking=tracking_ratio(),
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
    print(f"  tracking {tracking_ratio():+.3f} em")
    for band in "ABC":
        d = MEASURED[band]
        print(f"  {band} cap {d['cap']} baseline {d['baseline']} "
              f"x {d['x0']}..{d['x1']}")
    for m in mark_list:
        print(f"  {m['char']} {m['name']:7s} {m['w']}x{m['h']} "
              f"bottom {m['bottom']:+} at cap {m['cap']}")


if __name__ == "__main__":
    main()
