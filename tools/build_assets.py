#!/usr/bin/env python3
"""Stage 1 of the asset build: plate and punctuation, from the source photo.

Reads `assets/source/original.jpg` and writes the handwriting-free plate
(`cleaned-body.png`) plus the red punctuation vectors traced from it.

The plate removes only the handwriting; the card's printed furniture (rule
lines, scales logo) is left intact. Masking happens in deskewed space, then the
mask is warped back so the photograph itself is never resampled.

Stage 2 (`make_header_assets.py`) then takes `cleaned-body.png` and erases the
printed name, producing the `plate.jpg` the app ships.
"""
import json
import re
import subprocess
import sys
from pathlib import Path

import cv2
import numpy as np

sys.path.insert(0, str(Path(__file__).resolve().parent))
from clean_and_segment import (ROI, SRC, find_angle, ink_from,  # noqa: E402
                               remove_rules)
from gen_config import CARD_H, CARD_W, MEASURED, QUAD  # noqa: E402

ROOT = Path(__file__).resolve().parent.parent
OUT = ROOT / "assets" / "punct"
PLATE = ROOT / "assets" / "card"
DEBUG = ROOT / "preview"
# band, y0, y1, field, text, bottom slack
# Slack is per band: the card text sits right on top of the scales logo, so a
# uniform margin would eat the top of the logo.
BANDS = [
    ("A", 24, 64, "top", "WORKS ON", 12),
    ("B", 68, 106, "top", "CONTINGENCY?", 16),
    ("C", 154, 192, "bottom", "NO, MONEY DOWN", 6),
]
SLACK = 5         # above each band
TRACE_UP = 8
INK_LUM = 45      # darkest stroke core
PAPER_LUM = 150   # card stock luminance


def segmentation():
    img = cv2.imread(SRC)
    x, y, w, h = ROI
    roi = img[y:y + h, x:x + w].copy()
    ink0 = ink_from(cv2.cvtColor(roi, cv2.COLOR_BGR2GRAY))
    angle = find_angle(ink0, w, h)
    M = cv2.getRotationMatrix2D((w / 2, h / 2), angle, 1.0)
    colour = cv2.warpAffine(roi, M, (w, h), flags=cv2.INTER_LANCZOS4)
    ink = cv2.warpAffine(ink0, M, (w, h), flags=cv2.INTER_NEAREST)
    ink, _ = remove_rules(ink)
    return img, roi, colour, ink, angle, M


def handwriting_mask(ink, colour):
    """Keep the three text bands, but never clip a red mark.

    The handwritten punctuation deliberately overshoots the lettering bands, so
    band clipping would shear the top off the exclamation stem.
    """
    out = np.zeros_like(ink)
    for _band, y0, y1, _field, _text, below in BANDS:
        lo = max(0, y0 - SLACK)
        hi = min(ink.shape[0], y1 + below)
        out[lo:hi] = ink[lo:hi]

    n, lab, stats, _ = cv2.connectedComponentsWithStats(ink, 8)
    reds = np.zeros_like(ink)
    for i in range(1, n):
        if stats[i][4] < 8:
            continue
        b, g, r = colour[lab == i].mean(axis=0)
        if r - (g + b) / 2 > 40:
            reds[lab == i] = 255
    return cv2.bitwise_or(out, reds)


def furniture_mask(ink, hand):
    """Printed card furniture: ink outside the writing bands. Must be preserved."""
    return cv2.bitwise_and(ink, cv2.bitwise_not(hand))


def text_envelope(h, w):
    """Rows the handwriting can occupy. Nothing outside this may be erased.

    The card's printed rule sits at the very top and the scales logo just below
    the last line; both are darker than the stock, so an unconstrained halo
    pass would eat them.
    """
    lo = min(b[1] for b in BANDS) - SLACK
    hi = max(b[2] + b[5] for b in BANDS)
    env = np.zeros((h, w), np.uint8)
    env[max(0, lo):min(h, hi + 1)] = 255
    return env, lo, hi


