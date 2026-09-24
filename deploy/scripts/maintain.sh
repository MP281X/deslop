#!/usr/bin/env bash
set -euo pipefail

script_dir=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)
state_dir=/home/mp281x/.deslop/deploy

sudo DEBIAN_FRONTEND=noninteractive apt-get update
sudo DEBIAN_FRONTEND=noninteractive apt-get upgrade -y
sudo apt-get clean
/home/mp281x/.vite-plus/bin/vp upgrade

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
"${compose[@]}" pull traefik browser jaeger collector
"${compose[@]}" up -d --remove-orphans --pull never
curl -fsS --retry 12 --retry-delay 5 --retry-all-errors https://portfolio.mp281x.xyz/ >/dev/null
printf 'user = "browser:%s"\n' "$(< "$state_dir/browser-password")" | curl -fsS --retry 12 --retry-delay 5 --retry-all-errors --config - https://browser.mp281x.xyz/ >/dev/null
curl -fsS --retry 12 --retry-delay 5 --retry-all-errors https://te-amo-muchisimo.mp281x.xyz/ >/dev/null
curl -fsS --retry 12 --retry-delay 5 --retry-all-errors https://otel.mp281x.xyz/api/services >/dev/null
curl -fsS --retry 12 --retry-delay 5 --retry-all-errors -X OPTIONS https://otel.mp281x.xyz/v1/traces -H 'Origin: https://portfolio.mp281x.xyz' -H 'Access-Control-Request-Method: POST' >/dev/null
curl -fsS --retry 12 --retry-delay 5 --retry-all-errors -X OPTIONS https://otel.mp281x.xyz/v1/logs -H 'Origin: https://portfolio.mp281x.xyz' -H 'Access-Control-Request-Method: POST' >/dev/null

docker image prune -a -f
docker volume prune -f

"${compose[@]}" ps
