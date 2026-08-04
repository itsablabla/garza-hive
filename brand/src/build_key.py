#!/usr/bin/env python3
"""GarzaHive — Logo Key (brand identity sheet), fully vector PDF."""
import os, math
from reportlab.lib.pagesizes import letter, landscape
from reportlab.lib.colors import HexColor, Color
from reportlab.pdfgen import canvas as rl_canvas
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.ttfonts import TTFont as RLTTFont

import build_logo as L

HERE = os.path.dirname(os.path.abspath(__file__))
FONTS = os.path.join(os.path.dirname(HERE), "fonts")
for w in ("Regular", "Medium", "SemiBold", "Bold"):
    pdfmetrics.registerFont(RLTTFont(f"Outfit-{w}", os.path.join(FONTS, f"Outfit-{w}.ttf")))

REG, MED, SEMI, BOLD = "Outfit-Regular", "Outfit-Medium", "Outfit-SemiBold", "Outfit-Bold"

PAGE = landscape(letter)          # 792 x 612 pt
PW, PH = PAGE
M = 46                            # page margin

# palette
CHARCOAL = HexColor("#1C1B19")
AMBER    = HexColor("#D19900")
PAPER    = HexColor("#F7F6F2")
SURFACE  = HexColor("#FBFBF9")
BORDER   = HexColor("#D4D1CA")
MUTED    = HexColor("#7A7974")
FAINT    = HexColor("#BAB9B4")
TEAL     = HexColor("#0C4E54")
INK_DARK = HexColor("#171614")
WHITE    = HexColor("#FFFFFF")
RED      = HexColor("#A13544")

PAGE_NO = [0]


# ------------------------------------------------------------------ helpers
def draw_icon(c, cx, cy, height, body=CHARCOAL, wing=AMBER, accent=AMBER,
              outline_only=False, grid=False, grid_on_top=True):
    """Draw the bee mark centred at (cx,cy) scaled so its height == `height`."""
    s = height / L.ICON_H
    c.saveState()
    c.translate(cx, cy)
    c.scale(s, -s)                       # flip: logo units are y-down
    def _grid():
            c.setStrokeColor(Color(0.12,0.44,0.47,alpha=0.45))
            c.setLineWidth(0.6 / s)
            # band pitch lines
            pitch = (2 * L.RY) / L.BANDS
            for i in range(L.BANDS + 1):
                y = -L.RY + i * pitch
                c.line(-L.ICON_W / 2, y, L.ICON_W / 2, y)
            c.line(0, -L.ICON_H / 2 - 14 / s, 0, L.ICON_H / 2 + 14 / s)
            for sign in (-1, 1):
                c.line(sign * L.RX, -L.RY - 10 / s, sign * L.RX, L.RY + 10 / s)
                c.line(sign * L.WING_CX, -L.RY - 10 / s, sign * L.WING_CX, L.RY + 10 / s)
            c.setStrokeColor(Color(0.05,0.31,0.33,alpha=0.9))
            c.setLineWidth(0.8 / s)
            c.rect(-L.ICON_W / 2, -L.ICON_H / 2, L.ICON_W, L.ICON_H, stroke=1, fill=0)


    if grid and not grid_on_top:
        _grid()

    # wings
    for sign in (-1, 1):
        pts = L.hexagon(sign * L.WING_CX, L.WING_CY, L.WING_R,
                        rot_deg=sign * L.WING_ROT, pointy_top=False)
        p = c.beginPath()
        p.moveTo(*pts[0])
        for pt in pts[1:]:
            p.lineTo(*pt)
        p.close()
        c.setLineWidth(L.WING_STROKE)
        c.setLineJoin(1)
        if outline_only:
            c.setStrokeColor(wing)
            c.setLineWidth(2.0 / s)
            c.drawPath(p, stroke=1, fill=0)
        else:
            c.setStrokeColor(wing)
            c.drawPath(p, stroke=1, fill=0)
    # bands
    for i, (pts, _) in enumerate(L.band_polys()):
        p = c.beginPath()
        p.moveTo(*pts[0])
        for pt in pts[1:]:
            p.lineTo(*pt)
        p.close()
        if outline_only:
            c.setStrokeColor(body)
            c.setLineWidth(2.0 / s)
            c.drawPath(p, stroke=1, fill=0)
        else:
            c.setFillColor(accent if i == 1 else body)
            c.drawPath(p, stroke=0, fill=1)
    if grid and grid_on_top:
        _grid()
    c.restoreState()


def wm_width(text, size, track):
    return pdfmetrics.stringWidth(text, SEMI, size) + track * (len(text) - 1)


def draw_wordmark(c, x, y, size, colour, track_ratio=0.17, text="GARZAHIVE"):
    """Baseline-left wordmark. Returns width."""
    track = size * track_ratio
    c.setFont(SEMI, size)
    c.setFillColor(colour)
    cx = x
    for ch in text:
        c.drawString(cx, y, ch)
        cx += pdfmetrics.stringWidth(ch, SEMI, size) + track
    return cx - x - track


