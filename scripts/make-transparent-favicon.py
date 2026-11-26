"""Remove the dark tile + pale frame from the signal mark; write transparent PNG favicons."""

from __future__ import annotations

from collections import deque
from pathlib import Path

from PIL import Image

ROOT = Path(__file__).resolve().parents[1]
SRC = ROOT / "public" / "brand" / "intrisal-icon-signal-1024.png"
OUT_DIR = ROOT / "public" / "brand"
APP_DIR = ROOT / "app"


def is_dark(r: int, g: int, b: int) -> bool:
    return (0.2126 * r + 0.7152 * g + 0.0722 * b) <= 82


def is_pale_frame(r: int, g: int, b: int) -> bool:
    """Outer white/gray frame only — not warm cream logo paint."""
    chroma = max(r, g, b) - min(r, g, b)
    return chroma <= 30 and abs(r - g) <= 16 and abs(g - b) <= 16 and (r - b) < 18


def flood(px, w: int, h: int, should_clear, seeds: list[tuple[int, int]]) -> None:
    seen = bytearray(w * h)
    q: deque[int] = deque()

    def try_seed(x: int, y: int) -> None:
        i = y * w + x
        if seen[i]:
            return
        r, g, b, _a = px[x, y]
        if should_clear(r, g, b):
            seen[i] = 1
            q.append(i)

    for x, y in seeds:
        try_seed(x, y)

    while q:
        i = q.popleft()
        x, y = i % w, i // w
        px[x, y] = (0, 0, 0, 0)
        for nx, ny in ((x - 1, y), (x + 1, y), (x, y - 1), (x, y + 1)):
            if nx < 0 or ny < 0 or nx >= w or ny >= h:
                continue
            ni = ny * w + nx
            if seen[ni]:
                continue
            r, g, b, _a = px[nx, ny]
            if should_clear(r, g, b):
                seen[ni] = 1
                q.append(ni)


def knock_out(im: Image.Image) -> Image.Image:
    rgba = im.convert("RGBA")
    w, h = rgba.size
    px = rgba.load()
    assert px is not None

    edge = [(x, 0) for x in range(w)] + [(x, h - 1) for x in range(w)]
    edge += [(0, y) for y in range(h)] + [(w - 1, y) for y in range(h)]

    # 1) Clear the pale outer frame (edge-connected only, so logo tip stays).
    flood(px, w, h, is_pale_frame, edge)

    # 2) Clear the charcoal tile (edge + interior dark seeds).
    dark_seeds = list(edge)
    for y in range(0, h, 6):
        for x in range(0, w, 6):
            r, g, b, _a = px[x, y]
            if r < 40 and g < 40 and b < 40:
                dark_seeds.append((x, y))
    flood(px, w, h, is_dark, dark_seeds)

    # Leftover enclosed dark crumbs.
    for y in range(h):
        for x in range(w):
            r, g, b, a = px[x, y]
            if a and is_dark(r, g, b):
                px[x, y] = (0, 0, 0, 0)
    return rgba


def trim_transparent(im: Image.Image, pad_ratio: float = 0.14) -> Image.Image:
    bbox = im.split()[-1].getbbox()
    if not bbox:
        raise SystemExit("No logo pixels remained after knockout.")
    cropped = im.crop(bbox)
    pad = max(4, int(max(cropped.size) * pad_ratio))
    canvas = Image.new("RGBA", (cropped.width + pad * 2, cropped.height + pad * 2), (0, 0, 0, 0))
    canvas.paste(cropped, (pad, pad), cropped)
    return canvas


def fit_square(im: Image.Image, size: int) -> Image.Image:
    canvas = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    target = int(size * 0.88)
    fitted = im.copy()
    fitted.thumbnail((target, target), Image.Resampling.LANCZOS)
    canvas.paste(fitted, ((size - fitted.width) // 2, (size - fitted.height) // 2), fitted)
    return canvas


def main() -> None:
    if not SRC.exists():
        raise SystemExit(f"Missing source {SRC}")

    transparent = trim_transparent(knock_out(Image.open(SRC)))
    print(f"trimmed={transparent.size}")

    targets = {
        OUT_DIR / "favicon-16.png": 16,
        OUT_DIR / "favicon-32.png": 32,
        OUT_DIR / "favicon-48.png": 48,
        OUT_DIR / "intrisal-icon-signal-64.png": 64,
        OUT_DIR / "intrisal-icon-signal-128.png": 128,
        OUT_DIR / "intrisal-icon-signal-256.png": 256,
        OUT_DIR / "intrisal-icon-signal-512.png": 512,
        APP_DIR / "icon.png": 256,
        APP_DIR / "apple-icon.png": 180,
    }

    fit_square(transparent, 1024).save(OUT_DIR / "intrisal-icon-signal-transparent-1024.png", "PNG", optimize=True)
    for path, size in targets.items():
        fit_square(transparent, size).save(path, "PNG", optimize=True)
        print(f"wrote {path.relative_to(ROOT)}")

    preview = Image.new("RGB", (512, 512), (255, 0, 255))
    mark = fit_square(transparent, 512)
    preview.paste(mark, (0, 0), mark)
    preview.save(OUT_DIR / "favicon-preview-on-magenta.jpg", "JPEG", quality=92)


if __name__ == "__main__":
    main()
