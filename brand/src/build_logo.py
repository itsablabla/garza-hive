#!/usr/bin/env python3
"""GarzaHive logo system — parametric vector generator."""
import math, os
from fontTools.ttLib import TTFont
from fontTools.pens.svgPathPen import SVGPathPen

HERE = os.path.dirname(os.path.abspath(__file__))
FONTS = os.path.join(os.path.dirname(HERE), "fonts")
OUT = os.path.join(os.path.dirname(HERE), "logo", "svg")
os.makedirs(OUT, exist_ok=True)

# ---------------------------------------------------------------- palette
CHARCOAL = "#1C1B19"
AMBER    = "#D19900"
WHITE    = "#FFFFFF"

# ---------------------------------------------------------------- icon geometry
RX, RY = 92.0, 108.0       # body hexagon half-width / half-height
GAP    = 8.0               # gap between bands
BANDS  = 4
WING_R      = 73.0         # wing hexagon circumradius (flat-top)
WING_STROKE = 18.0
WING_CX, WING_CY = 141.0, -30.0
WING_ROT    = 14.0          # degrees, outward tilt


def body_x_at(y):
    """Half-width of the body hexagon at height y (flat top/bottom, pointy sides)."""
    ay = min(abs(y), RY)
    return RX * (1.0 - 0.5 * (ay / RY))


def band_polys():
    """Return list of (points, colour) for the 4 sliced bands."""
    step = (2 * RY) / BANDS
    polys = []
    for i in range(BANDS):
        y0 = -RY + i * step + (GAP / 2 if i > 0 else 0)
        y1 = -RY + (i + 1) * step - (GAP / 2 if i < BANDS - 1 else 0)
        x0, x1 = body_x_at(y0), body_x_at(y1)
        pts = []
        # top edge
        pts.append((-x0, y0)); pts.append((x0, y0))
        # right side: insert the pointy vertex if the band straddles y=0
        if y0 < 0 < y1:
            pts.append((RX, 0.0))
        pts.append((x1, y1)); pts.append((-x1, y1))
        if y0 < 0 < y1:
            pts.append((-RX, 0.0))
        colour = AMBER if i == 1 else CHARCOAL
        polys.append((pts, colour))
    return polys


def hexagon(cx, cy, r, rot_deg=0.0, pointy_top=True):
    pts = []
    base = 90.0 if pointy_top else 0.0
    for k in range(6):
        a = math.radians(base + rot_deg + 60.0 * k)
        pts.append((cx + r * math.cos(a), cy - r * math.sin(a)))
    return pts


def pts_to_d(pts):
    return "M " + " L ".join(f"{x:.2f},{y:.2f}" for x, y in pts) + " Z"


def icon_svg(body_colour=None, wing_colour=None, accent=None):
    """accent overrides the amber band; body_colour overrides charcoal bands."""
    bc = body_colour or CHARCOAL
    wc = wing_colour or AMBER
    ac = accent or AMBER
    parts = []
    # wings behind
    for sign in (-1, 1):
        pts = hexagon(sign * WING_CX, WING_CY, WING_R,
                      rot_deg=sign * WING_ROT, pointy_top=False)
        parts.append(
            f'<path d="{pts_to_d(pts)}" fill="none" stroke="{wc}" '
            f'stroke-width="{WING_STROKE}" stroke-linejoin="round"/>'
        )
    for i, (pts, col) in enumerate(band_polys()):
        c = ac if i == 1 else bc
        parts.append(f'<path d="{pts_to_d(pts)}" fill="{c}"/>')
    return "\n    ".join(parts)


ICON_W = 2 * (WING_CX + WING_R) + WING_STROKE
ICON_H = 2 * RY


# ---------------------------------------------------------------- wordmark
def wordmark_paths(text, font_path, size, tracking, colour):
    """Convert text to SVG path data. Returns (svg_string, width, cap_height)."""
    font = TTFont(font_path)
    upm = font["head"].unitsPerEm
    scale = size / upm
    glyphset = font.getGlyphSet()
    cmap = font.getBestCmap()
    hmtx = font["hmtx"]
    caps = font["OS/2"].sCapHeight if hasattr(font["OS/2"], "sCapHeight") else upm * 0.7

    out, x = [], 0.0
    for ch in text:
        gname = cmap[ord(ch)]
        pen = SVGPathPen(glyphset)
        glyphset[gname].draw(pen)
        d = pen.getCommands()
        if d:
            out.append(
                f'<path d="{d}" fill="{colour}" '
                f'transform="translate({x:.2f},0) scale({scale:.6f},{-scale:.6f})"/>'
            )
        x += hmtx[gname][0] * scale + tracking
    x -= tracking  # no trailing track
    return "\n    ".join(out), x, caps * scale


