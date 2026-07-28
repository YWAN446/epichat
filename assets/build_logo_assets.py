"""Derive EpiChat's logo asset set from the master artwork.

The master (``logo-source.png``) is rendered on an opaque off-white card. Everything
downstream — the website, the Streamlit app, favicons — needs the mark on transparency,
plus a variant whose near-black bubble stroke survives a dark background.

Run from the repo root::

    python assets/build_logo_assets.py

Outputs land in ``assets/`` (app) and are mirrored into ``docs/brand/`` (GitHub Pages
serves ``docs/`` and must be self-contained).
"""

from __future__ import annotations

import shutil
from pathlib import Path

import numpy as np
from PIL import Image, ImageDraw, ImageFilter, ImageFont

REPO = Path(__file__).resolve().parent.parent
ASSETS = REPO / "assets"
BRAND = REPO / "docs" / "brand"

SOURCE = ASSETS / "logo-source.png"

# Alphas below this are background noise in the master render, not artwork.
ALPHA_FLOOR = 0.08
# Padding around the trimmed mark, as a fraction of its longest side.
PAD_FRAC = 0.04

# Dark-variant targets. The bubble stroke is achromatic and near-black, so it has to be
# re-inked; the green is dark enough that it also needs a lift. The vermilion already
# carries on a dark ground and is left alone.
DARK_INK = np.array([240, 234, 226], dtype=np.float64)
DARK_GREEN = np.array([47, 165, 110], dtype=np.float64)

# --paper / --ink / --ink-3 from docs/styles.css, in sRGB.
PAPER = (247, 244, 238)
INK = (58, 52, 44)
INK_3 = (142, 135, 124)

# Georgia is the site's declared serif fallback, so it is the closest match available
# without shipping a webfont into the build.
SERIF_FONT = r"C:\Windows\Fonts\georgia.ttf"
MONO_FONT = r"C:\Windows\Fonts\consola.ttf"


def key_out_background(img: Image.Image) -> tuple[np.ndarray, np.ndarray]:
    """Un-composite dark artwork from its opaque light background.

    Returns (rgb, alpha) with rgb unpremultiplied and alpha in [0, 1].
    """
    arr = np.asarray(img.convert("RGB"), dtype=np.float64)

    # Background = median of a 12px border frame, which is pure card everywhere.
    b = 12
    frame = np.concatenate(
        [
            arr[:b].reshape(-1, 3),
            arr[-b:].reshape(-1, 3),
            arr[:, :b].reshape(-1, 3),
            arr[:, -b:].reshape(-1, 3),
        ]
    )
    bg = np.median(frame, axis=0)

    # p = a*F + (1-a)*bg. Assuming the darkest channel of F reaches 0 gives the alpha.
    ratio = np.clip(arr / np.maximum(bg, 1.0), 0.0, 1.0)
    alpha = 1.0 - ratio.min(axis=2)

    # Knee: drop render noise to zero, then rescale so real edges keep full opacity.
    alpha = np.where(alpha < ALPHA_FLOOR, 0.0, (alpha - ALPHA_FLOOR) / (1.0 - ALPHA_FLOOR))

    safe = np.maximum(alpha, 1e-6)[..., None]
    rgb = np.clip((arr - (1.0 - alpha)[..., None] * bg) / safe, 0, 255)
    return rgb, alpha


def to_dark_variant(rgb: np.ndarray, alpha: np.ndarray) -> np.ndarray:
    """Re-ink the mark so it reads on a dark ground."""
    out = rgb.copy()
    mx = rgb.max(axis=2)
    mn = rgb.min(axis=2)
    chroma = mx - mn

    # Bubble stroke: low chroma. Map its darkness onto light ink (black -> ink, and
    # lighter greys stay proportionally closer to the background they came from).
    stroke = (chroma < 34) & (alpha > 0)
    darkness = (1.0 - mx / 255.0)[..., None]
    out[stroke] = (DARK_INK * darkness + rgb * (1.0 - darkness))[stroke]

    # Green nodes: lift toward a mid green, preserving the relative shading.
    green = (~stroke) & (rgb[..., 1] >= rgb[..., 0]) & (rgb[..., 1] >= rgb[..., 2])
    lift = np.clip((255.0 - mx) / 255.0, 0, 1)[..., None]
    out[green] = (DARK_GREEN * lift + rgb * (1.0 - lift))[green]

    return np.clip(out, 0, 255)


