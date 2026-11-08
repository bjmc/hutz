#!/usr/bin/env python3
"""Draw the text bounds on the photo, using the app's own projection.

Mirrors src/render.ts: points are mapped through the inverse homography, so what
this draws is exactly where the app puts text.
"""
from pathlib import Path

import json

import cv2
import numpy as np

ROOT = Path(__file__).resolve().parent.parent
SRC = ROOT / "preview" / "cleaned-body.png"
CONFIG = ROOT / "src" / "config.ts"
OUT = ROOT / "preview" / "bounds_projected.png"

FIELD_BANDS = {"top": ["A", "B"], "bottom": ["C"]}


def read_config():
    """Pull the generated CONFIG object out of src/config.ts.

    The file is `export const CONFIG: CardConfig = {...};`. Slicing from the
    assignment (not the first `{`, which appears in the import above it) and
    parsing as JSON keeps this tool in step with the generator.
    """
    text = CONFIG.read_text()
    start = text.index("CONFIG: CardConfig =") + len("CONFIG: CardConfig =")
    body = text[start:text.rindex("}") + 1]
    return json.loads(body)


def homographies(cfg):
    """The generator stores photo -> card; drawing needs the inverse."""
    fwd = np.array(cfg["homography"], float).reshape(3, 3)
    return fwd, np.linalg.inv(fwd)


def card_to_photo(hinv, pts):
    out = []
    for x, y in pts:
        v = hinv @ np.array([x, y, 1.0])
        out.append((int(round(v[0] / v[2])), int(round(v[1] / v[2]))))
    return out


def box(hinv, x0, x1, y0, y1, colour, img, width=1, fill=None):
    quad = card_to_photo(hinv, [(x0, y0), (x1, y0), (x1, y1), (x0, y1)])
    if fill is not None:
        overlay = img.copy()
        cv2.fillPoly(overlay, [np.array(quad, np.int32)], fill)
        cv2.addWeighted(overlay, 0.28, img, 0.72, 0, img)
    cv2.polylines(img, [np.array(quad, np.int32)], True, colour, width, cv2.LINE_AA)
    return quad


def label(img, hinv, x, y, text, colour, scale=0.42):
    px, py = card_to_photo(hinv, [(x, y)])[0]
    cv2.putText(img, text, (px, py), cv2.FONT_HERSHEY_SIMPLEX, scale, colour, 1,
                cv2.LINE_AA)


def main():
    cfg = read_config()
    img = cv2.imread(str(SRC))
    _fwd, hinv = homographies(cfg)
    lines = {l["band"]: l for l in cfg["lines"]}
    fields = cfg["fields"]

    GREEN = (60, 190, 60)
    BLUE = (230, 120, 40)

    # original bounds: each physical band, cap top to baseline
    for name, d in lines.items():
        y0 = d["baseline"] - d["cap"]
        box(hinv, d["x0"], d["x1"], y0, d["baseline"], GREEN, img, 1)
        label(img, hinv, d["x0"], y0 - 6, f"{name} orig", GREEN)

    # maximum bounds: the field box grown to the card's padding
    for field, f in fields.items():
        bands = FIELD_BANDS[field]
        top = min(lines[b]["baseline"] - lines[b]["cap"] for b in bands)
        bottom = max(lines[b]["baseline"] for b in bands)
        box(hinv, f["min_x"], f["max_x"], top, bottom, BLUE, img, 2)
        label(img, hinv, f["min_x"], top - 8, f"{field} max", BLUE)

    h, w = img.shape[:2]
    pad, lw = 10, 250
    cv2.rectangle(img, (pad, pad), (pad + lw, pad + 66), (255, 255, 255), -1)
    cv2.rectangle(img, (pad, pad), (pad + lw, pad + 66), (0, 0, 0), 1)
    for i, (text, colour) in enumerate([
        ("green = original band bounds", GREEN),
        ("blue = maximum bounds", BLUE),
    ]):
        y = pad + 24 + i * 24
        cv2.line(img, (pad + 8, y - 4), (pad + 38, y - 4), colour, 2)
        cv2.putText(img, text, (pad + 44, y + 2), cv2.FONT_HERSHEY_SIMPLEX, 0.42,
                    (0, 0, 0), 1, cv2.LINE_AA)

    cv2.imwrite(str(OUT), img)
    print(f"wrote {OUT}")

    # report where the boxes land, for cross-checking
    for name, d in lines.items():
        q = card_to_photo(hinv, [(d["x0"], d["baseline"] - d["cap"]),
                                 (d["x1"], d["baseline"])])
        print(f"  band {name}: photo {q[0]} .. {q[1]}")


if __name__ == "__main__":
    main()
