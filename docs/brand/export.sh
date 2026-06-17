#!/usr/bin/env bash
# Export production raster assets from the generated SVGs.
# PNGs are Lanczos-downsampled from a 2048 master for clean anti-aliasing.
# Requires: ImageMagick (magick), iconutil (macOS).
set -euo pipefail
cd "$(dirname "$0")"

A=assets
D=dist
ICONSET="$D/mim.iconset"
rm -rf "$D"; mkdir -p "$D" "$ICONSET"

# ---- canonical names (chosen: weight 600, charcoal tile) ----
cp "$A/wordmark-600-charcoal.svg" "$D/mim-os-wordmark.svg"
cp "$A/wordmark-600-white.svg"    "$D/mim-os-wordmark-white.svg"
cp "$A/m-600-charcoal.svg"        "$D/mim-m.svg"
cp "$A/m-600-white.svg"           "$D/mim-m-white.svg"
cp "$A/icon-dark-macos.svg"       "$D/mim-icon.svg"
cp "$A/icon-dark-bleed.svg"       "$D/favicon.svg"

# ---- masters ----
magick -background none -density 1200 "$A/icon-dark-macos.svg" -resize 2048x2048 "$D/_master.png"
magick -background none -density 1200 "$A/icon-dark-bleed.svg" -resize 2048x2048 "$D/_master-bleed.png"

png () { magick "$1" -filter Lanczos -resize "${2}x${2}" -strip "$3"; }

# ---- app icon PNGs (margined) ----
for s in 16 32 64 128 256 512 1024; do
  png "$D/_master.png" "$s" "$D/mim-icon-${s}.png"
done

# ---- macOS .iconset -> .icns ----
declare -a MAP=(
  "16:icon_16x16" "32:icon_16x16@2x" "32:icon_32x32" "64:icon_32x32@2x"
  "128:icon_128x128" "256:icon_128x128@2x" "256:icon_256x256" "512:icon_256x256@2x"
  "512:icon_512x512" "1024:icon_512x512@2x"
)
for pair in "${MAP[@]}"; do
  s="${pair%%:*}"; name="${pair##*:}"
  png "$D/_master.png" "$s" "$ICONSET/${name}.png"
done
iconutil -c icns "$ICONSET" -o "$D/mim.icns"

# ---- favicons (full-bleed) ----
for s in 16 32 48 180; do
  png "$D/_master-bleed.png" "$s" "$D/favicon-${s}.png"
done
cp "$D/favicon-180.png" "$D/apple-touch-icon.png"
magick "$D/favicon-16.png" "$D/favicon-32.png" "$D/favicon-48.png" "$D/favicon.ico"

rm -f "$D/_master.png" "$D/_master-bleed.png"
rm -rf "$ICONSET"

echo "== dist =="
ls -1 "$D"
