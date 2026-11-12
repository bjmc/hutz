#!/usr/bin/env python3
"""Stage 2 of the asset build: make the card header editable.

Reads `cleaned-body.png` (stage 1) and writes:

- `plate.jpg` -- the card with the printed name erased;
- `fingers.png` -- a mask of the cartoon hand. The app punches its alpha out of
  the ink layer, so the new text never prints over the printed fingers.

Three things in the header must survive: the printed rule below the name, the
hand and its drawn outline, and the paper's own shading. The band is therefore
clipped to the rows the name occupies, and the hand is held out of the erase.
"""
from pathlib import Path

import cv2
import numpy as np

from geometry import CARD_H, CARD_W, QUAD

ROOT = Path(__file__).resolve().parent.parent
CARD = ROOT / "assets" / "card"
DEBUG = ROOT / "preview"

# The printed name, measured from its ink. `INK_Y`/`INK_X` are the ink itself;
# the band adds a margin so the soft edge of the erase falls on blank paper
# rather than across the first row of letters, which would leave a stripe of
# their tops behind.
INK_Y = (37, 81)
INK_X = (44, 476)
PAD = 5
BAND_Y = (INK_Y[0] - PAD, INK_Y[1] + PAD)
BAND_X = (INK_X[0] - PAD, INK_X[1] + PAD)
# the printed rule below the name, checked after the erase
RULE_ROWS = (87, 88, 89)
# rows the hand can occupy; the card's own figure is yellow too, so stop above
# it
FINGER_ROWS = 60
MARGIN = 18        # clean stock either side of the band, for tone and grain
CHAIKIN = 3        # corner-cutting passes that round the hand's outline
EDGE_FEATHER = 1.2  # px the band edge fades over, hiding the cut
BLEED = 0          # extra px the erase stays clear of the hand; GROW already
                   # carries the mask past the outline, onto plain paper
GROW = 3           # how far the yellow grows into its drawn outline. This is
                   # the largest value that still takes the whole stroke: at 4
                   # the mask starts swallowing the printed name where it
                   # touches the hand, and that name is then restored with the
                   # fingers instead of erased.
DARKEN = 115       # grey level below which a pixel counts as outline
MIN_BLOB = 400     # smallest yellow blob that is hand, in image pixels


def homographies():
    src = np.array([QUAD[k] for k in ("TL", "TR", "BR", "BL")], np.float32)
    dst = np.array([[0, 0], [CARD_W, 0], [CARD_W, CARD_H], [0, CARD_H]],
                   np.float32)
    return cv2.getPerspectiveTransform(src, dst)


def paper_patch(card):
    """Card stock for the name band, interpolated across its clean margins.

    Erasing only what is detectably dark leaves a ghost: the ink presses into the
    stock and no threshold separates that residue from the paper grain. A flat
    fill would instead leave a visible rectangle, because the paper shades from
    one side of the card to the other. Interpolating each row between the stock
    immediately left and right of the band keeps that gradient.
    """
    y0, y1 = BAND_Y
    x0, x1 = BAND_X
    w = x1 - x0

    left = card[y0:y1, x0 - MARGIN:x0 - 2]
    right = card[y0:y1, x1 + 2:x1 + MARGIN]
    t = np.linspace(0.0, 1.0, w, dtype=np.float32)[None, :, None]
    patch = (left.mean(axis=1).astype(np.float32)[:, None, :] * (1 - t) +
             right.mean(axis=1).astype(np.float32)[:, None, :] * t)

    # Grain from each margin, centred on its own median so neither side drags the
    # other's brightness, then blended across the band the same way.
    gray = cv2.cvtColor(card, cv2.COLOR_BGR2GRAY)
    gl = gray[y0:y1, x0 - MARGIN:x0 - 2].astype(np.float32)
    gr = gray[y0:y1, x1 + 2:x1 + MARGIN].astype(np.float32)
    gl -= float(np.median(gl))
    gr -= float(np.median(gr))
    ys = np.arange(y1 - y0)[:, None]
    xl = np.arange(w)[None, :] % gl.shape[1]
    xr = np.arange(w)[None, :] % gr.shape[1]
    patch += (gl[ys, xl] * (1 - t[..., 0]) + gr[ys, xr] * t[..., 0])[..., None]
    return np.clip(patch, 0, 255).astype(np.uint8)


