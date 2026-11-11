/**
 * Geometry and typography for the card. This file is the source of truth.
 *
 * It began as output from a Python pipeline that measured the photograph, but
 * that was only ever bootstrapping: the loop now is config -> app -> compare
 * against assets/source/original.jpg, so adjust these numbers directly and look
 * at the result. Coordinates are in card space (530x484); `size` is a canvas
 * font size in card pixels.
 */
import type { CardConfig } from './types';

export const CONFIG: CardConfig = {
  "source": [
    960,
    720
  ],
  "roi": {
    "x": 311,
    "y": 241,
    "w": 421,
    "h": 245
  },
  "card": [
    530,
    484
  ],
  "homography": [
    1.01070542,
    -0.04311111,
    -240.24386434,
    0.20378241,
    0.99983947,
    -228.08519444,
    -3.55e-06,
    1.778e-05,
    1.0
  ],
  "ink": {
    "colour": [
      25,
      11,
      10
    ]
  },
  "font": {
    "family": "CardFont",
    "weight": 500
  },
  "lines": [
    {
      "band": "H",
      "field": "header",
      "x0": 53,
      "x1": 470,
      "baseline": 79,
      "size": 61.96,
      "letter_space": -0.03,
      "word_space": 0.6
    },
    {
      "band": "A",
      "field": "top",
      "x0": 124,
      "x1": 353,
      "baseline": 173,
      "size": 40.87,
      "letter_space": -0.012,
      "word_space": 0.66,
      "nudge": -9
    },
    {
      "band": "B",
      "field": "top",
      "x0": 107,
      "x1": 391,
      "baseline": 218,
      "size": 40.87,
      "letter_space": -0.05,
      "word_space": 0.8
    },
    {
      "band": "C",
      "field": "bottom",
      "x0": 74,
      "x1": 443,
      "baseline": 304,
      "size": 40.87,
      "letter_space": -0.072,
      "word_space": 1.0
    }
  ],
  "fields": {
    "top": {
      "center": 249.0,
      "half": 142.0,
      "min_x": 14,
      "max_x": 516
    },
    "bottom": {
      "center": 258.5,
      "half": 184.5,
      "min_x": 14,
      "max_x": 516
    },
    "header": {
      "center": 261.5,
      "half": 208.5,
      "min_x": 14,
      "max_x": 516
    }
  },
  "marks": {
    "?": {
      "w": 43,
      "h": 80,
      "bottom": 20,
      "size": 40.87,
      "parts": [
        {
          "svg": "qmark",
          "dx": 0,
          "dy": 0,
          "w": 43,
          "h": 80,
          "rot": 0
        }
      ]
    },
    "!": {
      "w": 26,
      "h": 66,
      "bottom": 3,
      "size": 40.87,
      "parts": [
        {
          "svg": "bang",
          "dx": 0,
          "dy": 0,
          "w": 26,
          "h": 66,
          "rot": 0
        }
      ]
    },
    ",": {
      "w": 18,
      "h": 22,
      "bottom": 10,
      "size": 40.87,
      "parts": [
        {
          "svg": "comma",
          "dx": 0,
          "dy": 0,
          "w": 18,
          "h": 22,
          "rot": 0
        }
      ]
    },
    ".": {
      "w": 16,
      "h": 18,
      "bottom": 5,
      "size": 40.87,
      "parts": [
        {
          "svg": "period",
          "dx": 0,
          "dy": 0,
          "w": 16,
          "h": 18,
          "rot": 0
        }
      ]
    },
    "-": {
      "w": 16.7,
      "h": 5.4,
      "bottom": -8.1,
      "size": 40.87,
      "pad": 0.2,
      "parts": [
        {
          "svg": "dash",
          "dx": 0,
          "dy": 0.0,
          "w": 16.7,
          "h": 5.4,
          "rot": 0
        }
      ]
    },
    "\u2013": {
      "w": 25.6,
      "h": 5.4,
      "bottom": -8.1,
      "size": 40.87,
      "pad": 0.2,
      "parts": [
        {
          "svg": "dash",
          "dx": 0,
          "dy": 0.0,
          "w": 25.6,
          "h": 5.4,
          "rot": 0
        }
      ]
    },
    "\u2014": {
      "w": 35.1,
      "h": 5.4,
      "bottom": -8.1,
      "size": 40.87,
      "pad": 0.2,
      "parts": [
        {
          "svg": "dash",
          "dx": 0,
          "dy": 0.0,
          "w": 35.1,
          "h": 5.4,
          "rot": 0
        }
      ]
    },
    "=": {
      "w": 19.4,
      "h": 13.5,
      "bottom": -4.1,
      "size": 40.87,
      "pad": 0.2,
      "parts": [
        {
          "svg": "dash",
          "dx": 0.0,
          "dy": 8.1,
          "w": 19.4,
          "h": 5.4,
          "rot": 0
        },
        {
          "svg": "dash",
          "dx": 0.0,
          "dy": 0.0,
          "w": 19.4,
          "h": 5.4,
          "rot": 0
        }
      ]
    },
    "+": {
      "w": 19.4,
      "h": 19.4,
      "bottom": -1.1,
      "size": 40.87,
      "pad": 0.2,
      "parts": [
        {
          "svg": "dash",
          "dx": 0.0,
          "dy": 7.0,
          "w": 19.4,
          "h": 5.4,
          "rot": 0
        },
        {
          "svg": "dash",
          "dx": 0.0,
          "dy": 7.0,
          "w": 19.4,
          "h": 5.4,
          "rot": 90
        }
      ]
    },
    "/": {
      "w": 21.4,
      "h": 21.4,
      "bottom": -0.1,
      "size": 40.87,
      "pad": 0.2,
      "parts": [
        {
          "svg": "dash",
          "dx": -1.7,
          "dy": 8.0,
          "w": 24.8,
          "h": 5.4,
          "rot": -45
        }
      ]
    },
    "\\": {
      "w": 21.4,
      "h": 21.4,
      "bottom": -0.1,
      "size": 40.87,
      "pad": 0.2,
      "parts": [
        {
          "svg": "dash",
          "dx": -1.7,
          "dy": 8.0,
          "w": 24.8,
          "h": 5.4,
          "rot": 45
        }
      ]
    },
    "<": {
      "w": 13.7,
      "h": 23.7,
      "bottom": 1.0,
      "size": 40.87,
      "pad": 0.2,
      "parts": [
        {
          "svg": "dash",
          "dx": -0.1,
          "dy": 4.2,
          "w": 14.0,
          "h": 5.4,
          "rot": -45
        },
        {
          "svg": "dash",
          "dx": -0.1,
          "dy": 14.2,
          "w": 14.0,
          "h": 5.4,
          "rot": 45
        }
      ]
    },
    ">": {
      "w": 13.7,
      "h": 23.7,
      "bottom": 1.0,
      "size": 40.87,
      "pad": 0.2,
      "parts": [
        {
          "svg": "dash",
          "dx": -0.1,
          "dy": 4.2,
          "w": 14.0,
          "h": 5.4,
          "rot": 45
        },
        {
          "svg": "dash",
          "dx": -0.1,
          "dy": 14.2,
          "w": 14.0,
          "h": 5.4,
          "rot": -45
        }
      ]
    },
    ":": {
      "w": 17.9,
      "h": 38.1,
      "bottom": 5,
      "size": 40.87,
      "pad": 0.26,
      "parts": [
        {
          "svg": "period",
          "dx": 0,
          "dy": 20.1,
          "w": 16,
          "h": 18,
          "rot": 0
        },
        {
          "svg": "period",
          "dx": 0,
          "dy": 0.0,
          "w": 17.9,
          "h": 20.2,
          "rot": 0
        }
      ]
    },
    ";": {
      "w": 18,
      "h": 47.1,
      "bottom": 10,
      "size": 40.87,
      "pad": 0.26,
      "parts": [
        {
          "svg": "comma",
          "dx": 0,
          "dy": 25.1,
          "w": 18,
          "h": 22,
          "rot": 0
        },
        {
          "svg": "period",
          "dx": 0,
          "dy": 0.0,
          "w": 17.9,
          "h": 20.2,
          "rot": 0
        }
      ]
    }
  }
};
