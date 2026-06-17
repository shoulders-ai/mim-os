#!/usr/bin/env python3
"""
Mim OS brand asset generator.

Outlines Satoshi glyphs to vector paths (no font dependency in shipped SVGs),
lays out the `mim OS` wordmark with OS optically matched to the x-height,
and builds the `m` app icon on a true superellipse (squircle).

Run:  python3 brand/generate.py
Out:  brand/assets/*.svg
"""
import math, os
from fontTools.ttLib import TTFont
from fontTools.varLib import instancer
from fontTools.pens.svgPathPen import SVGPathPen
from fontTools.pens.transformPen import TransformPen
from fontTools.pens.boundsPen import BoundsPen

HERE = os.path.dirname(os.path.abspath(__file__))           # docs/brand
ROOT = os.path.dirname(os.path.dirname(HERE))               # repo root
FONT = os.path.join(ROOT, "public/fonts/Satoshi-Variable.ttf")
OUT  = os.path.join(HERE, "assets")                         # generated (gitignored)
os.makedirs(OUT, exist_ok=True)

CHARCOAL = "#1A1A18"
WHITE    = "#FFFFFF"
# `OS` sits a touch lower-contrast than `mim` — a subtle step, not a grey.
OS_CHARCOAL = "#4C4C44"
OS_WHITE    = "#B7B5AB"

# ---- layout tuning (em fractions) ----
MIM_TRACK = -0.005   # lowercase: a hair tight at display size
OS_TRACK  =  0.015   # caps: a touch open
GAP       =  0.15    # space between `mim` and `OS`
ICON_M_FRAC = 0.40   # m x-height as fraction of squircle size (negative space)

def instance(wght):
    f = TTFont(FONT)
    inst = instancer.instantiateVariableFont(f, {"wght": wght})
    return inst

def ntos(v):  # round path numbers -> tidy files
    return f"{v:.1f}".rstrip("0").rstrip(".")

def draw(glyphSet, name, t):
    pen = SVGPathPen(glyphSet, ntos=ntos)
    glyphSet[name].draw(TransformPen(pen, t))
    return pen.getCommands()

def bounds(glyphSet, name, t):
    bp = BoundsPen(glyphSet)
    glyphSet[name].draw(TransformPen(bp, t))
    return bp.bounds  # (xmin,ymin,xmax,ymax) or None

def run(inst, text, sx, sy, penX, track_em):
    """Lay out a run of text. Returns (path_str, penX_end, ink_bounds)."""
    gs, cmap, hmtx = inst.getGlyphSet(), inst.getBestCmap(), inst["hmtx"]
    upm = inst["head"].unitsPerEm
    paths, bb = [], None
    for ch in text:
        name = cmap[ord(ch)]
        t = (sx, 0, 0, -sy, penX, 0)
        d = draw(gs, name, t)
        if d.strip():
            paths.append(d)
        gb = bounds(gs, name, t)
        if gb:
            bb = gb if bb is None else (
                min(bb[0], gb[0]), min(bb[1], gb[1]),
                max(bb[2], gb[2]), max(bb[3], gb[3]))
        penX += hmtx[name][0] * sx + track_em * upm * sx
    return " ".join(paths), penX, bb

def union(*bbs):
    bbs = [b for b in bbs if b]
    return (min(b[0] for b in bbs), min(b[1] for b in bbs),
            max(b[2] for b in bbs), max(b[3] for b in bbs))

def svg(viewbox, body, w=None):
    vb = " ".join(ntos(v) for v in viewbox)
    wattr = f' width="{w}"' if w else ""
    return (f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="{vb}"{wattr}>\n'
            f'{body}\n</svg>\n')

def write(name, content):
    with open(os.path.join(OUT, name), "w") as fh:
        fh.write(content)
    print("  wrote", name)

# ---------- WORDMARK ----------
def wordmark(inst, ratio):
    penX = 0.0
    upm = inst["head"].unitsPerEm
    p_mim, penX, b1 = run(inst, "mim", 1.0, 1.0, penX, MIM_TRACK)
    penX += GAP * upm
    p_os, penX, b2 = run(inst, "OS", ratio, ratio, penX, OS_TRACK)
    xmin, ymin, xmax, ymax = union(b1, b2)
    vb = (xmin, ymin, xmax - xmin, ymax - ymin)
    return vb, p_mim, p_os

