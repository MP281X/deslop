#!/usr/bin/env bash
set -euo pipefail

repository=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/../.." && pwd)
bin=/home/mp281x/.vite-plus/bin
deploy=/home/mp281x/.deslop/deploy

echo 'mp281x ALL=(ALL:ALL) NOPASSWD: ALL' | sudo install -m 0440 /dev/stdin /etc/sudoers.d/99-mp281x-nopasswd
sudo timedatectl set-timezone Europe/Berlin

sudo apt-get update
sudo apt-get install -y curl gnupg
sudo install -m 0755 -d /etc/apt/keyrings
while read -r name key source; do
	curl -fsSL "$key" | sudo gpg --batch --yes --dearmor -o "/etc/apt/keyrings/$name.gpg"
	echo "deb [arch=amd64 signed-by=/etc/apt/keyrings/$name.gpg] $source" | sudo tee "/etc/apt/sources.list.d/$name.list" >/dev/null
done <<'SOURCES'
docker https://download.docker.com/linux/debian/gpg https://download.docker.com/linux/debian trixie stable
github-cli https://cli.github.com/packages/githubcli-archive-keyring.gpg https://cli.github.com/packages stable main
openvpn3 https://packages.openvpn.net/packages-repo.gpg https://packages.openvpn.net/openvpn3/debian trixie main
acli https://acli.atlassian.com/gpg/public-key.asc https://acli.atlassian.com/linux/deb stable main
SOURCES
sudo apt-get update
sudo apt-get install -y \
	docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin \
	gh glab acli openvpn3-client \
	ripgrep jq sqlite3 bc xxd ffmpeg python3-pip python3-venv python-is-python3 \
	ufw systemd-resolved

sudo usermod -aG docker mp281x
sudo ln -sf /run/systemd/resolve/stub-resolv.conf /etc/resolv.conf
if [[ ! -f /swapfile ]]; then
	sudo fallocate -l 16G /swapfile
	sudo chmod 0600 /swapfile
	sudo mkswap /swapfile
	sudo swapon /swapfile
	echo '/swapfile none swap sw 0 0' | sudo tee -a /etc/fstab >/dev/null
fi
printf 'vm.swappiness=10\nvm.vfs_cache_pressure=50\n' | sudo tee /etc/sysctl.d/99-swap.conf >/dev/null
sudo sysctl --system >/dev/null
for rule in OpenSSH 80/tcp 443/tcp; do
	sudo ufw allow "$rule"
done
sudo ufw --force enable

[[ -x "$bin/vp" ]] || curl -fsSL https://vite.plus | bash
"$bin/vp" install -g @openai/codex agent-browser t3
"$bin/agent-browser" install --with-deps
[[ -x /home/mp281x/.local/bin/claude ]] || curl -fsSL https://claude.ai/install.sh | bash
sudo loginctl enable-linger mp281x
[[ -f /home/mp281x/.config/systemd/user/t3code.service ]] || "$bin/t3" service install

install -m 0700 -d "$deploy" "$deploy/acme"
[[ -f "$deploy/acme/acme.json" ]] || install -m 0600 /dev/null "$deploy/acme/acme.json"
sg docker -c "$repository/tools/deploy/maintain.sh"
(cd "$repository" && "$bin/node" tools/workflow/src/install.ts)
