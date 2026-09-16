#!/usr/bin/env bash
set -euo pipefail

repository_dir=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/../.." && pwd)
state_dir=/home/mp281x/.deslop/deploy

sudo apt-get update
sudo apt-get install -y ca-certificates curl gnupg ripgrep ufw
if ! command -v docker >/dev/null; then
	sudo install -m 0755 -d /etc/apt/keyrings
	curl -fsSL https://download.docker.com/linux/debian/gpg | sudo gpg --dearmor --yes -o /etc/apt/keyrings/docker.gpg
	sudo chmod a+r /etc/apt/keyrings/docker.gpg
	printf 'Types: deb\nURIs: https://download.docker.com/linux/debian\nSuites: trixie\nComponents: stable\nSigned-By: /etc/apt/keyrings/docker.gpg\n' | sudo tee /etc/apt/sources.list.d/docker.sources >/dev/null
	sudo apt-get update
	sudo apt-get install -y docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin
	sudo usermod -aG docker mp281x
	printf 'Docker installed. Log out and back in, then rerun setup.sh.\n'
	exit 0
fi
if [[ ! -x /home/mp281x/.vite-plus/bin/vp ]]; then
	curl -fsSL https://vite.plus | bash
fi

for stale_port in 5000 5010 49374; do
	if sudo ufw status | rg -q "^$stale_port/tcp"; then
		sudo ufw --force delete allow "$stale_port/tcp"
	fi
done
sudo ufw allow OpenSSH
sudo ufw allow 80/tcp
sudo ufw allow 443/tcp
sudo ufw --force enable

install -m 0700 -d "$state_dir" "$state_dir/acme" "$state_dir/backup"
install -m 0644 "$repository_dir/deploy/compose.yaml" "$state_dir/compose.yaml"
install -m 0755 "$repository_dir/deploy/scripts/maintain.sh" "$state_dir/maintain.sh"
if [[ ! -f "$state_dir/acme/acme.json" ]]; then
	sudo install -m 0600 -o mp281x -g mp281x /etc/dokploy/traefik/dynamic/acme.json "$state_dir/acme/acme.json"
fi

stamp=$(date -u +%Y%m%dT%H%M%SZ)
sudo tar -czf "$state_dir/backup/dokploy-etc-$stamp.tar.gz" -C /etc dokploy
sudo chown mp281x:mp281x "$state_dir/backup/dokploy-etc-$stamp.tar.gz"
for volume in dokploy dokploy-postgres dokploy-redis; do
	docker run --rm --volume "$volume:/source:ro" --volume "$state_dir/backup:/backup" alpine:latest tar -czf "/backup/$volume-$stamp.tar.gz" -C /source .
	sudo chown mp281x:mp281x "$state_dir/backup/$volume-$stamp.tar.gz"
done
portfolio_image=$(docker service inspect aitoolkit-portfolio-triuky --format '{{.Spec.TaskTemplate.ContainerSpec.Image}}')
docker image inspect "$portfolio_image" --format '{{.Id}}' >"$state_dir/backup/portfolio-image-$stamp"
for service in deslop-beercounter-qrh1p7 mp281x-saintvalentine-sqa5wx aitoolkit-otel-n4gruq dokploy dokploy-postgres dokploy-redis; do
	image=$(docker service inspect "$service" --format '{{.Spec.TaskTemplate.ContainerSpec.Image}}')
	docker image inspect "$image" --format '{{.Id}}'
done | sort -u >"$state_dir/retired-images"

(
	cd "$repository_dir"
	/home/mp281x/.vite-plus/bin/vp install
	VITE_OTEL_URL=https://otel.mp281x.xyz /home/mp281x/.vite-plus/bin/vp run build
	docker build --tag ghcr.io/mp281x/deslop-portfolio:latest apps/portfolio
)
compose=(docker compose --project-name deslop --file "$state_dir/compose.yaml")
"${compose[@]}" pull traefik jaeger collector
docker stop dokploy-traefik >/dev/null
trap '"${compose[@]}" down >/dev/null 2>&1 || true; docker start dokploy-traefik >/dev/null 2>&1 || true' ERR
"${compose[@]}" up -d
curl -fsS --retry 12 --retry-delay 5 --retry-all-errors https://portfolio.mp281x.xyz/ >/dev/null
curl -fsS --retry 12 --retry-delay 5 --retry-all-errors https://te-amo-muchisimo.mp281x.xyz/ >/dev/null
curl -fsS --retry 12 --retry-delay 5 --retry-all-errors https://otel.mp281x.xyz/api/services >/dev/null
curl -fsS --retry 12 --retry-delay 5 --retry-all-errors -X OPTIONS https://otel.mp281x.xyz/v1/traces -H 'Origin: https://portfolio.mp281x.xyz' -H 'Access-Control-Request-Method: POST' >/dev/null
curl -fsS --retry 12 --retry-delay 5 --retry-all-errors -X OPTIONS https://otel.mp281x.xyz/v1/logs -H 'Origin: https://portfolio.mp281x.xyz' -H 'Access-Control-Request-Method: POST' >/dev/null
trap - ERR

for service in aitoolkit-portfolio-triuky deslop-beercounter-qrh1p7 mp281x-saintvalentine-sqa5wx aitoolkit-otel-n4gruq dokploy dokploy-postgres dokploy-redis; do
	docker service rm "$service" >/dev/null
done
docker rm -f dokploy-traefik t3code-37a9d4cb-opensandbox-1 t3code-37a9d4cb-postgres-test-1 t3code-37a9d4cb-postgres-1 >/dev/null
docker swarm leave --force >/dev/null
for network in dual-opensandbox-runtime t3code-37a9d4cb_default; do
	docker network rm "$network" >/dev/null
done
for volume in dokploy dokploy-postgres dokploy-redis t3code-37a9d4cb_opensandbox-data t3code-37a9d4cb_dual-postgres; do
	docker volume rm "$volume" >/dev/null
done
sudo rm -rf -- /etc/dokploy
while read -r image; do
	docker image rm "$image" >/dev/null 2>&1 || true
done <"$state_dir/retired-images"
rm "$state_dir/retired-images"

"${compose[@]}" ps