def to_simplified(rgb: np.ndarray, alpha: np.ndarray) -> tuple[np.ndarray, np.ndarray]:
    """Reduce the mark to what survives a 16px favicon.

    The full cluster is ~120 nodes joined by hairline edges; below about 48px that
    resolves to coloured noise. A morphological opening erases every stroke and dot
    thinner than the structuring element, leaving the bubble and the major nodes —
    the same artwork, just the parts a browser tab can actually render.
    """
    mx = rgb.max(axis=2)
    mn = rgb.min(axis=2)
    chroma = mx - mn
    solid = alpha > 0.55

    stroke = ((chroma < 34) & solid).astype(np.uint8) * 255
    nodes = ((chroma >= 34) & solid).astype(np.uint8) * 255

    # Opening (erode then dilate) on the node mask drops hairline edges and micro-dots.
    # The trailing dilation re-admits each surviving node's antialiased rim and fattens
    # it a little, so a node still occupies a whole pixel once scaled to 16px.
    kept_nodes = (
        Image.fromarray(nodes, mode="L")
        .filter(ImageFilter.MinFilter(19))
        .filter(ImageFilter.MaxFilter(19))
        .filter(ImageFilter.MaxFilter(7))
    )
    node_alpha = alpha * (np.asarray(kept_nodes) > 127)

    # The bubble outline is a single hairline; thicken it so it survives downscaling.
    stroke_mask = np.asarray(
        Image.fromarray(stroke, mode="L").filter(ImageFilter.MaxFilter(17))
    ) > 127

    # Flat ink for the bubble, original colour and antialiasing for the nodes on top.
    out_rgb = np.where(stroke_mask[..., None], np.array([26.0, 24.0, 20.0]), rgb)
    out_rgb = np.where((node_alpha > 0)[..., None], rgb, out_rgb)
    out_alpha = np.maximum(stroke_mask.astype(np.float64), node_alpha)
    return out_rgb, out_alpha


def compose(rgb: np.ndarray, alpha: np.ndarray) -> Image.Image:
    rgba = np.dstack([rgb, alpha * 255.0]).astype(np.uint8)
    return Image.fromarray(rgba, mode="RGBA")


def trim_box(alpha: np.ndarray, pad_frac: float = PAD_FRAC) -> tuple[int, int, int, int]:
    ys, xs = np.nonzero(alpha > 0.02)
    x0, x1 = int(xs.min()), int(xs.max()) + 1
    y0, y1 = int(ys.min()), int(ys.max()) + 1

    # Square it up around the mark's centre so every export shares one aspect ratio.
    side = max(x1 - x0, y1 - y0)
    side = int(side * (1 + 2 * pad_frac))
    cx, cy = (x0 + x1) // 2, (y0 + y1) // 2
    return cx - side // 2, cy - side // 2, cx + side // 2, cy + side // 2


def crop_padded(img: Image.Image, box: tuple[int, int, int, int]) -> Image.Image:
    """Crop, letting the box run past the canvas — the overflow becomes transparency."""
    x0, y0, x1, y1 = box
    out = Image.new("RGBA", (x1 - x0, y1 - y0), (0, 0, 0, 0))
    out.paste(img.crop(box), (0, 0))
    return out