def to_image(img, inv, size):
    """Warp card space to image space, anchored at the origin."""
    return cv2.warpPerspective(img, inv, size, flags=cv2.INTER_LANCZOS4)


def smooth_mask(mask, rounds):
    """Round a mask's outline with Chaikin corner cutting.

    The yellow segmentation follows every anti-aliased pixel, so its edge is
    ragged at the one-pixel scale. Cutting the corners turns that into a smooth
    curve, which is what lets the join pass unnoticed.
    """
    out = np.zeros_like(mask)
    contours, _ = cv2.findContours(mask, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_NONE)
    for c in contours:
        if cv2.contourArea(c) < MIN_BLOB:
            continue
        pts = c[:, 0, :].astype(np.float32)
        for _ in range(rounds):
            near = 0.75 * pts + 0.25 * np.roll(pts, -1, axis=0)
            far = 0.25 * pts + 0.75 * np.roll(pts, -1, axis=0)
            pts = np.stack([near, far], axis=1).reshape(-1, 2)
        cv2.fillPoly(out, [np.round(pts).astype(np.int32)], 255)
    return out


def hand_masks(card):
    """The cartoon hand, as a rounded mask plus a safe margin around it.

    The yellow fill is grown through the drawn outline so the outline travels
    with the hand, then rounded. `full` is that shape grown out onto plain
    paper, and is what the erase leaves alone: a cut on the stroke would expose
    every ragged edge, while a cut on paper joins paper to paper.
    """
    hsv = cv2.cvtColor(card, cv2.COLOR_BGR2HSV)
    h, s, v = hsv[..., 0], hsv[..., 1], hsv[..., 2]
    yellow = ((s > 90) & (h > 10) & (h < 45) & (v > 110)).astype(np.uint8)
    yellow = cv2.morphologyEx(yellow, cv2.MORPH_CLOSE, np.ones((5, 5), np.uint8))

    # the card's own cartoon figure is yellow too, so keep only the head of it
    yellow[FINGER_ROWS:] = 0
    n, lab, stats, _ = cv2.connectedComponentsWithStats(yellow, 8)
    core = np.zeros_like(yellow)
    for i in range(1, n):
        if stats[i][4] > MIN_BLOB:
            core[lab == i] = 255

    # Growth is measured from the yellow itself, not run iteratively. A
    # transitive walk through dark pixels escapes the outline wherever the
    # printed name touches it, and that name would then be restored with the
    # hand instead of erased.
    gray = cv2.cvtColor(card, cv2.COLOR_BGR2GRAY)
    dark = ((gray < DARKEN) * 255).astype(np.uint8)
    near = cv2.dilate(core, cv2.getStructuringElement(
        cv2.MORPH_ELLIPSE, (2 * GROW + 1, 2 * GROW + 1)))
    hand = cv2.bitwise_or(core, cv2.bitwise_and(near, dark))
    hand = smooth_mask(hand, CHAIKIN)

    disc = cv2.getStructuringElement(cv2.MORPH_ELLIPSE,
                                     (2 * BLEED + 1, 2 * BLEED + 1))
    return hand, cv2.dilate(hand, disc)