def lockup_h_width(icon_h):
    icon_w = icon_h * (L.ICON_W / L.ICON_H)
    size = icon_h * 0.472
    return icon_w + icon_h * 0.268 + wm_width("GARZAHIVE", size, size * 0.17)


def fit_h(box_w, box_h, pad=0.0):
    """Largest horizontal-lockup icon height that fits a box."""
    unit = lockup_h_width(1.0)
    return min((box_w - 2 * pad) / unit, box_h - 2 * pad)


def lockup_v_size(icon_h):
    size = icon_h * 0.370
    cap = size * 0.703
    w = max(wm_width("GARZAHIVE", size, size * 0.17), icon_h * (L.ICON_W / L.ICON_H))
    return w, icon_h + icon_h * 0.315 + cap


def fit_v(box_w, box_h, pad=0.0):
    uw, uh = lockup_v_size(1.0)
    return min((box_w - 2 * pad) / uw, (box_h - 2 * pad) / uh)


def draw_lockup_h(c, x, y, icon_h, body=CHARCOAL, wing=AMBER, accent=AMBER,
                  text=CHARCOAL):
    """Horizontal lockup, x/y = left/vertical-centre. Returns total width."""
    icon_w = icon_h * (L.ICON_W / L.ICON_H)
    draw_icon(c, x + icon_w / 2, y, icon_h, body, wing, accent)
    size = icon_h * 0.472
    gap = icon_h * 0.268
    cap = size * 0.703
    w = draw_wordmark(c, x + icon_w + gap, y - cap / 2, size, text)
    return icon_w + gap + w


def draw_lockup_h_centred(c, cx, cy, icon_h, **kw):
    return draw_lockup_h(c, cx - lockup_h_width(icon_h) / 2, cy, icon_h, **kw)


def draw_lockup_v(c, cx, cy, icon_h, body=CHARCOAL, wing=AMBER, accent=AMBER,
                  text=CHARCOAL):
    """Vertical lockup centred on (cx, cy). Returns (width, height)."""
    size = icon_h * 0.370
    cap = size * 0.703
    gap = icon_h * 0.315
    total_h = icon_h + gap + cap
    w = wm_width("GARZAHIVE", size, size * 0.17)
    top = cy + total_h / 2
    draw_icon(c, cx, top - icon_h / 2, icon_h, body, wing, accent)
    draw_wordmark(c, cx - w / 2, top - icon_h - gap - cap, size, text)
    return max(w, icon_h * (L.ICON_W / L.ICON_H)), total_h


# ------------------------------------------------------------------ chrome
def page_frame(c, kicker, title, dark=False):
    PAGE_NO[0] += 1
    bg = INK_DARK if dark else PAPER
    c.setFillColor(bg)
    c.rect(0, 0, PW, PH, stroke=0, fill=1)
    ink = WHITE if dark else CHARCOAL
    sub = FAINT if dark else MUTED

    c.setFillColor(AMBER)
    c.setFont(SEMI, 8.5)
    c.drawString(M, PH - M - 2, kicker.upper())
    c.setFillColor(ink)
    c.setFont(SEMI, 25)
    c.drawString(M, PH - M - 30, title)
    c.setStrokeColor(HexColor("#3A3936") if dark else BORDER)
    c.setLineWidth(0.8)
    c.line(M, PH - M - 46, PW - M, PH - M - 46)

    # footer
    c.setFont(REG, 7.5)
    c.setFillColor(sub)
    c.drawString(M, M - 16, "GarzaHive Logo Key  ·  v1.0  ·  August 2026")
    c.setFont(MED, 7.5)
    c.drawRightString(PW - M, M - 16, f"{PAGE_NO[0]:02d}")


def body_text(c, x, y, lines, size=9.3, leading=13.6, colour=None, font=REG,
              width=None):
    c.setFont(font, size)
    c.setFillColor(colour or MUTED)
    for ln in lines:
        c.drawString(x, y, ln)
        y -= leading
    return y


def label(c, x, y, text, colour=None, size=8.2):
    c.setFont(SEMI, size)
    c.setFillColor(colour or CHARCOAL)
    c.drawString(x, y, text)


def card(c, x, y, w, h, fill=None, stroke=BORDER, radius=6):
    c.setFillColor(fill or SURFACE)
    c.setStrokeColor(stroke)
    c.setLineWidth(0.8)
    c.roundRect(x, y, w, h, radius, stroke=1, fill=1)