def build_plate(img, ink, hand, colour, M, w, h):
    """Erase handwriting down to the card stock, leaving printed furniture alone.

    Everything happens in deskewed space, where the text bands are known and
    horizontal, so the erasure can be limited to the rows the writing occupies.
    """
    x, y, _, _ = ROI

    gray = cv2.cvtColor(colour, cv2.COLOR_BGR2GRAY)
    paper = cv2.morphologyEx(gray, cv2.MORPH_CLOSE, np.ones((21, 21), np.uint8))
    halo = ((paper.astype(np.int16) - gray.astype(np.int16)) > 6).astype(np.uint8)

    env, lo, hi = text_envelope(h, w)
    m = cv2.bitwise_or(hand, halo * 255)
    m = cv2.bitwise_and(m, env)

    # protect the printed furniture from the dilate below
    protect = cv2.dilate(furniture_mask(ink, hand), np.ones((9, 9), np.uint8))
    m = cv2.bitwise_and(m, cv2.bitwise_not(protect))
    m = cv2.dilate(m, np.ones((3, 3), np.uint8), iterations=1)
    m = cv2.bitwise_and(m, env)
    m = cv2.bitwise_and(m, cv2.bitwise_not(protect))

    inv = cv2.invertAffineTransform(M)
    m_roi = cv2.warpAffine(m, inv, (w, h), flags=cv2.INTER_NEAREST)

    patch = img[y:y + h, x:x + w]
    filled = cv2.inpaint(patch, m_roi, 7, cv2.INPAINT_TELEA)
    # inpaint leaves faint streaks inside wide strokes; flatten just those
    smooth = cv2.medianBlur(filled, 5)
    keep = cv2.erode(m_roi, np.ones((3, 3), np.uint8))
    filled[keep > 0] = smooth[keep > 0]

    plate = img.copy()
    plate[y:y + h, x:x + w] = filled
    return plate, m


