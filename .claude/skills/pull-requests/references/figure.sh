#!/usr/bin/env bash
# Renders a PR figure: an HTML fragment styled by figure.css, as light and dark PNGs at twice its CSS width with a transparent background.
# Usage: figure.sh <figure.html> [width, default 880] → <figure>-light.png and <figure>-dark.png beside it.
set -euo pipefail

fragment=$(realpath "$1")
width=${2:-880}
out=${fragment%.html}
chrome=$(find ~/.t3/tools/chrome-headless-shell/linux64 -name chrome-headless-shell -type f | sort -V | tail -1)
page=$(mktemp --suffix=.html)
trap 'rm -f "$page"' EXIT

for scheme in light dark; do
	{
		printf '<!doctype html><html data-scheme="%s"><head><meta charset="utf-8"><style>' "$scheme"
		cat "$(dirname "$(realpath "$0")")/figure.css"
		printf '</style></head><body>'
		cat "$fragment"
		printf '</body></html>'
	} >"$page"
	"$chrome" --headless --disable-gpu --hide-scrollbars --force-device-scale-factor=2 \
		--default-background-color=00000000 --window-size="$width,3000" \
		--screenshot="$out-$scheme.png" "file://$page" 2>/dev/null
	# Keeps the full width so the figure lines up with the text; cuts only the empty space below it.
	magick "$out-$scheme.png" -define trim:edges=south -trim +repage "$out-$scheme.png"
done
printf '%s\n' "$out-light.png" "$out-dark.png"