# ------------------------------------------------------------------ pages
def p_cover(c):
    PAGE_NO[0] += 1
    c.setFillColor(INK_DARK)
    c.rect(0, 0, PW, PH, stroke=0, fill=1)
    # amber rule
    c.setFillColor(AMBER)
    c.rect(0, PH - 8, PW, 8, stroke=0, fill=1)

    draw_lockup_v(c, PW / 2, PH / 2 + 40, 146, body=WHITE, wing=AMBER,
                  accent=AMBER, text=WHITE)

    c.setFillColor(FAINT)
    c.setFont(MED, 10.5)
    c.drawCentredString(PW / 2, PH / 2 - 132, "Y O U R   A I   T E A M .   A T   H O M E .")

    c.setFillColor(AMBER)
    c.setFont(SEMI, 9)
    c.drawCentredString(PW / 2, 118, "LOGO KEY")
    c.setFillColor(HexColor("#8A8987"))
    c.setFont(REG, 8.5)
    c.drawCentredString(PW / 2, 100, "Identity system, construction, colour and usage rules  ·  Version 1.0  ·  August 2026")
    c.setFont(REG, 7.5)
    c.drawCentredString(PW / 2, 62,
                        "Visual language derived from the Hivekeep open-source agent platform  ·  github.com/MarlBurroW/hivekeep")
    c.showPage()


def p_primary(c):
    page_frame(c, "01 — The mark", "Primary logo")
    y = PH - M - 80

    # main lockup on a card
    cw = PW - 2 * M
    card(c, M, y - 240, cw * 0.60, 240, fill=WHITE)
    draw_lockup_v(c, M + cw * 0.30, y - 120, 132)

    tx = M + cw * 0.62
    yy = y - 14
    label(c, tx, yy, "CONCEPT", AMBER, 8)
    yy = body_text(c, tx, yy - 18, [
        "The mark reduces a bee to pure hive geometry. The abdomen is a",
        "single hexagon sliced into four bands; the wings are two flat-top",
        "hexagons in outline. Nothing is illustrated — every edge is drawn",
        "from the same hexagonal grid the honeycomb is built on.",
    ])
    yy -= 8
    label(c, tx, yy, "WHY IT FITS GARZAHIVE", AMBER, 8)
    yy = body_text(c, tx, yy - 18, [
        "Four bands read as four agents in one body — a household of",
        "specialists, not a single assistant. The wings are drawn as open",
        "outlines rather than solids: the platform is self-hosted and open,",
        "with nothing sealed off. Amber marks the one active cell, the",
        "signature the rest of the system inherits.",
    ])
    yy -= 8
    label(c, tx, yy, "TONE", AMBER, 8)
    body_text(c, tx, yy - 18, [
        "Warm, geometric, engineered. Consumer-approachable on the",
        "surface; precise underneath.",
    ])
    c.showPage()


def p_construction(c):
    page_frame(c, "02 — Geometry", "Construction")
    y = PH - M - 76
    cw = PW - 2 * M

    card(c, M, y - 250, cw * 0.55, 250, fill=WHITE)
    draw_icon(c, M + cw * 0.275, y - 125, 168, grid=True)

    tx = M + cw * 0.58
    yy = y - 14
    label(c, tx, yy, "PROPORTIONS", AMBER, 8)
    yy -= 20
    rows = [
        ("Icon bounding box", "2.065 : 1  (W : H)"),
        ("Body hexagon", "0.852 H wide × 1.000 H tall"),
        ("Hexagon type", "Flat top & bottom, pointed sides"),
        ("Band pitch", "H / 4  (four equal bands)"),
        ("Band gap", "0.037 H"),
        ("Accent band", "Band 2, counted from the top"),
        ("Wing radius", "0.338 H  (flat-top hexagon)"),
        ("Wing centre", "± 0.653 H from axis, − 0.139 H"),
        ("Wing rotation", "14° outward, mirrored"),
        ("Wing stroke", "0.083 H, round joins"),
    ]
    c.setFont(REG, 8.8)
    for k, v in rows:
        c.setFillColor(MUTED)
        c.setFont(REG, 8.8)
        c.drawString(tx, yy, k)
        c.setFillColor(CHARCOAL)
        c.setFont(MED, 8.8)
        c.drawRightString(PW - M, yy, v)
        c.setStrokeColor(BORDER)
        c.setLineWidth(0.4)
        c.line(tx, yy - 5, PW - M, yy - 5)
        yy -= 17.5

    yy -= 6
    body_text(c, tx, yy, [
        "All values are expressed as multiples of H, the icon height, so the",
        "mark rebuilds cleanly at any size. Never redraw by eye — scale the",
        "supplied vector.",
    ], size=8.4, leading=12)
    c.showPage()


