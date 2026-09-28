# Host setup

Bootstraps a fresh Debian 13 host as `mp281x`; every step is idempotent.

1. `/etc/sudoers.d/99-mp281x-nopasswd` (mode 0440): `mp281x ALL=(ALL:ALL) NOPASSWD: ALL`. Timezone `Europe/Berlin`.
2. For each source, dearmor the key into `/etc/apt/keyrings/<name>.gpg` and write `/etc/apt/sources.list.d/<name>.list` as `deb [arch=amd64 signed-by=/etc/apt/keyrings/<name>.gpg] <repository>`:

   | name       | key                                                           | repository                                               |
   | ---------- | ------------------------------------------------------------- | -------------------------------------------------------- |
   | docker     | https://download.docker.com/linux/debian/gpg                  | https://download.docker.com/linux/debian trixie stable   |
   | github-cli | https://cli.github.com/packages/githubcli-archive-keyring.gpg | https://cli.github.com/packages stable main              |
   | openvpn3   | https://packages.openvpn.net/packages-repo.gpg                | https://packages.openvpn.net/openvpn3/debian trixie main |
   | acli       | https://acli.atlassian.com/gpg/public-key.asc                 | https://acli.atlassian.com/linux/deb stable main         |

3. Install `docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin gh glab acli openvpn3-client ripgrep jq sqlite3 bc xxd ffmpeg python3-pip python3-venv python-is-python3 ufw systemd-resolved`, and add `mp281x` to the `docker` group.
4. Link `/etc/resolv.conf` to `/run/systemd/resolve/stub-resolv.conf`. Add a 16G `/swapfile` to `/etc/fstab`, with `vm.swappiness=10` and `vm.vfs_cache_pressure=50` in `/etc/sysctl.d/99-swap.conf`. ufw allows OpenSSH, 80/tcp, and 443/tcp, then is enabled.
5. Install Vite+ (`curl -fsSL https://vite.plus | bash`), then `vp install -g @openai/codex agent-browser t3`, `agent-browser install --with-deps`, and Claude Code (`curl -fsSL https://claude.ai/install.sh | bash`). Enable lingering for `mp281x` and run `t3 service install`.
6. Clone MP281X/deslop to `/home/mp281x/deslop`, create `~/.deslop/deploy/acme` (0700) with an empty `acme.json` (0600), follow [maintain.md](maintain.md), and run `node tools/workflow/src/install.ts` from the clone.
7. Run each sign-in and show the user its link: `gh auth login`, `glab auth login --hostname git.datapizza.tech`, `claude`, `codex login`, `openvpn3 config-import --config <datapizza.ovpn> --name datapizza --persistent`, and `t3 connect`.
