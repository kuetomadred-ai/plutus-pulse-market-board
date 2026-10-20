#!/usr/bin/env python3
"""Generate platform launcher icons from the checked-in MT5 app icon source."""
from pathlib import Path
from PIL import Image

ROOT = Path(__file__).resolve().parents[1]
SOURCE = ROOT / "public/plotos/assets/mt5-app-icon.png"
RES = ROOT / "android/app/src/main/res"
IOS_ICON = ROOT / "ios/App/App/Assets.xcassets/AppIcon.appiconset/AppIcon-512@2x.png"
WEB_ASSETS = ROOT / "public/plotos/assets"

source = Image.open(SOURCE).convert("RGB")
if source.size[0] != source.size[1]:
    raise SystemExit(f"Expected a square source icon, got {source.size}")

def resized(size: int) -> Image.Image:
    return source.resize((size, size), Image.Resampling.LANCZOS)

# Android legacy launcher icons; Android applies the round mask when needed.
legacy_sizes = {"mdpi": 48, "hdpi": 72, "xhdpi": 96, "xxhdpi": 144, "xxxhdpi": 192}
adaptive_sizes = {"mdpi": 108, "hdpi": 162, "xhdpi": 216, "xxhdpi": 324, "xxxhdpi": 432}
for density, size in legacy_sizes.items():
    folder = RES / f"mipmap-{density}"
    folder.mkdir(parents=True, exist_ok=True)
    for name in ("ic_launcher.png", "ic_launcher_round.png"):
        resized(size).save(folder / name, format="PNG", optimize=True)

# The complete official icon is the adaptive background layer. The empty
# foreground prevents Android's safe-zone scaling from cropping its artwork.
background = RES / "drawable-nodpi/mt5_launcher_background.png"
background.parent.mkdir(parents=True, exist_ok=True)
source.save(background, format="PNG", optimize=True)
for density, size in adaptive_sizes.items():
    folder = RES / f"mipmap-{density}"
    Image.new("RGBA", (size, size), (0, 0, 0, 0)).save(
        folder / "ic_launcher_foreground.png", format="PNG", optimize=True
    )

# Apple requires a 1024x1024 universal App Store icon.
IOS_ICON.parent.mkdir(parents=True, exist_ok=True)
resized(1024).save(IOS_ICON, format="PNG", optimize=True)

# Standard installable web-app icon sizes.
resized(192).save(WEB_ASSETS / "mt5-app-icon-192.png", format="PNG", optimize=True)
print("Generated Android, iOS, and web icons from", SOURCE)