def p_clearspace(c):
    page_frame(c, "03 — Spacing & scale", "Clear space and minimum size")
    y = PH - M - 74
    cw = PW - 2 * M

    # ---- clear space panel
    panel_w = cw * 0.55
    card(c, M, y - 250, panel_w, 250, fill=WHITE)

    icon_h = fit_h(panel_w, 250, pad=52)
    icon_w = icon_h * (L.ICON_W / L.ICON_H)
    lw = lockup_h_width(icon_h)
    X = icon_h / 4.0                      # clear space unit = one band pitch

    lx = M + (panel_w - lw) / 2
    ly = y - 118
    # clear-space boundary
    c.setStrokeColor(HexColor("#E2B65C"))
    c.setDash(3, 3)
    c.setLineWidth(0.9)
    c.rect(lx - X, ly - icon_h / 2 - X, lw + 2 * X, icon_h + 2 * X, stroke=1, fill=0)
    c.setDash()
    # X swatches
    c.setFillColor(HexColor("#FBEDCF"))
    c.rect(lx - X, ly - icon_h / 2 - X, X, X, stroke=0, fill=1)
    c.rect(lx + lw, ly + icon_h / 2, X, X, stroke=0, fill=1)
    c.setFillColor(HexColor("#9A7413"))
    c.setFont(SEMI, 8)
    c.drawCentredString(lx - X / 2, ly - icon_h / 2 - X / 2 - 3, "X")
    c.drawCentredString(lx + lw + X / 2, ly + icon_h / 2 + X / 2 - 3, "X")

    draw_lockup_h(c, lx, ly, icon_h)

    c.setFillColor(MUTED)
    c.setFont(REG, 8.2)
    c.drawCentredString(M + panel_w / 2, y - 232,
                        "X = one band pitch = 1/4 of the icon height. Keep X clear on all four sides.")

    # ---- minimum size panel
    px = M + panel_w + 22
    pwid = PW - M - px
    card(c, px, y - 250, pwid, 250, fill=WHITE)

    label(c, px + 20, y - 24, "MINIMUM SIZE", AMBER, 8)
    sizes = [
        ("Horizontal lockup", "132 px", "35 mm"),
        ("Vertical lockup", "104 px", "28 mm"),
        ("Icon only", "24 px", "7 mm"),
        ("Favicon / 16 px", "use single-colour icon", "—"),
    ]
    yy = y - 46
    for name, dig, prt in sizes:
        c.setFillColor(CHARCOAL); c.setFont(MED, 8.8)
        c.drawString(px + 20, yy, name)
        c.setFillColor(MUTED); c.setFont(REG, 8.8)
        c.drawRightString(px + pwid - 100, yy, dig)
        c.drawRightString(px + pwid - 20, yy, prt)
        c.setStrokeColor(BORDER); c.setLineWidth(0.4)
        c.line(px + 20, yy - 5, px + pwid - 20, yy - 5)
        yy -= 17.5
    c.setFillColor(FAINT); c.setFont(REG, 7.3)
    c.drawRightString(px + pwid - 100, yy + 2, "SCREEN")
    c.drawRightString(px + pwid - 20, yy + 2, "PRINT")

    # scale ladder
    yy -= 30
    label(c, px + 20, yy, "SCALE LADDER", AMBER, 8)
    ladder = (48, 32, 22, 15)
    ratio = L.ICON_W / L.ICON_H
    gap_l = 13
    total = sum(h * ratio for h in ladder) + gap_l * (len(ladder) - 1)
    bx = px + (pwid - total) / 2
    by = yy - 40
    for h in ladder:
        w_ = h * ratio
        draw_icon(c, bx + w_ / 2, by, h)
        c.setFillColor(FAINT); c.setFont(REG, 6.4)
        c.drawCentredString(bx + w_ / 2, by - 32, f"{h}px")
        bx += w_ + gap_l
    c.setFillColor(MUTED); c.setFont(REG, 7.8)
    c.drawCentredString(px + pwid / 2, y - 238,
                        "Below 24 px the bands close up — switch to the single-colour icon.")
    c.showPage()


def p_variants(c):
    page_frame(c, "04 — Variants", "Approved lockups")
    y = PH - M - 78
    cw = PW - 2 * M
    colw = (cw - 2 * 18) / 3
    rowh = 152

    def cell(col, row, title, note, dark=False, draw=None):
        x = M + col * (colw + 18)
        yy = y - row * (rowh + 20) - rowh
        card(c, x, yy, colw, rowh, fill=INK_DARK if dark else WHITE,
             stroke=HexColor("#3A3936") if dark else BORDER)
        draw(x + colw / 2, yy + rowh / 2 + 13)
        c.setFillColor(WHITE if dark else CHARCOAL); c.setFont(MED, 8.4)
        c.drawCentredString(x + colw / 2, yy + 22, title)
        c.setFillColor(FAINT if dark else MUTED); c.setFont(REG, 7.3)
        c.drawCentredString(x + colw / 2, yy + 11, note)

    art_h = rowh - 56
    ih_h = fit_h(colw - 40, art_h)          # horizontal lockup icon height
    ih_v = fit_v(colw - 40, art_h)          # vertical lockup icon height

    cell(0, 0, "Primary — vertical", "Default. Square-ish placements.",
         draw=lambda cx, cy: draw_lockup_v(c, cx, cy, ih_v))
    cell(1, 0, "Primary — horizontal", "Headers, nav bars, README banners.",
         draw=lambda cx, cy: draw_lockup_h_centred(c, cx, cy, ih_h))
    cell(2, 0, "Reversed", "On charcoal and photography.", dark=True,
         draw=lambda cx, cy: draw_lockup_h_centred(c, cx, cy, ih_h, body=WHITE,
                                                   text=WHITE))

    cell(0, 1, "Mono — charcoal", "One-colour print, engraving, fax-grade.",
         draw=lambda cx, cy: draw_lockup_h_centred(c, cx, cy, ih_h,
                                                   body=CHARCOAL, wing=CHARCOAL,
                                                   accent=CHARCOAL, text=CHARCOAL))
    cell(1, 1, "Mono — white", "Dark or busy backgrounds.", dark=True,
         draw=lambda cx, cy: draw_lockup_h_centred(c, cx, cy, ih_h, body=WHITE,
                                                   wing=WHITE, accent=WHITE,
                                                   text=WHITE))
    cell(2, 1, "Icon + wordmark, separated", "Icon alone once the brand is established.",
         draw=lambda cx, cy: _split_demo(c, cx, cy, colw))
    c.showPage()