def on_paper(img: Image.Image, size: int, inset: float = 0.12) -> Image.Image:
    """Flatten the mark onto an opaque paper tile (iOS ignores icon transparency)."""
    tile = Image.new("RGBA", (size, size), PAPER + (255,))
    inner = int(size * (1 - 2 * inset))
    m = img.resize((inner, inner), Image.LANCZOS)
    off = (size - inner) // 2
    tile.paste(m, (off, off), m)
    return tile.convert("RGB")


def build_og_image(mark: Image.Image, path: Path) -> None:
    """1200x630 link preview: the mark, the name, the promise."""
    W, H = 1200, 630
    card = Image.new("RGB", (W, H), PAPER)
    d = ImageDraw.Draw(card)

    size = 300
    m = mark.resize((size, size), Image.LANCZOS)
    card.paste(m, (96, (H - size) // 2 - 10), m)

    try:
        title = ImageFont.truetype(SERIF_FONT, 92)
        body = ImageFont.truetype(SERIF_FONT, 33)
        label = ImageFont.truetype(MONO_FONT, 21)
    except OSError:
        print("  ! system fonts unavailable — skipping og-image")
        return

    x = 470
    d.line([(x, 168), (x + 88, 168)], fill=INK_3, width=2)
    d.text((x, 190), "C I D M A T H  ·  E M O R Y", font=label, fill=INK_3)
    d.text((x, 226), "EpiChat", font=title, fill=INK)
    d.text(
        (x, 348),
        "Ask an epidemiological question.\nGet a validated simulation.",
        font=body,
        fill=INK,
        spacing=12,
    )

    path.parent.mkdir(parents=True, exist_ok=True)
    card.save(path, optimize=True)
    print(f"  {path.relative_to(REPO)}  {W}x{H}")


def save_sized(img: Image.Image, path: Path, size: int) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    img.resize((size, size), Image.LANCZOS).save(path, optimize=True)
    print(f"  {path.relative_to(REPO)}  {size}x{size}")


def main() -> None:
    if not SOURCE.exists():
        raise SystemExit(f"master artwork not found: {SOURCE}")

    print(f"reading {SOURCE.relative_to(REPO)}")
    rgb, alpha = key_out_background(Image.open(SOURCE))
    box = trim_box(alpha)

    simple_rgb, simple_alpha = to_simplified(rgb, alpha)
    # Favicons get no breathing room — every pixel of a 16px box counts.
    icon_box = trim_box(simple_alpha, pad_frac=0.0)

    light = crop_padded(compose(rgb, alpha), box)
    dark = crop_padded(compose(to_dark_variant(rgb, alpha), alpha), box)
    icon = crop_padded(compose(simple_rgb, simple_alpha), icon_box)
    icon_dark = crop_padded(
        compose(to_dark_variant(simple_rgb, simple_alpha), simple_alpha), icon_box
    )

    print("writing assets/")
    save_sized(light, ASSETS / "epichat-logo.png", 1024)
    save_sized(dark, ASSETS / "epichat-logo-dark.png", 1024)
    save_sized(icon_dark, ASSETS / "epichat-icon-dark.png", 256)
    save_sized(icon, ASSETS / "epichat-icon.png", 256)

    print("writing docs/brand/")
    save_sized(light, BRAND / "epichat-logo.png", 1024)
    save_sized(dark, BRAND / "epichat-logo-dark.png", 1024)
    save_sized(icon, BRAND / "epichat-icon.png", 256)
    save_sized(icon_dark, BRAND / "epichat-icon-dark.png", 256)

    apple = BRAND / "apple-touch-icon.png"
    on_paper(icon, 180).save(apple, optimize=True)
    print(f"  {apple.relative_to(REPO)}  180x180 (opaque)")

    ico = BRAND / "favicon.ico"
    icon.resize((256, 256), Image.LANCZOS).save(
        ico, sizes=[(16, 16), (32, 32), (48, 48)]
    )
    print(f"  {ico.relative_to(REPO)}  multi-size")

    build_og_image(light, BRAND / "og-image.png")


if __name__ == "__main__":
    main()
