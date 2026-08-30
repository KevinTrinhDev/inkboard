#!/usr/bin/env python3
"""
Generates inkboard's app icons.

The PWA manifest referenced /icons/icon-192.png and /icons/icon-512.png and
neither file existed: the directory held only a README saying so. A manifest
pointing at two 404s means iOS falls back to a screenshot thumbnail when you
"Add to Home Screen", which is the first thing anyone sees of the product.

The mark is one confident pen stroke: the whole product is a pen stroke that
stays data instead of becoming pixels.

Kept in the repo rather than committing opaque binaries alone, so the mark can
be regenerated or adjusted without a design tool.

Usage:  python3 scripts/make-icons.py
Needs:  pillow  (pip install pillow)
"""

from pathlib import Path

from PIL import Image, ImageDraw

OUT = Path(__file__).resolve().parent.parent / "apps" / "client" / "public" / "icons"

BG = (16, 16, 18, 255)        # near-black, matches the app's dark chrome
STROKE = (74, 222, 128, 255)  # the green the pre-flight "ok" dot uses

# Supersample then downscale: clean antialiasing with no external rasterizer,
# so this runs anywhere Pillow does.
SS = 6


def bezier(p0, p1, p2, p3, steps):
    """Cubic bezier, sampled densely enough to stamp as a continuous stroke."""
    out = []
    for i in range(steps + 1):
        t = i / steps
        u = 1 - t
        x = u**3 * p0[0] + 3 * u**2 * t * p1[0] + 3 * u * t**2 * p2[0] + t**3 * p3[0]
        y = u**3 * p0[1] + 3 * u**2 * t * p1[1] + 3 * u * t**2 * p2[1] + t**3 * p3[1]
        out.append((x, y))
    return out


def stamp(draw, points, width, fill):
    """
    Draws a stroke by stamping a filled circle at every sampled point.

    Pillow's line(joint="curve") leaves visible notches on a tight curve at
    this weight; stamping gives a genuinely round-capped, smooth stroke.
    """
    r = width / 2
    for x, y in points:
        draw.ellipse([x - r, y - r, x + r, y + r], fill=fill)


def rounded_mask(size, radius_ratio):
    mask = Image.new("L", (size, size), 0)
    ImageDraw.Draw(mask).rounded_rectangle(
        [0, 0, size - 1, size - 1], radius=int(size * radius_ratio), fill=255
    )
    return mask


def render(px, radius_ratio=0.225, content_scale=1.0):
    size = px * SS
    img = Image.new("RGBA", (size, size), BG)
    d = ImageDraw.Draw(img)

    inset = (1 - content_scale) / 2 * size
    inner = size - 2 * inset

    def P(fx, fy):
        return (inset + fx * inner, inset + fy * inner)

    # One sweeping stroke, drawn as two joined beziers so it reads as
    # handwriting rather than a logo swoosh.
    pts = bezier(P(0.20, 0.66), P(0.34, 0.30), P(0.52, 0.86), P(0.66, 0.46), 400)
    pts += bezier(P(0.66, 0.46), P(0.73, 0.26), P(0.80, 0.30), P(0.82, 0.40), 200)

    stamp(d, pts, inner * 0.105, STROKE)

    if radius_ratio > 0:
        img.putalpha(rounded_mask(size, radius_ratio))

    return img.resize((px, px), Image.LANCZOS)


def main():
    OUT.mkdir(parents=True, exist_ok=True)

    # Manifest icons: rounded, because Android and desktop do not mask them.
    render(192).save(OUT / "icon-192.png")
    render(512).save(OUT / "icon-512.png")

    # Maskable: full bleed, artwork inside the safe zone that survives cropping.
    render(512, radius_ratio=0, content_scale=0.66).save(OUT / "icon-512-maskable.png")

    # iOS applies its own squircle mask, so ship this square and full bleed.
    render(180, radius_ratio=0).save(OUT / "apple-touch-icon-180.png")

    for f in sorted(OUT.glob("*.png")):
        print(f"{f.name}: {f.stat().st_size} bytes")


if __name__ == "__main__":
    main()