def _split_demo(c, cx, cy, colw):
    avail = colw - 40
    ih, size, gap = 44.0, 16.0, 22.0
    unit = ih * (L.ICON_W / L.ICON_H) + gap + wm_width("GARZAHIVE", size, size * 0.17)
    k = min(1.0, avail / unit)
    ih, size, gap = ih * k, size * k, gap * k
    iw = ih * (L.ICON_W / L.ICON_H)
    tw = wm_width("GARZAHIVE", size, size * 0.17)
    x0 = cx - (iw + gap + tw) / 2
    draw_icon(c, x0 + iw / 2, cy, ih)
    draw_wordmark(c, x0 + iw + gap, cy - size * 0.703 / 2, size, CHARCOAL)


def p_colour(c):
    page_frame(c, "05 — Colour", "Palette")
    y = PH - M - 80
    cw = PW - 2 * M

    core = [
        ("Hive Amber", "#D19900", "209 · 153 · 0", "0 · 27 · 100 · 18", "7549 C",
         "Accent only. The active cell, wings, rules and CTAs.", False),
        ("Hive Charcoal", "#1C1B19", "28 · 27 · 25", "0 · 4 · 11 · 89", "Black 6 C",
         "Body bands, wordmark, primary text.", False),
    ]
    support = [
        ("Comb White", "#F7F6F2", "247 · 246 · 242", "Backgrounds, reversed lockups"),
        ("Deep Teal", "#0C4E54", "12 · 78 · 84", "Secondary UI accent, links"),
        ("Ink", "#171614", "23 · 22 · 20", "Dark-mode surfaces"),
        ("Border", "#D4D1CA", "212 · 209 · 202", "Dividers, card edges"),
    ]

    sw = (cw - 18) / 2
    for i, (name, hexv, rgb, cmyk, pms, use, dark) in enumerate(core):
        x = M + i * (sw + 18)
        card(c, x, y - 176, sw, 176, fill=WHITE)
        c.setFillColor(HexColor(hexv))
        c.roundRect(x + 16, y - 104, 108, 88, 5, stroke=0, fill=1)
        tx = x + 140
        c.setFillColor(CHARCOAL); c.setFont(SEMI, 13)
        c.drawString(tx, y - 34, name)
        yy = y - 54
        for k, v in (("HEX", hexv), ("RGB", rgb), ("CMYK", cmyk), ("PANTONE", pms)):
            c.setFillColor(FAINT); c.setFont(REG, 7.2)
            c.drawString(tx, yy, k)
            c.setFillColor(CHARCOAL); c.setFont(MED, 8.8)
            c.drawString(tx + 58, yy, v + ("  (nearest match)" if k == "PANTONE" else ""))
            yy -= 15
        c.setFillColor(MUTED); c.setFont(REG, 8)
        c.drawString(x + 16, y - 132, use[:56])
        if len(use) > 56:
            c.drawString(x + 16, y - 144, use[56:])

    y2 = y - 200
    label(c, M, y2, "SUPPORTING", AMBER, 8)
    bw = (cw - 3 * 14) / 4
    for i, (name, hexv, rgb, use) in enumerate(support):
        x = M + i * (bw + 14)
        card(c, x, y2 - 120, bw, 104, fill=WHITE)
        c.setFillColor(HexColor(hexv))
        c.setStrokeColor(BORDER); c.setLineWidth(0.6)
        c.roundRect(x + 14, y2 - 66, bw - 28, 40, 4, stroke=1, fill=1)
        c.setFillColor(CHARCOAL); c.setFont(MED, 9)
        c.drawString(x + 14, y2 - 82, name)
        c.setFillColor(MUTED); c.setFont(REG, 7.6)
        c.drawString(x + 14, y2 - 94, f"{hexv}   {rgb}")
        c.setFillColor(FAINT); c.setFont(REG, 7)
        c.drawString(x + 14, y2 - 106, use[:34])

    c.setFillColor(MUTED); c.setFont(REG, 8.2)
    c.drawString(M, M + 24,
                 "Amber is the only accent. Charcoal on Comb White clears 15.1:1; white on Ink clears 13.4:1 — both well past WCAG AA.")
    c.drawString(M, M + 11,
                 "Amber on Comb White is 2.6:1 — never use it for body text. Amber is for shapes, rules and large display type only.")
    c.showPage()