# ---------- SQUIRCLE ----------
def squircle(cx, cy, size, n=5.0, samples=720):
    a = size / 2.0
    p = 2.0 / n
    pts = []
    for i in range(samples):
        t = 2 * math.pi * i / samples
        ct, st = math.cos(t), math.sin(t)
        x = math.copysign(abs(ct) ** p, ct) * a
        y = math.copysign(abs(st) ** p, st) * a
        pts.append((cx + x, cy + y))
    return "M " + " L ".join(f"{x:.2f},{y:.2f}" for x, y in pts) + " Z"

def icon(inst, canvas, sq_size, tile_fill, m_fill, m_frac):
    gs = inst.getGlyphSet()
    cmap = inst.getBestCmap()
    name = cmap[ord("m")]
    cx = cy = canvas / 2.0
    sq = squircle(cx, cy, sq_size)
    # measure m at scale 1 (flipped)
    b = bounds(gs, name, (1, 0, 0, -1, 0, 0))
    H = b[3] - b[1]
    s = (m_frac * sq_size) / H
    tx = cx - s * (b[0] + b[2]) / 2.0
    ty = cy - s * (b[1] + b[3]) / 2.0
    d = draw(gs, name, (s, 0, 0, -s, tx, ty))
    body = (f'  <path fill="{tile_fill}" d="{sq}"/>\n'
            f'  <path fill="{m_fill}" d="{d}"/>')
    return svg((0, 0, canvas, canvas), body)

def m_glyph(inst, fill):
    gs = inst.getGlyphSet()
    name = inst.getBestCmap()[ord("m")]
    t = (1, 0, 0, -1, 0, 0)
    d = draw(gs, name, t)
    b = bounds(gs, name, t)
    vb = (b[0], b[1], b[2] - b[0], b[3] - b[1])
    return svg(vb, f'  <path fill="{fill}" d="{d}"/>')

def main():
    f0 = TTFont(FONT)
    os2 = f0["OS/2"]
    ratio = os2.sxHeight / os2.sCapHeight
    print(f"OS scale (x/cap) = {ratio:.4f}")

    for w in (500, 600, 700):
        inst = instance(w)
        vb, d_mim, d_os = wordmark(inst, ratio)
        write(f"wordmark-{w}-charcoal.svg",
              svg(vb, f'  <path fill="{CHARCOAL}" d="{d_mim}"/>\n'
                      f'  <path fill="{OS_CHARCOAL}" d="{d_os}"/>'))
        write(f"wordmark-{w}-white.svg",
              svg(vb, f'  <path fill="{WHITE}" d="{d_mim}"/>\n'
                      f'  <path fill="{OS_WHITE}" d="{d_os}"/>'))
        write(f"m-{w}-charcoal.svg", m_glyph(inst, CHARCOAL))
        write(f"m-{w}-white.svg",    m_glyph(inst, WHITE))

    # theme-adaptive (in-app): currentColor, OS at reduced opacity — adapts to any theme ink
    inst = instance(600)
    vb, d_mim, d_os = wordmark(inst, ratio)
    write("wordmark-adaptive.svg",
          svg(vb, f'  <path fill="currentColor" d="{d_mim}"/>\n'
                  f'  <path fill="currentColor" fill-opacity="0.6" d="{d_os}"/>'))
    write("m-adaptive.svg", m_glyph(inst, "currentColor"))

    # icons at chosen weight 600
    # macOS-style: 1024 canvas, 824 squircle, transparent margin
    write("icon-dark-macos.svg",
          icon(inst, 1024, 824, CHARCOAL, WHITE, ICON_M_FRAC))
    write("icon-light-macos.svg",
          icon(inst, 1024, 824, WHITE, CHARCOAL, ICON_M_FRAC))
    # full-bleed (web / favicon)
    write("icon-dark-bleed.svg",
          icon(inst, 1024, 1024, CHARCOAL, WHITE, ICON_M_FRAC))
    write("icon-light-bleed.svg",
          icon(inst, 1024, 1024, WHITE, CHARCOAL, ICON_M_FRAC))
    print("done.")

if __name__ == "__main__":
    main()
