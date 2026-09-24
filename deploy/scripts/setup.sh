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

sudo ufw allow OpenSSH
sudo ufw allow 80/tcp
sudo ufw allow 443/tcp
sudo ufw allow 59000/udp
sudo ufw allow from 172.20.0.0/16 to 172.17.0.1 proto tcp
sudo ufw --force enable

install -m 0700 -d "$state_dir" "$state_dir/acme"
if [[ ! -f "$state_dir/acme/acme.json" ]]; then
	install -m 0600 /dev/null "$state_dir/acme/acme.json"
fi

exec "$repository_dir/deploy/scripts/maintain.sh"