def p_type(c):
    page_frame(c, "06 — Typography", "Wordmark and brand type")
    y = PH - M - 82
    cw = PW - 2 * M

    card(c, M, y - 128, cw, 128, fill=WHITE)
    size = 42
    tw = wm_width("GARZAHIVE", size, size * 0.17)
    draw_wordmark(c, M + (cw - tw) / 2, y - 78, size, CHARCOAL)
    c.setFillColor(MUTED); c.setFont(REG, 8.2)
    c.drawCentredString(M + cw / 2, y - 108,
                        "Outfit SemiBold  ·  all caps  ·  +170 tracking  ·  set as one word, never “Garza Hive”")

    y2 = y - 152
    colw = (cw - 20) / 2
    card(c, M, y2 - 200, colw, 200, fill=WHITE)
    label(c, M + 18, y2 - 26, "WORDMARK RULES", AMBER, 8)
    body_text(c, M + 18, y2 - 46, [
        "Always one word, capitalised GARZAHIVE, in the lockup.",
        "In running prose write GarzaHive — camel case, no space.",
        "Tracking is fixed at +170. Do not re-space by hand.",
        "Never substitute a different typeface for the wordmark;",
        "use the supplied outlined vector.",
        "The wordmark may be used alone where the icon is already",
        "present nearby, e.g. a footer under an app icon.",
    ], size=8.6, leading=13.2)

    px = M + colw + 20
    card(c, px, y2 - 200, colw, 200, fill=WHITE)
    label(c, px + 18, y2 - 26, "SUPPORTING TYPE", AMBER, 8)
    yy = y2 - 48
    scale = [
        ("Display", "Outfit SemiBold", SEMI, 18, "Your AI team."),
        ("Heading", "Outfit Medium", MED, 13, "Your AI team. At home."),
        ("Body", "Outfit Regular", REG, 9.5, "Your AI team. At home."),
        ("Code / logs", "JetBrains Mono", REG, 8.5, "agent.recall(\"memory\")"),
    ]
    for role, fname, fnt, sz, sample in scale:
        c.setFillColor(FAINT); c.setFont(REG, 7.2)
        c.drawString(px + 18, yy + 2, role.upper())
        c.setFillColor(CHARCOAL); c.setFont(fnt, sz)
        c.drawString(px + 86, yy, sample)
        c.setFillColor(MUTED); c.setFont(REG, 7.2)
        c.drawRightString(px + colw - 18, yy + 2, fname)
        c.setStrokeColor(BORDER); c.setLineWidth(0.4)
        c.line(px + 18, yy - 10, px + colw - 18, yy - 10)
        yy -= 38
    c.setFillColor(MUTED); c.setFont(REG, 8)
    c.drawString(px + 18, y2 - 190, "Outfit is open licence (OFL) — safe to ship in the app and docs.")
    c.showPage()


