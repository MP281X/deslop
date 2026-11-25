# Maintenance

A pass runs Update, then Reconcile, then Check on `worker`, and the Mac's steps when it is on, then reports faults, what it can't place, denied steps and an update waiting on the user's restart. Remove with `rm -r` or `sudo rm -r`, never `-f`: Codex rejects any forced `rm` without asking. A refusal or failure skips only its step.

- **The user's.** `t3 update`, `t3 doctor --fix`, `t3 service restart` and reboots; never report a pending T3 update.
- **Never touch** history (T3's databases and logs, `~/.claude/projects`, `~/.codex/sessions`), credentials, production data, running jobs or worktrees of running threads.

## State

`worker` holds only this. What a running thread started (its worktree, preview, containers, listeners, files in `/tmp`) is its own until it settles; `/tmp` empties itself after 7 days.

- **Packages.** `apt-mark showmanual` lists Debian's required, important and standard packages; `linux-image-amd64`, `grub-efi-amd64`, `shim-signed`, `mdadm`, `lvm2`, `firmware-amd-graphics`, `firmware-realtek` for boot and disks; `openssh-server`, `sudo`, `ufw`, `unattended-upgrades`, `libatomic1`, `curl`, `git`, `ripgrep`, `jq`, `sqlite3`, `btop`, `unzip`; agents' `fd-find`, `python-is-python3`, `python3-yaml`, `imagemagick`, `poppler-utils`, `libarchive-tools`, `xxd`, `yq`; `docker-ce`, `docker-ce-cli`, `containerd.io`, `docker-buildx-plugin`, `docker-compose-plugin`, `gh`, `glab`, `tailscale`, `openvpn3-client`, `gnome-keyring`, `libsecret-tools`; Minecraft's `temurin-25-jre`. Apt sources: Debian's, Docker, GitHub CLI, Tailscale, OpenVPN 3, Adoptium.
- **System units.** The ones these packages enable and Ikoula's `pxe-bootfirst.service`; `tmp.mount` masked. `/etc/systemd/system` holds no other unit, mask or alias, `system.control` only the three `MemoryLow` drop-ins.
- **User units** in `~/.config/systemd/user`: Deploy's `deslop-*` units and `deslop.slice`, `t3code.service` with its `limits.conf` drop-in, `secret-service.service`, `minecraft.service` and `minecraft-console.socket`. Enabled besides these: only what installed packages enable (keyring, gcr, gpg, `ssh-agent`).
- **sysctl.** `/etc/sysctl.d` holds `90-agents.conf`, `90-unprivileged-ports.conf` and Debian's `README.sysctl`.
- **`/etc`** beyond what packages own and Debian generates (accounts, host keys, locale, fstab, network, apt keys and sources): only the files Setup writes. No backups (`*.old`, dated `ufw` rules, sed's `*e` copies) or leftovers of purged packages.
- **Ports** (`sudo ss -ltnup`): `sshd` on 22; Deploy's Caddy on TCP 80 and 443, UDP 443 and its admin port on `127.0.0.1`; Deploy's apps on `127.0.0.1:51xx`; T3 on `127.0.0.1:3773` and its Connect `cloudflared`; `tailscaled`; Minecraft on 25565.
- **Home.** `deslop`; `dual`, whose `dev/*` branches hold dev's unpushed work; `minecraft`, whose `data/world` is dev's old world, never selected; dev's Dual work in `dual-rethink`, `dual-preview-seed` and `dual-work`; `.deslop` with one folder per app, some apps' `.env` and `threads-backup`, his archive of old machines' Claude, Codex and OpenCode history; `.aws`, `.cache`, `.claude`, `.claude.json`, `.codex`, `.config`, `.docker`, `.local` (its `bin` holds only the `claude` and `fd` links), `.npm`, `.ssh`, `.t3`, `.vite-plus`; `.bashrc`, `.bash_history`, `.bash_logout`, `.profile`; `.gitconfig`, `.gitconfig-github`, `.gitconfig-datapizza`. `/root` holds only Debian's skeleton.
- **Docker.** The `bridge`, `host` and `none` networks; containers, volumes, images and build cache only while their thread's preview, test run or build runs.
- **Dual's public preview**, his one approved exception to [Previews](../SKILL.md#previews), stays running: the detached worktree `~/.t3/worktrees/dual/dual-preview`, its `preview-dual-preview` unit and listeners, its `wt-50116f654203` containers, volumes and network, the `dual-agent-sandbox:preview` and `dual-plugin-worker:preview` images its runs start, its `tailscale serve` port and Deploy's `dual-preview` exposure.

## Update

- **Debian.** `sudo apt-get update`, `upgrade -y`, `autoremove -y`, `clean`; `vp upgrade`; `gh extension upgrade --all`; the [AWS CLI](#aws-cli). glab: when `https://gitlab.com/api/v4/projects/gitlab-org%2Fcli/releases/permalink/latest` names a newer `tag_name`, download `https://gitlab.com/gitlab-org/cli/-/releases/<tag>/downloads/glab_<version>_linux_amd64.deb` and `sudo dpkg -i` it.
- **Mac.** `vp upgrade`; report a pending macOS update from `softwareupdate -l`.
- **T3 CLI.** When `t3 --version` differs from `activeVersion` in `~/.t3/runtime/service-state.json`, `vp install -g t3@<activeVersion>`, never newer: T3 updates only from its UI.
- **Configuration.** `git -C ~/deslop pull --ff-only`. When local changes block it, read `git -C ~/deslop diff -w`: `git -C ~/deslop restore .` only a harness's re-indent or its own settings (Claude's `theme`, Codex's `[tui]`), then pull again; a real change goes into a PR.

## Reconcile

Bring `worker` to [State](#state): remove what it doesn't declare, restore what is missing from [Setup and repair](#setup-and-repair). What it doesn't declare but may be someone's data, such as an unknown backup, stays and is reported.

- **Packages.** `sudo apt-mark auto` undeclared manual packages, then `sudo apt-get autoremove --purge -y`; `sudo apt-get purge -y` the ones `dpkg -l` shows as `rc`.
- **Units.** `systemctl [--user] disable --now` and remove undeclared ones, then `daemon-reload`.

A thread owns a worktree through `worktreePath` in `orchestration_v2_projection_threads.payload_json`, its delegated children through `lineage.rootThreadId`; `settledAt`, `archived_at` or `deleted_at` settles it. Remove a worktree only when its thread is settled and, re-read right before removal, still settled with no process using it: the project's settle script, `git worktree remove --force --force`, `git worktree prune`.

- **Tool caches**, when unused: `ms-playwright`, `node-gyp`, `puppeteer` and `google-chrome-for-testing-headless` in `~/.cache`, and `~/.npm/_npx`.
- **Claude versions.** `~/.local/share/claude/versions/<version>` except the one `claude --version` reports.
- **T3 versions.** Skip while `service-state.json` shows an uncommitted update. Keep `activeVersion`, the launcher named in `~/.config/systemd/user/t3code.service`'s `ExecStart`, and newer versions under `~/.t3/runtime/versions`.
- **Docker**, when no Docker or Compose build runs: `docker image prune -a -f`, only `-f` while Dual's public preview runs, since its sandbox images have no container between runs; `docker builder prune -a -f`; never `docker system prune`.
- **pnpm**, when no install runs: `pnpm store prune`.
- **Previews** of gone worktrees: Alchemy's `preview:destroy`; stopped `preview-*` units; `docker rm -f -v` their containers, including Dual's `dualos-local-*-wt-<hash>` Postgres and OpenSandbox ones, whose seed data no other worktree uses. Also leftover `testcontainers-ryuk-*` and finished test runs' unnamed Postgres containers.
- **Local branches** in `~/deslop` and `~/dual`: `git branch -D` only branches no worktree checks out, never the default branch or `~/dual`'s `dev/*`.
- **Remote branches**, only through this block: it deletes a branch whose merged or closed PR's head is the branch tip, whose nonempty commit list is all the user's, and which no worktree checks out; a failed query keeps it.

```bash
git fetch -q --prune origin
for b in $(git for-each-ref --format='%(refname:lstrip=3)' refs/remotes/origin | grep -vx 'HEAD\|main\|master'); do
  if git remote get-url origin | grep -q github.com; then
    pr=$(gh pr list --head "$b" --state all --json state,commits,headRefOid -q '.[0]') || continue
    s=$(jq -r '.state // empty' <<<"$pr"); h=$(jq -r '.headRefOid // empty' <<<"$pr"); a=$(jq -r '[.commits[].authors[].email] | unique | join(" ")' <<<"$pr")
  else
    mr=$(glab mr list --source-branch "$b" --all -F json | jq '.[0]') || continue
    s=$(jq -r '.state // empty' <<<"$mr"); h=$(jq -r '.sha // empty' <<<"$mr"); a=$(glab api "projects/:id/merge_requests/$(jq -r .iid <<<"$mr")/commits" | jq -r '[.[].author_email] | unique | join(" ")')
  fi
  case "$s" in MERGED|CLOSED|merged|closed) ;; *) continue ;; esac
  [ "$h" = "$(git rev-parse "origin/$b")" ] && [ -n "$a" ] && [ "$a" = "$(git config user.email)" ] || continue
  git worktree list --porcelain | grep -qxF "branch refs/heads/$b" || git push -q origin --delete "$b"
done
```

- **Mac caches**, and Vite+ and Node versions other than the active ones under `~/.vite-plus`:

```bash
find ~/Library/Caches -maxdepth 1 -type d \( -iname '*updater*' -o -name '*.ShipIt' -o -name 'com.apple.Safari*' -o -name 'com.t3tools.t3code*' \) -exec rm -r -- {} +
find "$HOME/Library/Application Support" -maxdepth 2 -path '*/t3code*/*' \( -name Cache -o -name 'Code Cache' \) -exec rm -r -- {} +
find ~/.vite-plus -maxdepth 1 -name '[0-9]*' ! -name "$(readlink ~/.vite-plus/current)" -exec rm -r -- {} +
find ~/.vite-plus/js_runtime/node -mindepth 1 -maxdepth 1 ! -name "$(node --version | cut -c2-)*" ! -name index_cache.json -exec rm -r -- {} +
rm -r ~/Library/Caches/Google/Chrome ~/.npm ~/.vite-plus/package_manager
```

## Check

- **Disk.** `df -h` and `df -i` per mount; `du -xhd1` under the home, `/var/lib` and `/tmp`; `sudo lsof -l +L1 -nP` for deleted-but-open files.
- **Ports.** A container published on `0.0.0.0` is a fault.
- **Units.** `systemctl --failed` and `systemctl --user --failed` are empty.
- **Docker.** `docker info` runs without `sudo`; otherwise T3 started before `mp281x` joined `docker`, and the reboot is the user's.
- **Agents.** `find ~/.claude/settings.json ~/.claude/agents/pair.md ~/.claude/skills ~/.codex/config.toml ~/.codex/instructions.md ~/.codex/rules/deny.rules ~/.codex/skills/{*,.system} -maxdepth 0 ! -type l` prints only `~/.codex/skills/.system`; `find -L ~/.claude/skills ~/.codex/skills -maxdepth 1 -type l` prints nothing; `~/deslop` is clean on current `main`.
- **T3.** `t3 --version` equals `activeVersion`; `t3 doctor --base-dir ~/.t3 --dry-run` prints "Nothing to repair"; `t3 connect status` ends "✓ Other devices can reach this machine".
- **sshd.** `sudo sshd -T` shows `usepam yes`, `passwordauthentication no`, `permitrootlogin no`.
- **VPN.** `git -C ~/dual ls-remote -q origin HEAD` succeeds; otherwise Dual's [VPN](dual.md#vpn).

## Setup and repair

### Debian machine

From a Debian netinst, in order:

1. **Base.** The `mp281x` user, with the other machines' SSH key and a locked password; passwordless sudo in `/etc/sudoers.d/99-mp281x-nopasswd` (0440); `sudo`, `ufw`, `libatomic1` (Node needs it); purge what the host's image adds but nothing uses (on Ikoula: `nfs-common`, `rpcbind`, `vim`, `wget`, its `AutoconfDownloader` unit and `/root/IkoulaRelease`), keeping `pxe-bootfirst.service`, which Ikoula's panel needs to reinstall or rescue the machine; `printf 'D /tmp 1777 root root 7d\n' | sudo tee /etc/tmpfiles.d/tmp.conf && sudo systemctl mask tmp.mount`.
2. **Packages.** Git, Docker, `gh`, `glab`, ripgrep, jq, sqlite3, btop, unzip, the [AWS CLI](#aws-cli); `unattended-upgrades`, with `printf 'APT::Periodic::Update-Package-Lists "1";\nAPT::Periodic::Unattended-Upgrade "1";\n' | sudo tee /etc/apt/apt.conf.d/20auto-upgrades`, without which it installs nothing; the tools agents reach for, `fd-find` (and `mkdir -p ~/.local/bin && ln -sfn /usr/bin/fdfind ~/.local/bin/fd`), `python-is-python3`, `python3-yaml`, `imagemagick`, `poppler-utils`, `libarchive-tools`, `xxd`, `yq`; `mp281x` in `docker`, then `sudo systemctl restart user@1000.service`, so the user's services get the group; `/etc/docker/daemon.json`: `{"live-restore": true, "ip": "127.0.0.1", "default-network-opts": {"bridge": {"com.docker.network.bridge.host_binding_ipv4": "127.0.0.1"}}}`.
3. **Git.** `rebase.updateRefs`, `rebase.autoSquash`, `rebase.autoStash`, `push.autoSetupRemote`, `fetch.prune`, `rerere.enabled` true; `diff.algorithm histogram`, `merge.conflictStyle zdiff3`, `init.defaultBranch main`. Identity by remote, through `includeIf.hasconfig:remote.*.url:` on the https, `git@` and `ssh://` URLs of each host: `MP281X <dev@mp281x.xyz>` for `github.com`, `Matteo Paludgnach <matteopaludgnach@datapizza.tech>` for `git.datapizza.tech`.
4. **Network.** `openvpn3-client` from OpenVPN 3's `trixie` apt repository (`https://packages.openvpn.net/openvpn3/debian`, key `https://packages.openvpn.net/packages-repo.gpg`), then `openvpn3 config-import --config <datapizza.ovpn> --name datapizza --persistent`. Tailscale from its Debian `trixie` apt repository; `sudo tailscale up --accept-routes --advertise-routes=<git.datapizza.tech's IPv4>/32,<worker's public IPv4>/32`, both approved in the admin console: GitLab for every device, and the apps over the tailnet, where Auth knows the device; `sudo tailscale set --operator=mp281x`. Then, over the tailnet, `ufw default deny incoming`, allowing everything `in on tailscale0` and publicly only TCP 80, 443 and 25565 and UDP 443, for production and Minecraft, and `ufw enable`. `printf 'net.ipv4.ip_unprivileged_port_start = 80\n' | sudo tee /etc/sysctl.d/90-unprivileged-ports.conf && sudo sysctl --system`, so Deploy's Caddy binds 80 and 443 as the user.
5. **Shell.** `loginctl enable-linger mp281x`; `/etc/sysctl.d/90-agents.conf` with `fs.inotify.max_user_instances = 8192`, `fs.inotify.max_user_watches = 1048576` (parallel dev servers and watchers ran out) and `vm.swappiness = 10` (swap only as a last resort), then `sudo sysctl --system`; `LimitNOFILE=524288` in a `t3code.service` drop-in, since agents inherit its 1,024 open files; an empty `/etc/motd` and non-executable `/etc/update-motd.d/*`; for the apps' `deslop.slice` to keep its first gigabyte, every slice above it carries the same protection: `sudo systemctl set-property <unit> MemoryLow=1G` for `user.slice`, `user-1000.slice` and `user@1000.service`; Vite+ with `VP_HOME="$HOME/.vite-plus"`, Claude Code; `~/.bashrc`'s first lines put `$HOME/.local/bin:$HOME/.vite-plus/bin` on `PATH`; `~/.config/pnpm/config.yaml`: `minimumReleaseAgeExclude: ["@deslop/*"]`.
6. **T3.** `vp install -g t3@nightly`, `t3 service install`, `t3 connect link --headless`, `t3 connect publish`, `t3 browser setup`, `sudo hostnamectl set-hostname worker`, the name previews and the tailnet take.
7. **Accounts.** Give the user each sign-in link: `gh auth login`, `glab auth login --hostname git.datapizza.tech`, `claude auth login`, `codex login --device-auth`, [AWS](dual.md#aws). Then `gh auth setup-git`, `gh extension install github/gh-stack`; clone both repositories; `t3 project add --title <name> <path>`; [agent links](#agent-configuration-links); [keyring and MCP](#keyring-and-mcp); an `ssh-keygen -t ed25519` key of its own in the Mac's `authorized_keys`, for the device tools.
8. **Keys only**, once a key login from another machine succeeds: `/etc/ssh/sshd_config.d/10-keys-only.conf` with `UsePAM yes`, `PasswordAuthentication no`, `KbdInteractiveAuthentication no`, `PermitRootLogin no`, `X11Forwarding no`; `sudo sshd -t`, then `sudo systemctl reload ssh`.

### Agent configuration links

Also after a harness replaced a link with a file. `~/.codex/skills` stays a real folder for Codex's `.system`.

```bash
r=~/deslop
mkdir -p ~/.claude/agents ~/.codex/rules ~/.codex/skills
ln -sfn $r/.claude/settings.json ~/.claude/settings.json
ln -sfn $r/.claude/agents/pair.md ~/.claude/agents/pair.md
[ -L ~/.claude/skills ] || mv ~/.claude/skills ~/.claude/skills.old 2>/dev/null
ln -sfn $r/.claude/skills ~/.claude/skills
find ~/.codex/skills -maxdepth 1 -type l -delete
ln -sfn ~/.claude/skills/* ~/.codex/skills/
ln -sfn $r/.codex/global-config.toml ~/.codex/config.toml
ln -sfn $r/.codex/instructions.md ~/.codex/instructions.md
ln -sfn $r/.codex/rules/deny.rules ~/.codex/rules/deny.rules
codex execpolicy check --rules ~/.codex/rules/deny.rules true
```

### T3 settings

Keep each project's `scripts` (`t3_project_update`) equal to `projectSettingsOverrides.<id>.defaultProjectScripts`; never edit `projectScriptOverrides`.

### Mac

Only T3, Xcode and Vite+, whose Node T3's device tools need; no agents or apps. `curl -fsSL https://vite.plus | bash`; `~/.zshenv` exports `PATH="$HOME/.local/bin:$HOME/.vite-plus/bin:$PATH"` and `DEVELOPER_DIR=/Applications/Xcode.app/Contents/Developer`. Xcode: `open "macappstore://apps.apple.com/app/id497799835"`.

### Keyring and MCP

Gateway needs no login: Auth names this machine's tailnet owner.

```bash
sudo apt-get install -y gnome-keyring libsecret-tools
mkdir -p ~/.config/systemd/user ~/.local/share/dbus-1/services
printf '%s\n' '[Unit]' 'Description=Secret Service for headless CLI sign-ins' '[Service]' \
  "ExecStart=/bin/sh -c 'printf headless | exec /usr/bin/gnome-keyring-daemon --foreground --replace --unlock --components=secrets'" \
  'Restart=on-failure' '[Install]' 'WantedBy=default.target' > ~/.config/systemd/user/secret-service.service
# The packaged activation file, pointed at the unlocked unit
for f in /usr/share/dbus-1/services/*.secrets.service; do
  sed 's|^Exec=.*|Exec=/bin/false\nSystemdService=secret-service.service|' "$f" > ~/.local/share/dbus-1/services/"${f##*/}"
done
systemctl --user reload dbus.service && systemctl --user daemon-reload && systemctl --user enable --now secret-service.service
claude mcp add --transport http --scope user gateway https://gateway.mp281x.xyz/mcp
```

### AWS CLI

AWS CLI v2's Linux x86_64 installer, with `--update` to update. Its sign-in is Dual's [AWS](dual.md#aws) session. `~/.aws/config`:

```ini
[sso-session datapizza]
sso_start_url = https://datapizza.awsapps.com/start
sso_region = eu-west-1
sso_registration_scopes = sso:account:access

[default]
sso_session = datapizza
sso_account_id = 736979665822
sso_role_name = DualosOperator
region = eu-south-1
```
