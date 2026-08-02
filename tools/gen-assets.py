#!/usr/bin/env python3
"""Generate the Flyer app icons and splash mark.

Kept as a script rather than committing only the PNGs so the logo can be
regenerated at any size when the launcher or store requirements change.

The mark is a speech bubble with a paper plane inside it: the bubble says
"chat", the plane says "sent", and both read clearly at 48px where a more
detailed drawing would turn to mush.

    python3 tools/gen-assets.py

Writes assets/icon.png, assets/adaptive-icon.png, assets/splash-icon.png and
assets/notification-icon.png.
"""

import os
from PIL import Image, ImageDraw

GREEN = (37, 211, 102, 255)   # WhatsApp-family accent, matches theme.accent
WHITE = (255, 255, 255, 255)
INK = (11, 20, 26, 255)       # theme dark bg, used for the splash backdrop
OUT = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "assets")

# Supersample everything, then downscale: PIL has no antialiased polygon fill,
# so this is what keeps the plane's edges from looking sawn off.
SS = 4


def bubble_and_plane(size, bubble_fill, plane_fill, scale=1.0):
    """Draw the mark centred on a transparent canvas of `size` px."""
    px = size * SS
    img = Image.new("RGBA", (px, px), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)

    # Bubble occupies `scale` of the canvas, leaving room for the tail below.
    w = px * 0.78 * scale
    h = w * 0.86
    left = (px - w) / 2
    top = (px - h) / 2 - h * 0.06
    radius = h * 0.30

    d.rounded_rectangle([left, top, left + w, top + h], radius=radius, fill=bubble_fill)

    # Tail: a soft wedge off the bottom-left, the way every chat bubble does it.
    tail = [
        (left + w * 0.26, top + h * 0.94),
        (left + w * 0.30, top + h * 1.20),
        (left + w * 0.52, top + h * 0.95),
    ]
    d.polygon(tail, fill=bubble_fill)

    # Paper plane, drawn as two triangles so it reads as folded paper rather
    # than a flat arrow: the darker fold is omitted at small sizes anyway.
    cx, cy = left + w / 2, top + h / 2
    s = w * 0.52
    nose = (cx + s * 0.52, cy)
    top_tail = (cx - s * 0.48, cy - s * 0.40)
    bot_tail = (cx - s * 0.48, cy + s * 0.40)
    notch = (cx - s * 0.22, cy)

    d.polygon([nose, top_tail, notch], fill=plane_fill)
    d.polygon([nose, bot_tail, notch], fill=plane_fill)

    return img.resize((size, size), Image.LANCZOS)


def squircle(size, fill, radius_ratio=0.22):
    """Rounded-square backdrop for the legacy (non-adaptive) icon."""
    px = size * SS
    img = Image.new("RGBA", (px, px), (0, 0, 0, 0))
    ImageDraw.Draw(img).rounded_rectangle(
        [0, 0, px - 1, px - 1], radius=px * radius_ratio, fill=fill
    )
    return img.resize((size, size), Image.LANCZOS)


def write(img, name):
    path = os.path.join(OUT, name)
    img.save(path, "PNG")
    print(f"  {name}  {img.size[0]}x{img.size[1]}")


def main():
    os.makedirs(OUT, exist_ok=True)
    print("writing assets:")

    # iOS / legacy Android launcher: green tile, white mark. No transparency —
    # the App Store rejects icons with an alpha channel.
    icon = squircle(1024, GREEN)
    icon.alpha_composite(bubble_and_plane(1024, WHITE, GREEN, scale=0.82))
    write(icon.convert("RGB").convert("RGBA"), "icon.png")

    # Android adaptive foreground: transparent, and the mark sits inside the
    # centre 66% because the launcher crops the outer third to any shape it
    # likes (circle, squircle, teardrop) and masks whatever falls outside.
    write(bubble_and_plane(1024, WHITE, GREEN, scale=0.62), "adaptive-icon.png")

    # Splash: shown on the dark backdrop set in app.config.ts, so the mark is
    # green-on-transparent instead of white.
    write(bubble_and_plane(512, GREEN, INK, scale=0.92), "splash-icon.png")

    # Android notification icon: silhouette only. The system ignores colour and
    # keeps the alpha channel, so anything non-transparent renders solid white.
    write(bubble_and_plane(256, WHITE, (0, 0, 0, 0), scale=0.90), "notification-icon.png")


if __name__ == "__main__":
    main()
