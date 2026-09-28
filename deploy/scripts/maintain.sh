#!/usr/bin/env bash
set -euo pipefail

script_dir=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)
state_dir=/home/mp281x/.deslop/deploy

sudo DEBIAN_FRONTEND=noninteractive apt-get update
sudo DEBIAN_FRONTEND=noninteractive apt-get upgrade -y
sudo DEBIAN_FRONTEND=noninteractive apt-get autoremove -y
sudo apt-get clean
/home/mp281x/.vite-plus/bin/vp upgrade
/home/mp281x/.vite-plus/bin/vp update -g @openai/codex agent-browser

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
"${compose[@]}" up -d --remove-orphans --pull never
sudo ufw allow from "$(docker network inspect deslop --format '{{(index .IPAM.Config 0).Subnet}}')" to any port 4000:4009 proto tcp comment 'deslop previews'
curl -fsS --retry 12 --retry-delay 5 --retry-all-errors https://portfolio.mp281x.xyz/ >/dev/null
curl -fsS --retry 12 --retry-delay 5 --retry-all-errors https://te-amo-muchisimo.mp281x.xyz/ >/dev/null
curl -fsS --retry 12 --retry-delay 5 --retry-all-errors https://otel.mp281x.xyz/api/services >/dev/null
curl -fsS --retry 12 --retry-delay 5 --retry-all-errors -X OPTIONS https://otel.mp281x.xyz/v1/traces -H 'Origin: https://portfolio.mp281x.xyz' -H 'Access-Control-Request-Method: POST' >/dev/null
curl -fsS --retry 12 --retry-delay 5 --retry-all-errors -X OPTIONS https://otel.mp281x.xyz/v1/logs -H 'Origin: https://portfolio.mp281x.xyz' -H 'Access-Control-Request-Method: POST' >/dev/null

# Stacks and previews of removed worktrees
docker ps -a --format '{{.Label "com.docker.compose.project"}}\t{{.Label "com.docker.compose.project.working_dir"}}' | sort -u |
	while IFS=$'\t' read -r project directory; do
		if [[ -n "$project" && -n "$directory" && ! -d "$directory" ]]; then
			docker compose --project-name "$project" down --volumes --remove-orphans
		fi
	done
for directory in /home/mp281x/.deslop/t3code-*; do
	if ! compgen -G "/home/mp281x/.t3/worktrees/*/$(basename "$directory")" >/dev/null; then
		rm -rf -- "$directory"
	fi
done
for pid in $(ss -ltnpH 'sport >= :4000 and sport <= :4009' | grep -o 'pid=[0-9]*' | cut -d= -f2 | sort -u); do
	if [[ "$(readlink "/proc/$pid/cwd")" == *' (deleted)' ]]; then
		kill -- "-$(ps -o pgid= -p "$pid" | tr -d ' ')"
	fi
done

docker image prune -a -f
docker builder prune -a -f --filter until=168h
docker volume prune -f

"${compose[@]}" ps