# ---------------------------------------------------------------- lockups
def wrap(width, height, body, bg=None):
    b = f'<rect width="{width:.2f}" height="{height:.2f}" fill="{bg}"/>' if bg else ""
    return (
        f'<svg xmlns="http://www.w3.org/2000/svg" width="{width:.2f}" '
        f'height="{height:.2f}" viewBox="0 0 {width:.2f} {height:.2f}">\n'
        f'  {b}\n  {body}\n</svg>\n'
    )


FONT = os.path.join(FONTS, "Outfit-SemiBold.ttf")
WM_SIZE = 80.0
WM_TRACK = 13.5


def build_icon(name, body_colour, wing_colour, accent, bg=None, pad=0.0):
    w, h = ICON_W + 2 * pad, ICON_H + 2 * pad
    g = (
        f'<g transform="translate({w/2:.2f},{h/2:.2f})">\n    '
        + icon_svg(body_colour, wing_colour, accent)
        + "\n  </g>"
    )
    svg = wrap(w, h, g, bg)
    open(os.path.join(OUT, name + ".svg"), "w").write(svg)
    return svg


def build_vertical(name, body_colour, wing_colour, accent, text_colour, bg=None):
    wm, wm_w, cap = wordmark_paths("GARZAHIVE", FONT, WM_SIZE, WM_TRACK, text_colour)
    gap = 68.0
    w = max(ICON_W, wm_w)
    h = ICON_H + gap + cap
    g = (
        f'<g transform="translate({w/2:.2f},{ICON_H/2:.2f})">\n    '
        + icon_svg(body_colour, wing_colour, accent)
        + f'\n  </g>\n  <g transform="translate({(w-wm_w)/2:.2f},{ICON_H+gap+cap:.2f})">\n    '
        + wm
        + "\n  </g>"
    )
    svg = wrap(w, h, g, bg)
    open(os.path.join(OUT, name + ".svg"), "w").write(svg)
    return svg


def build_horizontal(name, body_colour, wing_colour, accent, text_colour, bg=None):
    wm, wm_w, cap = wordmark_paths("GARZAHIVE", FONT, 102.0, 17.0, text_colour)
    gap = 58.0
    w = ICON_W + gap + wm_w
    h = ICON_H
    g = (
        f'<g transform="translate({ICON_W/2:.2f},{h/2:.2f})">\n    '
        + icon_svg(body_colour, wing_colour, accent)
        + f'\n  </g>\n  <g transform="translate({ICON_W+gap:.2f},{h/2+cap/2:.2f})">\n    '
        + wm
        + "\n  </g>"
    )
    svg = wrap(w, h, g, bg)
    open(os.path.join(OUT, name + ".svg"), "w").write(svg)
    return svg


def build_wordmark(name, colour, bg=None):
    wm, wm_w, cap = wordmark_paths("GARZAHIVE", FONT, WM_SIZE, WM_TRACK, colour)
    svg = wrap(wm_w, cap, f'<g transform="translate(0,{cap:.2f})">\n    {wm}\n  </g>', bg)
    open(os.path.join(OUT, name + ".svg"), "w").write(svg)
    return svg


if __name__ == "__main__":
    # primary
    build_vertical("logo-primary-vertical", CHARCOAL, AMBER, AMBER, CHARCOAL)
    build_horizontal("logo-primary-horizontal", CHARCOAL, AMBER, AMBER, CHARCOAL)
    # reversed (for dark backgrounds)
    build_vertical("logo-reversed-vertical", WHITE, AMBER, AMBER, WHITE)
    build_horizontal("logo-reversed-horizontal", WHITE, AMBER, AMBER, WHITE)
    # monochrome
    build_horizontal("logo-mono-charcoal", CHARCOAL, CHARCOAL, CHARCOAL, CHARCOAL)
    build_horizontal("logo-mono-white", WHITE, WHITE, WHITE, WHITE)
    build_horizontal("logo-mono-amber", AMBER, AMBER, AMBER, AMBER)
    # icon only
    build_icon("icon-primary", CHARCOAL, AMBER, AMBER)
    build_icon("icon-reversed", WHITE, AMBER, AMBER)
    build_icon("icon-mono-charcoal", CHARCOAL, CHARCOAL, CHARCOAL)
    build_icon("icon-mono-white", WHITE, WHITE, WHITE)
    # wordmark only
    build_wordmark("wordmark-charcoal", CHARCOAL)
    build_wordmark("wordmark-white", WHITE)
    print("icon box", round(ICON_W, 1), "x", round(ICON_H, 1))
    print("wrote", len(os.listdir(OUT)), "files to", OUT)
