#!/usr/bin/env python3
"""Geometry measured from the source image, for re-deriving the card assets.

The app does not use this: `src/config.ts` is hand-maintained and the generated
assets under `assets/` are committed. These constants exist only so the asset
pipeline can be re-run against `assets/source/original.jpg`.
"""

# The card is seen at an angle in the source image, so the correction is a
# homography fitted to the four printed border rules. A pure rotation cannot
# square the card: it levels the top/bottom rules but leaves the sides sheared,
# which makes upright lettering measure as italic.
QUAD = {
    "TL": (245.29709, 178.12656),
    "TR": (764.42084, 72.32128),
    "BR": (789.44867, 554.71550),
    "BL": (265.98930, 663.23865),
}

# the rectangle the quad maps onto
CARD_W, CARD_H = 530, 484

# Measured dark-ink extents and baselines in card space. x1 is the *letter*
# extent: the red marks are appended after the text and hang past it.
MEASURED = {
    "A": dict(x0=124, x1=353, baseline=173, cap=27),
    "B": dict(x0=107, x1=391, baseline=218, cap=28),
    "C": dict(x0=74, x1=443, baseline=304, cap=27),
}

# The printed name at the top of the card: ink runs x 53..470, y 36..79.
MEASURED_HEADER = dict(x0=53, x1=470, baseline=79, cap=41)
