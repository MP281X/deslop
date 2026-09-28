#!/usr/bin/env bash
set -euo pipefail

script_dir=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)
repository_dir=$(cd -- "$script_dir/../.." && pwd)
state_dir=/home/mp281x/.deslop/deploy
vp=/home/mp281x/.vite-plus/bin/vp

echo 'mp281x ALL=(ALL:ALL) NOPASSWD: ALL' | sudo tee /etc/sudoers.d/99-mp281x-nopasswd >/dev/null
sudo chmod 0440 /etc/sudoers.d/99-mp281x-nopasswd
sudo timedatectl set-timezone Europe/Berlin

sudo apt-get update
sudo apt-get install -y ca-certificates curl gnupg
sudo install -m 0755 -d /etc/apt/keyrings
curl -fsSL https://download.docker.com/linux/debian/gpg | sudo tee /etc/apt/keyrings/docker.asc >/dev/null
curl -fsSL https://cli.github.com/packages/githubcli-archive-keyring.gpg | sudo tee /etc/apt/keyrings/githubcli-archive-keyring.gpg >/dev/null
curl -fsSL https://packages.openvpn.net/packages-repo.gpg | sudo tee /etc/apt/keyrings/openvpn.asc >/dev/null
curl -fsSL https://acli.atlassian.com/gpg/public-key.asc | sudo gpg --dearmor --yes -o /etc/apt/keyrings/acli-archive-keyring.gpg
echo 'deb [arch=amd64 signed-by=/etc/apt/keyrings/docker.asc] https://download.docker.com/linux/debian trixie stable' | sudo tee /etc/apt/sources.list.d/docker.list >/dev/null
echo 'deb [arch=amd64 signed-by=/etc/apt/keyrings/githubcli-archive-keyring.gpg] https://cli.github.com/packages stable main' | sudo tee /etc/apt/sources.list.d/github-cli.list >/dev/null
echo 'deb [arch=amd64 signed-by=/etc/apt/keyrings/openvpn.asc] https://packages.openvpn.net/openvpn3/debian trixie main' | sudo tee /etc/apt/sources.list.d/openvpn3.list >/dev/null
echo 'deb [arch=amd64 signed-by=/etc/apt/keyrings/acli-archive-keyring.gpg] https://acli.atlassian.com/linux/deb stable main' | sudo tee /etc/apt/sources.list.d/acli.list >/dev/null
sudo apt-get update
sudo apt-get install -y \
	docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin \
	gh glab acli openvpn3-client \
	ripgrep jq sqlite3 bc xxd ffmpeg python3-pip python3-venv python-is-python3 \
	ufw systemd-resolved
sudo usermod -aG docker mp281x
sudo ln -sf /run/systemd/resolve/stub-resolv.conf /etc/resolv.conf

if ! swapon --show=NAME --noheadings | grep -qx /swapfile; then
	sudo fallocate -l 16G /swapfile
	sudo chmod 0600 /swapfile
	sudo mkswap /swapfile
	sudo swapon /swapfile
	echo '/swapfile none swap sw 0 0' | sudo tee -a /etc/fstab >/dev/null
fi
printf 'vm.swappiness=10\nvm.vfs_cache_pressure=50\n' | sudo tee /etc/sysctl.d/99-swap.conf >/dev/null
sudo sysctl --system >/dev/null

sudo ufw allow OpenSSH
sudo ufw allow 80/tcp
sudo ufw allow 443/tcp
sudo ufw --force enable

if [[ ! -x "$vp" ]]; then
	curl -fsSL https://vite.plus | bash
fi
"$vp" install -g @openai/codex agent-browser t3
/home/mp281x/.vite-plus/bin/agent-browser install --with-deps
if [[ ! -x /home/mp281x/.local/bin/claude ]]; then
	curl -fsSL https://claude.ai/install.sh | bash
fi
sudo loginctl enable-linger mp281x
if [[ ! -f /home/mp281x/.config/systemd/user/t3code.service ]]; then
	/home/mp281x/.vite-plus/bin/t3 service install
fi

install -m 0700 -d "$state_dir" "$state_dir/acme"
if [[ ! -f "$state_dir/acme/acme.json" ]]; then
	install -m 0600 /dev/null "$state_dir/acme/acme.json"
fi
sg docker -c "$script_dir/maintain.sh"
(cd "$repository_dir" && /home/mp281x/.vite-plus/bin/node tools/workflow/src/install.ts)

cat <<'MANUAL'
Sign in by hand once:
  gh auth login
  glab auth login --hostname git.datapizza.tech
  claude
  codex login
  openvpn3 config-import --config <datapizza.ovpn> --name datapizza --persistent
  t3 connect
MANUAL