def main():
    for d in (CARD, DEBUG):
        d.mkdir(parents=True, exist_ok=True)

    # Stage 2 input: the plate with handwriting removed, straight from stage 1.
    # Lossless, so the only JPEG in the chain is the one this stage writes.
    plate = cv2.imread(str(DEBUG / "cleaned-body.png"))
    ph, pw = plate.shape[:2]
    H = homographies()
    inv = np.linalg.inv(H)
    card = to_image(plate, H, (CARD_W, CARD_H))

    hand, full = hand_masks(card)

    # paint the band, then put the source image's own hand back over it
    erased = card.copy()
    y0, y1 = BAND_Y
    x0, x1 = BAND_X
    erase = np.zeros_like(full)
    erase[y0:y1, x0:x1] = 255
    erase = cv2.bitwise_and(erase, cv2.bitwise_not(full))

    sub = erased[y0:y1, x0:x1]
    sel = erase[y0:y1, x0:x1] > 0
    sub[sel] = paper_patch(card)[sel]
    erased[y0:y1, x0:x1] = sub

    # The hand is restored in image space, straight from the original, so its
    # pixels are identical rather than resampled twice. The band edge is faded
    # over a couple of pixels first: a hard cut against the surrounding paper
    # leaves a visible line right across the card. That fade is built from the
    # band rectangle alone -- feathering the combined mask would leave partial
    # alpha around the hand, letting the printed name bleed back through.
    clean = plate.copy()
    hand_image = cv2.warpPerspective(hand, inv, (pw, ph),
                                     flags=cv2.INTER_NEAREST)
    band = np.zeros((CARD_H, CARD_W), np.uint8)
    band[y0:y1, x0:x1] = 255
    band_image = cv2.warpPerspective(band, inv, (pw, ph),
                                     flags=cv2.INTER_LINEAR)
    band_image = cv2.GaussianBlur(band_image, (0, 0), EDGE_FEATHER)
    alpha = (band_image.astype(np.float32) / 255.0) * (hand_image == 0)
    patched = to_image(erased, inv, (pw, ph))
    a = alpha[..., None]
    clean = np.clip(plate * (1 - a) + patched * a, 0, 255).astype(np.uint8)
    clean[hand_image > 0] = plate[hand_image > 0]

    cv2.imwrite(str(CARD / "plate.jpg"), clean,
                [cv2.IMWRITE_JPEG_QUALITY, 94])
    # Full-size alpha mask of the hand: 255 where the fingers are, 0 elsewhere.
    # The app punches this out of its ink layer with `destination-out`, which
    # consults only alpha, so the colour channels carry nothing and are left
    # zeroed -- one long run that compresses to almost nothing.
    fingers = np.zeros((ph, pw, 4), np.uint8)
    fingers[hand_image > 0, 3] = 255
    cv2.imwrite(str(CARD / "fingers.png"), fingers,
                [cv2.IMWRITE_PNG_COMPRESSION, 9])

    def crop(img, scale=2, rows=(20, 100), cols=(20, 500)):
        c = img[rows[0]:rows[1], cols[0]:cols[1]]
        size = ((cols[1] - cols[0]) * scale, (rows[1] - rows[0]) * scale)
        return cv2.resize(c, size, interpolation=cv2.INTER_NEAREST)

    after = to_image(clean, H, (CARD_W, CARD_H))
    cv2.imwrite(str(DEBUG / "header-before.png"), crop(card))
    cv2.imwrite(str(DEBUG / "header-after.png"), crop(after))
    cv2.imwrite(str(DEBUG / "header-matte.png"),
                crop(cv2.cvtColor(hand, cv2.COLOR_GRAY2BGR)))

    gray = cv2.cvtColor(after, cv2.COLOR_BGR2GRAY)
    inside = (gray[y0:y1, x0 + 2:x0 + 10].mean(),
              gray[y0:y1, x1 - 10:x1 - 2].mean())
    outside = (gray[y0:y1, x0 - 10:x0 - 2].mean(),
               gray[y0:y1, x1 + 2:x1 + 10].mean())
    band = np.zeros_like(gray, bool)
    band[y0:y1, x0:x1] = True
    print(f"seam inside {np.mean(inside):.1f} outside {np.mean(outside):.1f}")
    print(f"hand {int((hand > 0).sum())} px, erase {int(sel.sum())} px")
    print(f"dark left outside hand: {int((band & (hand == 0) & (gray < 110)).sum())}")
    print(f"background kept: {int((clean.sum(axis=2) > 0).mean() * 100)}%")

    for y in RULE_ROWS:
        row = gray[y, x0:x1]
        print(f"rule y{y}: mean {row.mean():.1f} min {row.min():.0f}")


if __name__ == "__main__":
    main()