def p_backgrounds(c):
    page_frame(c, "07 — Placement", "Backgrounds")
    y = PH - M - 78
    cw = PW - 2 * M
    bw = (cw - 3 * 16) / 4
    bh = 132

    ih_bg = fit_v(bw, bh, pad=18)

    tiles = [
        ("Comb White", PAPER, False, True),
        ("Ink", INK_DARK, True, True),
        ("Hive Amber", AMBER, False, True),
        ("Deep Teal", TEAL, True, True),
    ]
    for i, (name, bg, dark, ok) in enumerate(tiles):
        x = M + i * (bw + 16)
        c.setFillColor(bg); c.setStrokeColor(BORDER); c.setLineWidth(0.8)
        c.roundRect(x, y - bh, bw, bh, 6, stroke=1, fill=1)
        if name == "Hive Amber":
            draw_lockup_v(c, x + bw / 2, y - bh / 2, ih_bg, body=CHARCOAL,
                          wing=CHARCOAL, accent=CHARCOAL, text=CHARCOAL)
            note = "Single-colour charcoal only"
        elif dark:
            draw_lockup_v(c, x + bw / 2, y - bh / 2, ih_bg, body=WHITE, text=WHITE)
            note = "Reversed lockup"
        else:
            draw_lockup_v(c, x + bw / 2, y - bh / 2, ih_bg)
            note = "Primary lockup"
        c.setFillColor(CHARCOAL); c.setFont(MED, 8.6)
        c.drawString(x, y - bh - 16, name)
        c.setFillColor(MUTED); c.setFont(REG, 7.6)
        c.drawString(x, y - bh - 27, note)

    y2 = y - bh - 56
    colw = (cw - 20) / 2
    card(c, M, y2 - 168, colw, 168, fill=WHITE)
    label(c, M + 18, y2 - 26, "SAFE PLACEMENT", AMBER, 8)
    body_text(c, M + 18, y2 - 46, [
        "Prefer flat backgrounds. On photography, place the reversed",
        "lockup over an area of even tone, or set a charcoal scrim at",
        "60% opacity behind it.",
        "On amber the mark must be single-colour charcoal — the amber",
        "band would otherwise disappear into the background.",
        "Contrast between the mark and its background must reach 3:1",
        "at minimum.",
    ], size=8.6, leading=13.2)

    px = M + colw + 20
    card(c, px, y2 - 168, colw, 168, fill=WHITE)
    label(c, px + 18, y2 - 26, "APPLICATION DEFAULTS", AMBER, 8)
    rows = [
        ("App icon / PWA", "Icon on Ink, 12% corner radius"),
        ("Favicon", "Mono charcoal icon, 16 & 32 px"),
        ("GitHub README", "Horizontal lockup, reversed variant"),
        ("Docs site header", "Horizontal lockup, 32 px icon height"),
        ("Terminal / CLI splash", "Mono white icon, ASCII fallback"),
        ("Agent avatars", "Never the logo — use per-agent avatars"),
    ]
    yy = y2 - 48
    for k, v in rows:
        c.setFillColor(CHARCOAL); c.setFont(MED, 8.5)
        c.drawString(px + 18, yy, k)
        c.setFillColor(MUTED); c.setFont(REG, 8.2)
        c.drawRightString(px + colw - 18, yy, v)
        c.setStrokeColor(BORDER); c.setLineWidth(0.4)
        c.line(px + 18, yy - 5, px + colw - 18, yy - 5)
        yy -= 18
    c.showPage()


def p_misuse(c):
    page_frame(c, "08 — Misuse", "What not to do")
    y = PH - M - 78
    cw = PW - 2 * M
    colw = (cw - 3 * 16) / 4
    rowh = 138

    def x_badge(x, yb):
        c.setFillColor(RED)
        c.circle(x + colw - 18, yb + rowh - 18, 8, stroke=0, fill=1)
        c.setStrokeColor(WHITE); c.setLineWidth(1.6)
        c.line(x + colw - 21.5, yb + rowh - 21.5, x + colw - 14.5, yb + rowh - 14.5)
        c.line(x + colw - 21.5, yb + rowh - 14.5, x + colw - 14.5, yb + rowh - 21.5)

    items = []

    def add(title, drawfn):
        items.append((title, drawfn))

    add("Don't recolour the bands", lambda cx, cy: draw_icon(
        c, cx, cy, 60, body=HexColor("#3A6FB0"), wing=HexColor("#8E44AD"),
        accent=HexColor("#27AE60")))
    add("Don't stretch or squash", None)
    add("Don't rotate the mark", None)
    add("Don't add effects", None)
    add("Don't reorder the bands", lambda cx, cy: draw_icon(
        c, cx, cy, 60, body=CHARCOAL, wing=AMBER, accent=CHARCOAL))
    add("Don't fill the wings", None)
    add("Don't respace the wordmark", None)
    add("Don't box or outline it", None)

    for i, (title, fn) in enumerate(items):
        col, row = i % 4, i // 4
        x = M + col * (colw + 16)
        yb = y - row * (rowh + 30) - rowh
        card(c, x, yb, colw, rowh, fill=WHITE)
        cx, cy = x + colw / 2, yb + rowh / 2 + 6

        if fn:
            fn(cx, cy)
        elif title.startswith("Don't stretch"):
            c.saveState(); c.translate(cx, cy); c.scale(1.0, 0.55)
            draw_icon(c, 0, 0, 60); c.restoreState()
        elif title.startswith("Don't rotate"):
            c.saveState(); c.translate(cx, cy); c.rotate(18)
            draw_icon(c, 0, 0, 58); c.restoreState()
        elif title.startswith("Don't add"):
            for k in range(7):
                c.setFillColor(Color(0.82, 0.6, 0, alpha=0.10))
                draw_icon(c, cx + 1.2 * k, cy - 1.2 * k, 60,
                          body=Color(0.1, 0.1, 0.1, alpha=0.10),
                          wing=Color(0.82, 0.6, 0, alpha=0.10),
                          accent=Color(0.82, 0.6, 0, alpha=0.10))
            draw_icon(c, cx, cy, 60)
        elif title.startswith("Don't fill"):
            c.saveState(); c.translate(cx, cy)
            s = 60 / L.ICON_H
            c.scale(s, -s)
            for sign in (-1, 1):
                pts = L.hexagon(sign * L.WING_CX, L.WING_CY, L.WING_R,
                                rot_deg=sign * L.WING_ROT, pointy_top=False)
                p = c.beginPath(); p.moveTo(*pts[0])
                for pt in pts[1:]:
                    p.lineTo(*pt)
                p.close()
                c.setFillColor(AMBER); c.drawPath(p, stroke=0, fill=1)
            for j, (pts, _) in enumerate(L.band_polys()):
                p = c.beginPath(); p.moveTo(*pts[0])
                for pt in pts[1:]:
                    p.lineTo(*pt)
                p.close()
                c.setFillColor(AMBER if j == 1 else CHARCOAL)
                c.drawPath(p, stroke=0, fill=1)
            c.restoreState()
        elif title.startswith("Don't respace"):
            tw = wm_width("GARZAHIVE", 15, 15 * 0.02)
            draw_wordmark(c, cx - tw / 2, cy + 6, 15, CHARCOAL, track_ratio=0.02)
            c.setFillColor(MUTED); c.setFont(REG, 7)
            c.drawCentredString(cx, cy - 14, "tracking removed")
        elif title.startswith("Don't box"):
            c.setStrokeColor(CHARCOAL); c.setLineWidth(2.4)
            c.roundRect(cx - 62, cy - 34, 124, 68, 8, stroke=1, fill=0)
            draw_icon(c, cx, cy, 48)

        x_badge(x, yb)
        c.setFillColor(CHARCOAL); c.setFont(MED, 8.3)
        c.drawCentredString(cx, yb - 14, title)

    c.setFillColor(MUTED); c.setFont(REG, 8.2)
    c.drawString(M, M + 8,
                 "If a placement seems to need one of the above, the placement is wrong — change the layout, not the logo.")
    c.showPage()


