#!/usr/bin/env python3
"""Derive `assets/punct/dash.svg` from the traced bang.

The bang is a stroke plus a dot. Keep the stroke, rotate it flat and crop to its
ink. Two things are measured rather than assumed:

- the traced stroke is not vertical, so the angle is found by maximising the
  horizontal extent (widest when the bar lies level);
- rendering uses a padded viewBox, because measuring inside the original bounds
  clips the rotated art and truncates its ends.
"""
from pathlib import Path
import io
import xml.etree.ElementTree as ET

import cairosvg
import numpy as np
from PIL import Image

ROOT = Path(__file__).resolve().parent.parent
ASSETS = ROOT / "assets" / "punct"
NS = "http://www.w3.org/2000/svg"
ET.register_namespace("", NS)

PAD = 100
SCALE = 10


def stroke_root():
    root = ET.parse(ASSETS / "bang.svg").getroot()
    for parent in root.iter():
        for child in list(parent):
            if child.tag.split("}")[-1] == "ellipse":
                parent.remove(child)
    return root


def render(root, view):
    """Ink extent in *user* coordinates, not pixels."""
    root.set("viewBox", view)
    vx, vy, vw, vh = (float(v) for v in view.split())
    root.set("width", str(vw))
    root.set("height", str(vh))
    buf = io.BytesIO()
    ET.ElementTree(root).write(buf, encoding="utf-8", xml_declaration=False)
    png = cairosvg.svg2png(bytestring=buf.getvalue(), scale=SCALE)
    a = np.asarray(Image.open(io.BytesIO(png)).convert("RGBA"))[..., 3] > 60
    ys, xs = np.nonzero(a)
    if len(xs) == 0:
        return None
    return (vx + xs.min() / SCALE, vx + xs.max() / SCALE,
            vy + ys.min() / SCALE, vy + ys.max() / SCALE)


def rotated(angle, cx, cy):
    root = stroke_root()
    g = ET.Element(f"{{{NS}}}g")
    g.set("transform", f"rotate({angle:.4f} {cx:.4f} {cy:.4f})")
    for child in list(root):
        root.remove(child)
        g.append(child)
    root.append(g)
    return root


def main():
    big = f"{-PAD} {-PAD} {34 + 2 * PAD} {65 + 2 * PAD}"

    x0, x1, y0, y1 = render(stroke_root(), big)
    cx, cy = (x0 + x1) / 2, (y0 + y1) / 2
    print(f"stroke bbox {x0:.2f}..{x1:.2f} x {y0:.2f}..{y1:.2f}  centre ({cx:.2f}, {cy:.2f})")

    # widest when level, then refine with a finer sweep around the winner
    best_angle, best_w = 0.0, -1.0
    for angle in np.arange(-130.0, -49.99, 0.25):
        r = render(rotated(angle, cx, cy), big)
        if r is None:
            continue
        w = r[1] - r[0]
        if w > best_w:
            best_angle, best_w = float(angle), float(w)
    for angle in np.arange(best_angle - 0.25, best_angle + 0.2501, 0.02):
        r = render(rotated(angle, cx, cy), big)
        if r is None:
            continue
        w = r[1] - r[0]
        if w > best_w:
            best_angle, best_w = float(angle), float(w)
    print(f"widest at rotate({best_angle:.2f}) -> {best_w:.2f} wide")

    rx0, rx1, ry0, ry1 = render(rotated(best_angle, cx, cy), big)
    w, h = rx1 - rx0, ry1 - ry0
    print(f"ink {w:.2f} x {h:.2f}  ratio {w / h:.2f}:1")

    root = rotated(best_angle, cx, cy)
    root.set("viewBox", f"{rx0:.4f} {ry0:.4f} {w:.4f} {h:.4f}")
    root.set("width", f"{w:.4f}")
    root.set("height", f"{h:.4f}")
    root.set("preserveAspectRatio", "none")
    buf = io.BytesIO()
    ET.ElementTree(root).write(buf, encoding="utf-8", xml_declaration=False)
    (ASSETS / "dash.svg").write_text(buf.getvalue().decode() + "\n")
    print("wrote assets/punct/dash.svg")


if __name__ == "__main__":
    main()
