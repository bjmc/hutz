#!/usr/bin/env python3
"""Geometry measured from the source photo, in card space and photo space.

The app itself does not need this module: every derived value it uses is
committed in `src/config.ts` and the generated assets under `assets/`. These
constants exist so the asset pipeline can be re-run, e.g. to re-derive the
plate from `assets/source/original.jpg` with different parameters.

`src/config.ts` is hand-maintained. Tune the layout there rather than here.
"""

# The card is photographed with perspective, so the correction is a homography
# fitted to the four printed border rules. A pure rotation cannot square the
# card: it levels the top/bottom rules but leaves the sides sheared, which makes
# upright lettering measure as italic.
QUAD = {
    "TL": (245.29709, 178.12656),
    "TR": (764.42084, 72.32128),
    "BR": (789.44867, 554.71550),
    "BL": (265.98930, 663.23865),
}

# the rectangle the quad maps onto
CARD_W, CARD_H = 530, 484

# Measured dark-ink extents and baselines in card space. x1 is the *letter*
# extent: the red marks are appended after the text and hang past it, so
# including them would over-spread the justification.
MEASURED = {
    "A": dict(x0=124, x1=353, baseline=173, cap=27),
    "B": dict(x0=107, x1=391, baseline=218, cap=28),
    "C": dict(x0=74, x1=443, baseline=304, cap=27),
}

# The printed name at the top of the card. Ink runs x 53..470, y 36..79, so the
# baseline is 79 and the cap 41. Bounds come from the ink, not the card edge,
# because the point of the field is to replace a line already typeset.
MEASURED_HEADER = dict(x0=53, x1=470, baseline=79, cap=41)