def p_assets(c):
    page_frame(c, "09 — Files", "Asset index")
    y = PH - M - 80
    cw = PW - 2 * M

    groups = [
        ("Lockups", [
            ("logo-primary-vertical.svg", "Default mark. Square and stacked placements."),
            ("logo-primary-horizontal.svg", "Headers, nav, banners."),
            ("logo-reversed-vertical.svg", "White body, amber wings — dark grounds."),
            ("logo-reversed-horizontal.svg", "White body, amber wings — dark grounds."),
        ]),
        ("Single colour", [
            ("logo-mono-charcoal.svg", "One-colour print and engraving."),
            ("logo-mono-white.svg", "Dark, busy or photographic grounds."),
            ("logo-mono-amber.svg", "Amber-on-dark accent use only."),
        ]),
        ("Icon & wordmark", [
            ("icon-primary.svg  ·  icon-reversed.svg", "App icon, avatar slot, favicon source."),
            ("icon-mono-charcoal.svg  ·  icon-mono-white.svg", "Small sizes, 24 px and below."),
            ("wordmark-charcoal.svg  ·  wordmark-white.svg", "Type-only, where the icon appears nearby."),
        ]),
    ]

    colw = (cw - 2 * 16) / 3
    for i, (gname, rows) in enumerate(groups):
        x = M + i * (colw + 16)
        card(c, x, y - 216, colw, 216, fill=WHITE)
        label(c, x + 16, y - 26, gname.upper(), AMBER, 8)
        yy = y - 50
        for fn, desc in rows:
            c.setFillColor(CHARCOAL); c.setFont(MED, 7.9)
            c.drawString(x + 16, yy, fn)
            c.setFillColor(MUTED); c.setFont(REG, 7.4)
            words, line = desc.split(), ""
            ly = yy - 11
            for wd in words:
                t = (line + " " + wd).strip()
                if pdfmetrics.stringWidth(t, REG, 7.4) > colw - 32:
                    c.drawString(x + 16, ly, line); ly -= 9.6; line = wd
                else:
                    line = t
            if line:
                c.drawString(x + 16, ly, line)
            yy = ly - 18

    y2 = y - 240
    card(c, M, y2 - 92, cw, 92, fill=WHITE)
    label(c, M + 18, y2 - 24, "PRODUCTION NOTES", AMBER, 8)
    body_text(c, M + 18, y2 - 44, [
        "All artwork is generated parametrically from build_logo.py — edit the constants at the top of that file to retune the geometry, then regenerate. Every SVG has a transparent background",
        "and no clipping mask. The wordmark ships as outlined paths, so no font install is required to render the logo. Outfit (SIL Open Font Licence) is only needed for supporting typography.",
        "Raster exports: render the SVG at the target pixel width rather than upscaling a PNG. For favicons export the mono icon at 16, 32, 48 and 180 px.",
    ], size=8.2, leading=13)
    c.showPage()


def main():
    out = os.path.join(os.path.dirname(HERE), "GarzaHive-Logo-Key.pdf")
    c = rl_canvas.Canvas(out, pagesize=PAGE)
    c.setTitle("GarzaHive — Logo Key")
    c.setAuthor("Garza")
    p_cover(c)
    p_primary(c)
    p_construction(c)
    p_clearspace(c)
    p_variants(c)
    p_colour(c)
    p_type(c)
    p_backgrounds(c)
    p_misuse(c)
    p_assets(c)
    c.save()
    print("wrote", out)


if __name__ == "__main__":
    main()
