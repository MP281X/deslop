#!/usr/bin/env bash
set -euo pipefail

script_dir=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)
state_dir=/home/mp281x/.deslop/deploy

sudo apt-get update
sudo apt-get upgrade -y
curl -fsSL https://vite.plus | bash

old_portfolio=$(docker image inspect ghcr.io/mp281x/deslop-portfolio:latest --format '{{.Id}}' 2>/dev/null || true)
old_valentine=$(docker image inspect ghcr.io/mp281x/saint-valentine:latest --format '{{.Id}}' 2>/dev/null || true)
if [[ "$script_dir" != "$state_dir" ]]; then
	repository_dir=$(cd -- "$script_dir/../.." && pwd)
	(
		cd "$repository_dir"
		/home/mp281x/.vite-plus/bin/vp install
		VITE_OTEL_URL=https://otel.mp281x.xyz /home/mp281x/.vite-plus/bin/vp run build
		docker build --tag ghcr.io/mp281x/deslop-portfolio:latest apps/portfolio
	)
	install -m 0644 "$script_dir/../compose.yaml" "$state_dir/compose.yaml.next"
	mv "$state_dir/compose.yaml.next" "$state_dir/compose.yaml"
	install -m 0755 "$script_dir/maintain.sh" "$state_dir/maintain.sh.next"
	mv "$state_dir/maintain.sh.next" "$state_dir/maintain.sh"
fi

compose=(docker compose --project-name deslop --file "$state_dir/compose.yaml")
"${compose[@]}" config --quiet
"${compose[@]}" pull traefik jaeger collector
"${compose[@]}" up -d --remove-orphans
curl -fsS --retry 12 --retry-delay 5 --retry-all-errors https://portfolio.mp281x.xyz/ >/dev/null
curl -fsS --retry 12 --retry-delay 5 --retry-all-errors https://te-amo-muchisimo.mp281x.xyz/ >/dev/null
curl -fsS --retry 12 --retry-delay 5 --retry-all-errors https://otel.mp281x.xyz/api/services >/dev/null
curl -fsS --retry 12 --retry-delay 5 --retry-all-errors -X OPTIONS https://otel.mp281x.xyz/v1/traces -H 'Origin: https://portfolio.mp281x.xyz' -H 'Access-Control-Request-Method: POST' >/dev/null
curl -fsS --retry 12 --retry-delay 5 --retry-all-errors -X OPTIONS https://otel.mp281x.xyz/v1/logs -H 'Origin: https://portfolio.mp281x.xyz' -H 'Access-Control-Request-Method: POST' >/dev/null

current_portfolio=$(docker image inspect ghcr.io/mp281x/deslop-portfolio:latest --format '{{.Id}}')
current_valentine=$(docker image inspect ghcr.io/mp281x/saint-valentine:latest --format '{{.Id}}')
for image in "$old_portfolio" "$old_valentine"; do
	if [[ -n "$image" && "$image" != "$current_portfolio" && "$image" != "$current_valentine" ]]; then
		docker image rm "$image" >/dev/null 2>&1 || true
	fi
done

"${compose[@]}" ps
