#!/usr/bin/env python3
"""Score candidate fonts against the card's hand lettering.

Each font is rendered at the reference cap height, then compared on the metrics
that actually constrain a meme layout: line width, stroke weight relative to cap
height, and per-column ink profile (a cheap shape signature).
"""
import json
import sys
from pathlib import Path

import cv2
import numpy as np
from PIL import Image, ImageDraw, ImageFont

sys.path.insert(0, str(Path(__file__).resolve().parent))

ROOT = Path(__file__).resolve().parent.parent
FONTS = ROOT / ".cache" / "fonts"
DEBUG = ROOT / "preview"
REF = {"A": "WORKS ON", "B": "CONTINGENCY", "C": "NO MONEY DOWN"}
CAP = 29          # reference cap height in px
PAD = 6


def load_ref(band):
    m = cv2.imread(str(DEBUG / f"text_{band}.png"), cv2.IMREAD_GRAYSCALE)
    return (m < 128).astype(np.uint8)


def render(ttf, text, cap=CAP):
    """Render at a pixel size whose cap height matches `cap`."""
    size = 40
    for _ in range(12):
        f = ImageFont.truetype(str(ttf), size)
        bbox = f.getbbox("H")
        h = bbox[3] - bbox[1]
        if h == 0:
            break
        if abs(h - cap) <= 0:
            break
        size = max(8, int(round(size * cap / h)))
    f = ImageFont.truetype(str(ttf), size)
    bbox = f.getbbox(text)
    img = Image.new("L", (bbox[2] - bbox[0] + 2 * PAD,
                          bbox[3] - bbox[1] + 2 * PAD), 255)
    ImageDraw.Draw(img).text((PAD - bbox[0], PAD - bbox[1]), text, font=f, fill=0)
    a = 1 - (np.asarray(img) / 255.0)
    a[a < 0.5] = 0
    ys, xs = np.nonzero(a)
    if not len(ys):
        return None
    return a[ys.min():ys.max() + 1, xs.min():xs.max() + 1].astype(np.float32)


def metrics(a):
    ink = (a > 0.5).astype(np.uint8)
    h, w = ink.shape
    dt = cv2.distanceTransform(ink, cv2.DIST_L2, 5)
    stroke = 2 * float(np.percentile(dt[dt > 0], 75)) if (dt > 0).any() else 0.0
    return dict(w=w, h=h, stroke=stroke, ratio=stroke / max(h, 1))


def profile(a, n=64):
    p = a.sum(0)
    if p.sum() == 0:
        return np.zeros(n)
    p = cv2.resize(p.reshape(1, -1), (n, 1), interpolation=cv2.INTER_AREA)[0]
    return p / (p.sum() + 1e-9)


def main():
    refs = {b: load_ref(b) for b in REF}
    ref_met = {b: metrics(refs[b].astype(np.float32)) for b in REF}
    ref_prof = {b: profile(refs[b].astype(np.float32)) for b in REF}

    print(f"reference cap heights: "
          f"{ {b: ref_met[b]['h'] for b in REF} }\n")
    print(f"{'font':22s} {'wA':>4s} {'wB':>4s} {'wC':>4s} "
          f"{'stroke/cap':>10s} {'shapeErr':>8s} {'score':>6s}")

    rows = []
    files = sorted(list(FONTS.glob("*.ttf")) + list(FONTS.glob("*.otf")))
    for ttf in files:
        got, errs, ok = {}, [], True
        for band, text in REF.items():
            a = render(ttf, text)
            if a is None:
                ok = False
                break
            got[band] = a
            m = metrics(a)
            want = ref_met[band]
            errs.append(abs(m["w"] - want["w"]) / want["w"])
        if not ok:
            continue

        stroke = np.mean([metrics(got[b])["stroke"] for b in REF])
        ratio = stroke / np.mean([metrics(got[b])["h"] for b in REF])
        shape = np.mean([np.abs(profile(got[b]) - ref_prof[b]).sum() for b in REF])
        score = np.mean(errs) + shape
        rows.append((score, ttf.stem, got, errs, ratio, shape))

    rows.sort()
    for score, name, got, _errs, ratio, shape in rows:
        ws = [metrics(got[b])["w"] for b in REF]
        print(f"{name:22s} {ws[0]:4d} {ws[1]:4d} {ws[2]:4d} "
              f"{ratio:10.3f} {shape:8.3f} {score:6.3f}")

    best = rows[0][1]
    (DEBUG / "font_winners.json").write_text(json.dumps(
        [dict(font=r[1], score=round(r[0], 4)) for r in rows[:6]], indent=2))
    print(f"\nbest: {best}  (reference stroke/cap "
          f"{np.mean([ref_met[b]['ratio'] for b in REF]):.3f})")


if __name__ == "__main__":
    main()