def compose(colour, mask, x, y, w, h):
    """Return (soft coverage crop, ink rgb, crop origin, crop size) for one mark."""
    pad = max(2, TRACE_UP // 2)
    x0, y0 = max(0, x - pad), max(0, y - pad)
    x1 = min(colour.shape[1], x + w + pad)
    y1 = min(colour.shape[0], y + h + pad)
    win = colour[y0:y1, x0:x1]

    gray = cv2.cvtColor(win, cv2.COLOR_BGR2GRAY).astype(np.float32)
    seed = mask[y0:y1, x0:x1].astype(np.uint8)

    # Coverage from luminance alone. The card stock is neutral and the ink is
    # far darker, so this separates cleanly. Red-excess does NOT: it varies
    # across the stroke and carries a large paper floor, so multiplying by it
    # both inflates the falloff and distorts the silhouette.
    paper = float(np.percentile(gray, 90))
    ink_lum = float(np.percentile(gray[seed > 0], 10)) if seed.any() else INK_LUM
    cover = np.clip((paper - gray) / max(1.0, paper - ink_lum), 0.0, 1.0)

    # the seed only selects which blobs belong to this mark; it must not
    # contribute values, or it reinstates the binary staircase
    n, lab = cv2.connectedComponents((cover > 0.35).astype(np.uint8), 8)
    keep = np.zeros_like(cover)
    for i in range(1, n):
        blob = lab == i
        if (blob & (seed > 0)).any():
            keep[blob] = cover[blob]

    ys, xs = np.nonzero(keep > 0.15)
    if len(ys):
        x0, x1 = x0 + xs.min(), x0 + xs.max() + 1
        y0, y1 = y0 + ys.min(), y0 + ys.max() + 1
        keep = keep[ys.min():ys.max() + 1, xs.min():xs.max() + 1]

    # The fill is the pen's own core, not its average: thresholding picks up the
    # antialiased rim, which is a wash of red over paper and would drag the
    # sampled colour light and desaturated.
    sel = keep.reshape(-1) > 0.85
    px = colour[y0:y1, x0:x1].reshape(-1, 3)[sel]
    if len(px):
        core = px[:, 2].astype(int) - px[:, 1].astype(int)
        px = px[core >= np.percentile(core, 75)]
    bgr = np.median(px, axis=0) if len(px) else np.array([15, 13, 166])
    return keep, bgr[::-1].astype(int), (x0, y0), keep.shape[1::-1]


def ellipse_svg(keep, w, h):
    """Fit the coverage mass as an ellipse and return its axis-aligned bounds.

    A dot here is only ~11 px across, so its traced silhouette has facets that
    no amount of smoothing removes. An ellipse fitted to the moments is both
    rounder and closer to what a pen actually deposits.
    """
    m = cv2.moments(keep, binaryImage=False)
    if m["m00"] <= 0:
        return None
    cx, cy = m["m10"] / m["m00"], m["m01"] / m["m00"]
    mu20 = m["mu20"] / m["m00"]
    mu02 = m["mu02"] / m["m00"]
    mu11 = m["mu11"] / m["m00"]
    common = np.hypot(mu20 - mu02, 2 * mu11)
    a2 = 2 * (mu20 + mu02 + common)
    b2 = max(1e-6, 2 * (mu20 + mu02 - common))
    rx, ry = float(np.sqrt(a2)), float(np.sqrt(b2))
    theta = 0.5 * np.degrees(np.arctan2(2 * mu11, mu20 - mu02))
    if ry > rx:
        rx, ry = ry, rx
        theta += 90.0

    # a rotated ellipse extends past 2rx x 2ry; use the true extent so the
    # enclosing viewBox cannot clip the ends flat
    t = np.radians(theta)
    ex = np.hypot(rx * np.cos(t), ry * np.sin(t))
    ey = np.hypot(rx * np.sin(t), ry * np.cos(t))
    return dict(cx=cx, cy=cy, rx=rx, ry=ry, theta=theta,
                w=int(np.ceil(2 * ex)) + 2, h=int(np.ceil(2 * ey)) + 2)


def potrace_layer(keep, w, h, fill, tag):
    """Trace a soft coverage field to a filled path."""
    up = cv2.resize(keep, (w * TRACE_UP, h * TRACE_UP),
                    interpolation=cv2.INTER_CUBIC)
    up = np.clip(up * 255, 0, 255).astype(np.uint8)
    _, up = cv2.threshold(up, 128, 255, cv2.THRESH_BINARY)

    pbm = OUT / f"{tag}.pbm"
    cv2.imwrite(str(pbm), 255 - up)
    raw = OUT / f"{tag}.raw.svg"
    subprocess.run(["potrace", str(pbm), "-s", "-o", str(raw),
                    "--turdsize", "2", "--alphamax", "1.0"], check=True)

    body = raw.read_text()
    # potrace emits coordinates in tenths of a pixel plus its own scaling group;
    # keep that group and viewBox verbatim and only rescale the outer element
    vb = re.search(r'viewBox="([^"]+)"', body)
    grp = re.search(r'<g\b[^>]*transform[^>]*>.*?</g>', body, re.S)
    if not vb or not grp:
        raise RuntimeError(f"unexpected potrace output in {raw}")
    paths = re.sub(r'fill="#[0-9a-fA-F]{6}"', f'fill="{fill}"',
                   grp.group(0), count=1)

    pbm.unlink()
    raw.unlink()
    return vb.group(1), paths


def trace_mark(name, colour, lab, ids, box, dot_ids=(), dot_box=None,
               ellipse_only=False):
    """Vectorise a mark. Its dot, if any, is an ellipse rather than a traced path."""
    fill = "#a60204"
    rgb = np.array([166, 1, 3])
    pieces = []
    spans = []

    if ids and not ellipse_only:
        mask = np.isin(lab, list(ids)).astype(np.uint8)
        x, y, w, h = box
        keep, rgb, (x0, y0), (w, h) = compose(colour, mask, x, y, w, h)
        fill = f"#{rgb[0]:02x}{rgb[1]:02x}{rgb[2]:02x}"
        vb, layer = potrace_layer(keep, w, h, fill, name)
        spans.append((x0, y0, w, h, f'<g transform="scale('
                      f'{w / (w * TRACE_UP):.6f},{h / (h * TRACE_UP):.6f})">'
                      f'{layer}</g>'))

    if dot_ids or ellipse_only:
        src = dot_ids if dot_ids else ids
        dx, dy, dw, dh = dot_box or box
        dmask = np.isin(lab, list(src)).astype(np.uint8)
        dkeep, drgb, (dx0, dy0), (dw, dh) = compose(colour, dmask, dx, dy, dw, dh)
        fit = ellipse_svg(dkeep, dw, dh)
        if fit:
            dfill = f"#{drgb[0]:02x}{drgb[1]:02x}{drgb[2]:02x}"
            rgb = drgb
            fw, fh = fit["w"], fit["h"]
            # the ellipse occupies its own bounds, so centre it in that box
            mx, my = fw / 2, fh / 2
            body = (f'<ellipse cx="{mx:.2f}" cy="{my:.2f}" rx="{fit["rx"]:.2f}" '
                    f'ry="{fit["ry"]:.2f}" transform="rotate({fit["theta"]:.2f} '
                    f'{mx:.2f} {my:.2f})"/>')
            spans.append((int(round(dx0 + fit["cx"] - mx)),
                          int(round(dy0 + fit["cy"] - my)), fw, fh,
                          f'<g fill="{dfill}">{body}</g>'))

    if not spans:
        return None

    # the SVG covers the union of every piece plus a margin: potrace's curve
    # smoothing pushes control points slightly outside the source bitmap, so an
    # exact union would shear the ends flat
    pad = 2
    ux0 = min(s[0] for s in spans) - pad
    uy0 = min(s[1] for s in spans) - pad
    ux1 = max(s[0] + s[2] for s in spans) + pad
    uy1 = max(s[1] + s[3] for s in spans) + pad
    uw, uh = ux1 - ux0, uy1 - uy0

    for sx0, sy0, _, _, body in spans:
        ox, oy = sx0 - ux0, sy0 - uy0
        if ox or oy:
            pieces.append(f'<g transform="translate({ox},{oy})">{body}</g>')
        else:
            pieces.append(body)
    kind = ("ellipse" if ellipse_only else
            "mixed" if dot_ids else "path")
    svg = OUT / f"{name}.svg"
    svg.write_text(
        f'<svg xmlns="http://www.w3.org/2000/svg" width="{uw}" height="{uh}" '
        f'viewBox="0 0 {uw} {uh}" preserveAspectRatio="none">'
        f'{"".join(pieces)}</svg>\n')
    print(f"  {name:8s} {uw}x{uh} rgb {tuple(rgb)} -> {kind} "
          f"{svg.stat().st_size} B")
    return dict(name=name, x=int(ux0), y=int(uy0), w=int(uw), h=int(uh),
                rgb=[int(v) for v in rgb], kind=kind)


def group_marks(lab, stats, colour, n):
    """Merge red components that belong to one mark, then classify by shape."""
    reds = []
    for i in range(1, n):
        cx, cy, cw, ch, a = stats[i]
        if a < 20:
            continue
        b, g, r = colour[lab == i].mean(axis=0)
        if r - (g + b) / 2 <= 45:
            continue
        reds.append(dict(id=i, x=int(cx), y=int(cy), w=int(cw), h=int(ch)))

    reds.sort(key=lambda c: (c["y"], c["x"]))
    groups = []
    for c in reds:
        for g in groups:
            # a dot belongs to the stem immediately above it: small vertical
            # gap and shared columns. Anything further apart is a new mark.
            ox = min(g["x1"], c["x"] + c["w"]) - max(g["x"], c["x"])
            gap = c["y"] - g["y1"]
            if ox > 0 and -2 <= gap <= 4:
                g["items"].append(c)
                x0 = min(g["x"], c["x"])
                y0 = min(g["y"], c["y"])
                g["x1"] = max(g["x1"], c["x"] + c["w"])
                g["y1"] = max(g["y1"], c["y"] + c["h"])
                g["x"], g["y"] = x0, y0
                g["w"], g["h"] = g["x1"] - x0, g["y1"] - y0
                break
        else:
            groups.append(dict(x=c["x"], y=c["y"], x1=c["x"] + c["w"],
                               y1=c["y"] + c["h"], w=c["w"], h=c["h"],
                               items=[c]))

    groups.sort(key=lambda g: g["x"])
    # Identify by where the mark's foot sits against the band baselines. Count
    # of merged components is not enough: in the card plane each mark is
    # already one blob.
    named = []
    for g in groups:
        foot = g["y"] + g["h"]
        near_c = abs(foot - MEASURED["C"]["baseline"]) <= 14
        if near_c and g["w"] <= 26 and g["h"] <= 26:
            name = "comma"
        elif near_c:
            name = "bang"       # bottom field: NO, MONEY DOWN!
        else:
            name = "qmark"      # top field: WORKS ON / CONTINGENCY?
        named.append((name, g))

    out = []
    for name, g in named:
        if name == "bang" and len(g["items"]) > 1:
            # the dot is traced separately so it can be emitted as an ellipse
            dot = max(g["items"], key=lambda c: c["y"])
            stem = [c for c in g["items"] if c is not dot]
            out.append(dict(name=name, role="stem", ids=[c["id"] for c in stem],
                            box=(g["x"], g["y"], g["w"], g["h"]),
                            dot_ids=[dot["id"]],
                            dot_box=(dot["x"], dot["y"], dot["w"], dot["h"])))
            out.append(dict(name="period", role="dot", ids=[dot["id"]],
                            box=(dot["x"], dot["y"], dot["w"], dot["h"]),
                            dot_ids=[]))
            continue
        out.append(dict(name=name, role="whole", ids=[c["id"] for c in g["items"]],
                        box=(g["x"], g["y"], g["w"], g["h"]), dot_ids=[]))
    return out


def card_marks():
    """The red marks as they appear in the card plane, not the deskewed ROI.

    The app draws a mark through the homography, so its shape must be taken
    from the projection. Tracing it in the affine deskewed space instead
    carried the missing perspective: the marks came out narrow, sheared and
    rotated by several degrees.
    """
    img = cv2.imread(SRC)
    src = np.array([QUAD[k] for k in ("TL", "TR", "BR", "BL")], np.float32)
    dst = np.array([[0, 0], [CARD_W, 0], [CARD_W, CARD_H], [0, CARD_H]],
                   np.float32)
    m = cv2.getPerspectiveTransform(src, dst)
    card = cv2.warpPerspective(img, m, (CARD_W, CARD_H),
                               flags=cv2.INTER_LANCZOS4)
    b, g, r = (card[..., i].astype(int) for i in range(3))
    red = ((r > 90) & (r > g + 45) & (r > b + 45)).astype(np.uint8)
    # the red pen lies on the desk outside the card face; the card's own border
    # rules clip it, so only the interior is searched
    red[:20, :] = 0
    red[-20:, :] = 0
    red[:, :20] = 0
    red[:, -20:] = 0
    # and the pen's ink is a duller, browner red than the marker on the card
    n, lab, stats, _ = cv2.connectedComponentsWithStats(red, 8)
    for i in range(1, n):
        m = lab == i
        if stats[i][4] < 20:
            red[m] = 0
            continue
        sat = float(np.median((r - g)[m]))
        if sat < 90:
            red[m] = 0
    return card, red


def main():
    for d in (OUT, PLATE, DEBUG):
        d.mkdir(parents=True, exist_ok=True)
    img, roi, colour, ink, angle, M = segmentation()
    hand = handwriting_mask(ink, colour)
    plate, m = build_plate(img, ink, hand, colour, M, roi.shape[1], roi.shape[0])

    # Stage 1 output, lossless: stage 2 rewrites this plate and JPEG would add
    # a second round of compression loss on the way through. It is an
    # intermediate rather than a shipping asset, so it lives in preview/.
    cv2.imwrite(str(DEBUG / "cleaned-body.png"), plate)
    print(f"plate: masked {int((m > 0).sum())}px of handwriting -> {DEBUG}")

    # the identity goes to the plate; the marks are re-traced in card space
    card, red = card_marks()
    n, lab, stats, _ = cv2.connectedComponentsWithStats(red, 8)
    marks = group_marks(lab, stats, card, n)
    traced = [trace_mark(m["name"], card, lab, m["ids"], m["box"],
                         dot_ids=m["dot_ids"], dot_box=m.get("dot_box"),
                         ellipse_only=(m["role"] == "dot"))
              for m in marks]
    traced = [t for t in traced if t]
    print(f"{len(traced)} mark(s) traced in card space")

    manifest = dict(
        source=dict(file="original.jpg", width=960, height=720),
        roi=dict(x=ROI[0], y=ROI[1], w=ROI[2], h=ROI[3]),
        deskew_deg=round(angle, 2),
        # three physical lines, two logical inputs: the top field wraps A+B
        lines=[dict(band=n, y0=y0, y1=y1, field=f, text=t)
               for n, y0, y1, f, t, _below in BANDS],
        plate=dict(file="card/plate.jpg",
                   width=int(plate.shape[1]), height=int(plate.shape[0])),
        marks=traced,
    )
    json.dump(manifest, open(OUT / "manifest.json", "w"), indent=2)
    print(f"wrote {OUT}")


if __name__ == "__main__":
    main()
