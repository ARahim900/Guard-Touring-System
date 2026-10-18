"""
Generate every app icon and logo file from the official Muscat Bay logo.

Why this script exists
----------------------
The logo supplied (brand/muscat_bay.png) is only 400 x 400 px; the stripe
mark inside it is about 90 x 90 px. App stores need a 1024 x 1024 px icon, and
simply enlarging 90 px to 1024 px gives blurred, stair-stepped edges.

The mark is pure geometry (a square holding three teal vertical bars and three
purple 45-degree stripes), so it is REDRAWN here as exact shapes, using edge
positions measured from the supplied file to a fraction of a pixel. That gives
perfectly sharp icons at any size. The wordmark (Arabic + "MUSCAT BAY") is
enlarged only moderately, for the splash and login screens.

When Marketing supplies the original vector logo (SVG/AI/PDF), use that for the
store listing artwork, and replace brand/muscat_bay.png with a large export
(>= 1600 px wide) before running again:

    python3 brand/generate_assets.py

Requires Python 3 with Pillow (pip install pillow).
"""
from pathlib import Path

from PIL import Image, ImageDraw

ROOT = Path(__file__).resolve().parent.parent
SRC = ROOT / "brand" / "muscat_bay.png"

# Exact colours sampled from the supplied logo.
PURPLE = (110, 105, 127)  # #6E697F
TEAL = (174, 223, 226)    # #AEDFE2
WHITE = (255, 255, 255)

# App icons use the official logo colours (chosen by the owner, Oct 2026): the
# mark reversed out of the logo purple, with logo-teal bars and white stripes.
# BRAND_* are the brand framework tones still used inside the portal UI.
BRAND_PURPLE = (78, 68, 86)    # #4E4456
BRAND_TEAL = (164, 197, 187)   # #A4C5BB

# ---------------------------------------------------------------------------
# Geometry of the mark, measured from the supplied file (units: source pixels,
# the mark's square runs from 0.5 to 89.7 on both axes).
# ---------------------------------------------------------------------------
SQ0, SQ1 = 0.5, 89.7
TEAL_BARS = [(0.6, 12.7), (29.2, 41.4), (57.8, 70.0)]  # x ranges
TEAL_CUT = 70.6                                          # bars end where x + y = 70.6
PURPLE_BANDS = [(90.4, 106.1), (127.3, 142.3), (164.4, 999)]  # ranges of x + y


def clip(poly, keep):
    """Sutherland-Hodgman: keep the part of polygon `poly` where keep(p) >= 0."""
    out = []
    for i, cur in enumerate(poly):
        prev = poly[i - 1]
        fc, fp = keep(cur), keep(prev)
        if fc >= 0:
            if fp < 0:
                t = fp / (fp - fc)
                out.append((prev[0] + t * (cur[0] - prev[0]), prev[1] + t * (cur[1] - prev[1])))
            out.append(cur)
        elif fp >= 0:
            t = fp / (fp - fc)
            out.append((prev[0] + t * (cur[0] - prev[0]), prev[1] + t * (cur[1] - prev[1])))
    return out


def draw_mark(size: int, bars=TEAL, stripes=PURPLE) -> Image.Image:
    """The stripe mark as sharp vector shapes, `size` px square, transparent."""
    ss = 8  # draw 8x larger, then shrink: smooth anti-aliased edges
    big = Image.new("RGBA", (size * ss, size * ss), (0, 0, 0, 0))
    d = ImageDraw.Draw(big)
    k = size * ss / (SQ1 - SQ0)
    to_px = lambda poly: [((x - SQ0) * k, (y - SQ0) * k) for x, y in poly]
    square = [(SQ0, SQ0), (SQ1, SQ0), (SQ1, SQ1), (SQ0, SQ1)]

    for x0, x1 in TEAL_BARS:
        bar = clip(square, lambda p, x0=x0: p[0] - x0)
        bar = clip(bar, lambda p, x1=x1: x1 - p[0])
        bar = clip(bar, lambda p: TEAL_CUT - (p[0] + p[1]))
        if len(bar) >= 3:
            d.polygon(to_px(bar), fill=bars)

    for s0, s1 in PURPLE_BANDS:
        band = clip(square, lambda p, s0=s0: (p[0] + p[1]) - s0)
        band = clip(band, lambda p, s1=s1: s1 - (p[0] + p[1]))
        if len(band) >= 3:
            d.polygon(to_px(band), fill=stripes)

    return big.resize((size, size), Image.LANCZOS)


def trim(img: Image.Image) -> Image.Image:
    return img.crop(img.getchannel("A").point(lambda v: 255 if v > 40 else 0).getbbox())


