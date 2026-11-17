#!/bin/sh
set -eu
root_dir=$(CDPATH= cd -- "$(dirname -- "$0")/../.." && pwd)
output_dir="$root_dir/artifacts/mac-overlay"
app_dir="$output_dir/tranRU 透明字幕.app"
mkdir -p "$app_dir/Contents/MacOS" "$output_dir/module-cache"
for cpu in arm64 x86_64; do
  xcrun swiftc -swift-version 5 -O -target "$cpu-apple-macos14.0" -module-cache-path "$output_dir/module-cache" -framework AppKit -framework Network -framework Security "$root_dir/desktop/mac/TranRUOverlay.swift" -o "$output_dir/overlay-$cpu"
done
lipo -create "$output_dir/overlay-arm64" "$output_dir/overlay-x86_64" -output "$app_dir/Contents/MacOS/tranRUOverlay"
cat > "$app_dir/Contents/Info.plist" <<'PLIST'
<?xml version="1.0" encoding="UTF-8"?><!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd"><plist version="1.0"><dict>
<key>CFBundleExecutable</key><string>tranRUOverlay</string><key>CFBundleIdentifier</key><string>com.ruruguy.tranru.overlay</string><key>CFBundleName</key><string>tranRU 透明字幕</string><key>CFBundleDisplayName</key><string>tranRU 透明字幕</string><key>CFBundlePackageType</key><string>APPL</string><key>CFBundleShortVersionString</key><string>1.0.0</string><key>CFBundleVersion</key><string>1</string><key>LSMinimumSystemVersion</key><string>14.0</string><key>NSHighResolutionCapable</key><true/></dict></plist>
PLIST
codesign --force --sign - --identifier com.ruruguy.tranru.overlay "$app_dir"
"$app_dir/Contents/MacOS/tranRUOverlay" --self-test
cp "$root_dir/desktop/mac/README.md" "$output_dir/使用說明.md"
python3 "$root_dir/desktop/mac/package.py" "$app_dir" "$output_dir/tranRU-Mac-Overlay.zip"
(cd "$output_dir" && shasum -a 256 tranRU-Mac-Overlay.zip > tranRU-Mac-Overlay.zip.sha256)
printf 'Mac overlay ready: %s\n' "$output_dir/tranRU-Mac-Overlay.zip"