def enlarge_wordmark(img: Image.Image, width: int) -> Image.Image:
    """Moderate enlargement of the text, with a gentle edge tidy (no hard sharpening)."""
    h = round(img.height * width / img.width)
    big = img.resize((width, h), Image.LANCZOS)
    alpha = big.getchannel("A").point(lambda v: 0 if v < 25 else 255 if v > 230 else int((v - 25) * 255 / 205))
    solid = Image.new("RGBA", big.size, PURPLE + (0,))
    solid.putalpha(alpha)
    return solid


def full_logo(width: int, source: Image.Image) -> Image.Image:
    """Vector mark + enlarged wordmark, laid out as in the supplied logo."""
    full = trim(source)
    a = full.getchannel("A")
    rows = [any(a.getpixel((x, y)) > 60 for x in range(full.width)) for y in range(full.height)]
    gap_start = rows.index(False, rows.index(True))
    words_top = rows.index(True, gap_start)
    mark_box = trim(full.crop((0, 0, full.width, gap_start)))
    words = trim(full.crop((0, words_top, full.width, full.height)))

    k = width / full.width
    mark_px = round(mark_box.width * k)
    gap_px = round((words_top - gap_start) * k)
    words_img = enlarge_wordmark(words, width)
    canvas = Image.new("RGBA", (width, mark_px + gap_px + words_img.height), (0, 0, 0, 0))
    canvas.alpha_composite(draw_mark(mark_px), ((width - mark_px) // 2, 0))
    canvas.alpha_composite(words_img, (0, mark_px + gap_px))
    return canvas


def on_canvas(art: Image.Image, size: int, fill_ratio: float, bg=None) -> Image.Image:
    """Centre `art` on a square canvas; its longer side = fill_ratio * size."""
    canvas = Image.new("RGBA", (size, size), (bg + (255,)) if bg else (0, 0, 0, 0))
    k = size * fill_ratio / max(art.size)
    art = art.resize((round(art.width * k), round(art.height * k)), Image.LANCZOS)
    canvas.alpha_composite(art, ((size - art.width) // 2, (size - art.height) // 2))
    return canvas


def main():
    source = Image.open(SRC).convert("RGBA")
    guard = ROOT / "apps" / "guard" / "assets"
    portal = ROOT / "apps" / "portal" / "public"

    # Icons use the mark only: the wordmark is unreadable at icon size.
    reversed_mark = lambda size: draw_mark(size, TEAL, WHITE)
    # iOS / store icon: no transparency allowed -> Deep Purple background.
    on_canvas(reversed_mark(1024), 1024, 0.6, PURPLE).convert("RGB").save(guard / "icon.png")
    # Android adaptive icon foreground: transparent, inside the 66% safe circle.
    # Its logo-purple background is set in app.config.ts (adaptiveIcon.backgroundColor).
    on_canvas(reversed_mark(1024), 1024, 0.46).save(guard / "adaptive-icon.png")

    logo = full_logo(1200, source)
    # Splash screen: full logo, transparent (background colour is set in app.config.ts).
    on_canvas(logo, 1024, 0.92).save(guard / "splash-icon.png")
    logo.resize((800, round(logo.height * 800 / logo.width)), Image.LANCZOS).save(guard / "logo.png")

    # Portal
    on_canvas(reversed_mark(64), 64, 0.72, PURPLE).save(portal / "favicon.png")
    on_canvas(reversed_mark(180), 180, 0.6, PURPLE).convert("RGB").save(portal / "apple-touch-icon.png")
    # Installed web app (PWA) icon; 0.6 keeps the mark inside the maskable safe zone.
    on_canvas(reversed_mark(1024), 1024, 0.6, PURPLE).convert("RGB").save(portal / "patrol-icon.png")
    logo.resize((800, round(logo.height * 800 / logo.width)), Image.LANCZOS).save(portal / "muscat-bay-logo.png")
    draw_mark(256).save(portal / "muscat-bay-mark.png")

    # Preview sheet for a quick visual check (not used by the apps).
    # Each tile is shown on the background the phone will use behind it.
    tiles = [("icon.png", guard / "icon.png", WHITE), ("adaptive-icon.png", guard / "adaptive-icon.png", PURPLE), ("splash-icon.png", guard / "splash-icon.png", WHITE)]
    sheet = Image.new("RGB", (1024 * 3 + 80, 1104), (230, 230, 230))
    d = ImageDraw.Draw(sheet)
    for i, (name, path, tile_bg) in enumerate(tiles):
        img = Image.open(path).convert("RGBA")
        bg = Image.new("RGBA", img.size, tile_bg + (255,))
        sheet.paste(Image.alpha_composite(bg, img).convert("RGB"), (20 + i * 1044, 60))
        d.text((20 + i * 1044, 20), name, fill=(0, 0, 0))
    sheet.save(ROOT / "brand" / "preview.png")
    print("Done. Check brand/preview.png")


if __name__ == "__main__":
    main()
