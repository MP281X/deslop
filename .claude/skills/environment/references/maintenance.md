# Maintenance

Two jobs on `dev`, `desktop` and the Mac:

- **Set up** a machine from scratch: [Set up](#set-up).
- **Return** an existing one to a clean state: [Clean state](#clean-state), which is Update, Clean and Check.

"Maintenance" is the second, on each machine that is on, without asking. Every setup and repair command here stays; keep it when trimming words. Reach the others with `ssh mp281x@desktop` and `ssh matteopaludgnach@macbook-pro`.

## Machines

`dev` and `desktop`: latest Debian stable, text mode, same setup, `mp281x` with passwordless sudo (`/etc/sudoers.d/99-mp281x-nopasswd`, mode 0440). Sign-ins and machine configuration are never copied between machines; only [T3 settings](#t3-settings) are shared.

| Fact     | `dev`                                                                                     | `desktop`                                                                      |
| -------- | ----------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------ |
| Hardware | VPS, 8 cores, 23 GB, 15 GB swap                                                           | Ryzen 9 9900X, 30 GB, 31 GB swap, 1 TB NVMe                                    |
| Network  | Always on, public `77.237.236.132`; ufw allows TCP 80, 443, 25565 (Minecraft) and UDP 443 | On demand, behind NAT: `eno1` has LAN `192.168.1.112`; ufw denies all incoming |
| GitLab   | Through the VPN, signed in again after each reboot; advertises the route to the tailnet   | Through dev's route (`--accept-routes`)                                        |
| sshd     | `/etc/ssh/sshd_config`, with drop-ins                                                     | Debian's                                                                       |
| GPU      | None                                                                                      | NVIDIA GeForce RTX 5070, 12 GB; [setup](#desktop-gpu)                          |

- **Toolchain.** Docker with Compose and Buildx, `gh` with `github/gh-stack`, `glab`, git, build tools, rsync, ripgrep, jq, sqlite3, lsof, btop (never htop), ffmpeg, ImageMagick, `dig`, `psql`. Vite+ in `~/.vite-plus` holds Codex and `t3@nightly`; Claude Code in `~/.local/bin`. `~/.bashrc`'s first lines, above its interactive guard, put `$HOME/.local/bin:$HOME/.vite-plus/bin` on `PATH`. `swapon`, `sshd` and `ufw` live in `/usr/sbin`, off a non-login `PATH`, so call them by path.
- **T3 versions.** Three things carry a version. `activeVersion` in `~/.t3/runtime/service-state.json` is the server child (`t3 serve`) that runs. The `ExecStart` of `~/.config/systemd/user/t3code.service` names an older `__service-launcher` (0.1.3 on dev, 0.1.6 on desktop, against 0.1.9 active): both directories stay. The global `t3` in `~/.vite-plus` is a separate install; a stale one prints "unknown to this build" migration warnings against the newer database.
- **Sign-ins.** Per worker, show the user each link: `gh auth login`, `glab auth login --hostname git.datapizza.tech`, `claude auth login`, `codex login --device-auth`, [MCP](#mcp-sign-in).
- **Repositories.** `~/dual`: credential helper `!glab auth git-credential` for `https://git.datapizza.tech`; GitHub: `gh auth setup-git`; [Git identity](#git-identity).
- **Updates.** `unattended-upgrades` daily. desktop has no public IPv4 (LAN only, NAT): `/etc/apt/apt.conf.d/99force-ipv4` holds `Acquire::ForceIPv4 "true";`.
- **Git defaults.** `rebase.updateRefs`, `rebase.autoSquash`, `rebase.autoStash`, `push.autoSetupRemote`, `fetch.prune`, `rerere.enabled`, `diff.algorithm histogram`, `merge.conflictStyle zdiff3`, `init.defaultBranch main`.
- **Firewall.** Tailscale's `ts-input` accepts tailnet traffic before ufw; dev's web ports serve Deploy's Caddy user service. `/etc/sysctl.d/90-quiet-console.conf` keeps `[UFW BLOCK]` off dev's console.
- **TCP on dev.** `/etc/sysctl.d/90-tcp.conf`: `fq`, `bbr`, `tcp_slow_start_after_idle = 0`, for lossy phones and idle keep-alive or WebSocket connections.
- **Access.** One ED25519 pair as `~/.ssh/id_ed25519` everywhere; `authorized_keys` holds only its public key; no `~/.ssh/config`; `known_hosts` from `ssh-keyscan -H dev desktop macbook-pro`. Disable a login method only after the other worked from another machine.
- **sshd.** `UsePAM yes` supplies `XDG_RUNTIME_DIR` and `DBUS_SESSION_BUS_ADDRESS`, including non-interactive SSH; without it, `systemctl --user` fails with "Failed to connect to user scope bus". dev's `sshd_config` includes `/etc/ssh/sshd_config.d/*.conf`; `10-keys-only.conf` disables password, keyboard-interactive and root login. Trust `sudo sshd -T`.
- **T3 and reboots are the user's.** Never run `t3 update`, `t3 doctor --fix` or `t3 service restart`, and never reboot. The user updates T3 from its UI and restarts the machines.

## Set up

### Debian worker

From a Debian netinst image with only the SSH server task.

1. **Base.** Install `sudo`, `network-manager`, `ufw`. `/tmp` on disk: `printf 'D /tmp 1777 root root 7d\n' | sudo tee /etc/tmpfiles.d/tmp.conf && sudo systemctl mask tmp.mount`. Purge any desktop stack with `--autoremove`; keep `multi-user.target`.
2. **Tools.** Sudoers file; Docker and GitHub CLI apt sources with keys in `/etc/apt/keyrings/<name>.gpg`; the toolchain, `glab`, `unattended-upgrades`; git defaults; `mp281x` in `docker`; `/etc/docker/daemon.json` as `{"live-restore": true, "ip": "127.0.0.1", "default-network-opts": {"bridge": {"com.docker.network.bridge.host_binding_ipv4": "127.0.0.1"}}}`.
3. **Network.** The user's key pair, then the Tailscale block below. After a second SSH login over the tailnet: `ufw default deny incoming`, dev's ports from **Machines**, enable ufw.
4. **VPN.** dev only: `openvpn3-client`, `openvpn3 config-import --config <datapizza.ovpn> --name datapizza --persistent`, connect with the user's web SSO (Check's **Datapizza VPN**), advertise its route.
5. **Runtime.** `loginctl enable-linger mp281x`. As `mp281x`: Vite+ with `VP_HOME="$HOME/.vite-plus"`, the global packages, Claude Code, the `PATH` line; check `ssh <worker> 'command -v vp claude codex'`. `~/.config/pnpm/config.yaml`: `minimumReleaseAgeExclude: ["@deslop/*"]`.
6. **T3.** `vp install -g t3@nightly`, `t3 service install`, `t3 connect link --headless` (link to the user), `t3 connect publish`, `t3 browser setup`. Name it: `sudo hostnamectl set-hostname --pretty <name>`; T3 shows it after the user's next restart.
7. **Accounts.** GitHub, GitLab, Claude and Codex sign-ins, `gh extension install github/gh-stack`, Git identity, clone both repositories, `t3 project add --title <name> <path>`. dev: deploy.
8. **Agents.** [Agent configuration](#agent-configuration), [T3 settings](#t3-settings) from another worker, [MCP sign-in](#mcp-sign-in).
9. **SSH.** After a key login from another machine: `/etc/ssh/sshd_config.d/10-keys-only.conf` with `UsePAM yes`, `PasswordAuthentication no`, `KbdInteractiveAuthentication no`, `PermitRootLogin no`, `X11Forwarding no`. sshd keeps the first value it reads: verify `sshd_config` starts with `Include /etc/ssh/sshd_config.d/*.conf` and the drop-in precedes any conflicting defaults. Then `sudo sshd -t && sudo systemctl reload ssh` and Check's **sshd**.
10. **GPU.** desktop only: [setup](#desktop-gpu).

```bash
command -v tailscale >/dev/null || {
  curl -fsSL https://pkgs.tailscale.com/stable/debian/trixie.noarmor.gpg | sudo tee /usr/share/keyrings/tailscale-archive-keyring.gpg >/dev/null
  curl -fsSL https://pkgs.tailscale.com/stable/debian/trixie.tailscale-keyring.list | sudo tee /etc/apt/sources.list.d/tailscale.list
  sudo apt-get update && sudo apt-get install -y tailscale
}
openvpn3 configs-list 2>/dev/null | grep -q datapizza && R=$(getent ahostsv4 git.datapizza.tech | awk 'NR == 1 {print $1}')/32
sudo tailscale up --accept-routes --advertise-routes=$R
```

Show the user the `tailscale up` URL; the user disables key expiry and approves an advertised route at https://login.tailscale.com/admin/machines.

### Agent configuration

- **Variables.** Agent-only values go in `.claude/settings.json` `env` and `.codex/global-config.toml` `shell_environment_policy.set`, never `~/.bashrc`.
- **Links.** Target `~/deslop` on `main`; `git -C ~/deslop pull --ff-only` between sessions. Running threads keep their configuration; never switch that checkout off `main`. The global Codex config's distinct filename avoids reloading it as project config.

Once per worker, and after a harness replaced a link with a file:

```bash
r=~/deslop
mkdir -p ~/.claude/agents ~/.claude/skills ~/.codex/rules ~/.codex/skills
ln -sfn $r/.claude/settings.json ~/.claude/settings.json
ln -sfn $r/.claude/agents/pair.md ~/.claude/agents/pair.md
for s in $r/.claude/skills/*; do n=${s##*/}; rm -f ~/.claude/skills/$n ~/.codex/skills/$n; done
ln -sfn $r/.claude/skills/* ~/.claude/skills/
ln -sfn ~/.claude/skills/* ~/.codex/skills/
ln -sfn $r/.codex/global-config.toml ~/.codex/config.toml
ln -sfn $r/.codex/instructions.md ~/.codex/instructions.md
ln -sfn $r/.codex/rules/deny.rules ~/.codex/rules/deny.rules
codex execpolicy check --rules ~/.codex/rules/deny.rules true
```

- **New links.** Before merging, link both workers to the future path in `~/deslop`, never a review worktree; they resolve once main fast-forwards. Remove previous links before recreating them; retire only this setup's old links and keep unrelated skills and real directories.
- **Check.** `find ~/.claude/settings.json ~/.claude/agents/pair.md ~/.codex/config.toml ~/.codex/instructions.md ~/.codex/rules/deny.rules ~/.claude/skills/* ~/.codex/skills/* -maxdepth 0 ! -type l` prints replaced links and unrelated real directories, including HyperFrames; leave those directories alone. `git -C ~/deslop status --short` shows a harness write through a link: carry it into a PR, then `git -C ~/deslop restore` it, since a dirty checkout stops the pull.

### T3 settings

After a settings change, run on that worker with `target=mp281x@<other worker>`; maps project keys by workspace root, preserves the target's `environmentIcon`. T3 reloads the file.

```bash
q="SELECT project_id, workspace_root FROM projection_projects WHERE deleted_at IS NULL"
new=$(jq --argjson src "$(sqlite3 -readonly -json ~/.t3/userdata/statev2.sqlite "$q")" \
  --argjson dst "$(ssh "$target" "sqlite3 -readonly -json ~/.t3/userdata/statev2.sqlite '$q'")" \
  --argjson old "$(ssh "$target" 'cat ~/.t3/userdata/settings.json')" '
  ([$src[] | {key: .project_id, value: .workspace_root}] | from_entries) as $root
  | ([$dst[] | {key: .workspace_root, value: .project_id}] | from_entries) as $id
  | def remap: with_entries(select($id[$root[.key]] != null) | .key = $id[$root[.key]]);
  (. | del(.environmentIcon)) + ($old | {environmentIcon} | with_entries(select(.value != null)))
  | .projectSettingsOverrides |= ((. // {}) | remap)
  | .projectSettingsFolded |= ((. // {}) | if type == "object" then remap else . end)
' ~/.t3/userdata/settings.json) && ssh "$target" 'cat > ~/.t3/userdata/settings.json' <<<"$new"
```

- **Claude launch arguments.** `providerInstances.claudeAgent.config.launchArgs`: `--system-prompt-snapshot off --thinking-display omitted --autocompact 500k`; new Claude processes pick them up, so never restart T3 or stop threads for them.
- **Project scripts.** T3 keeps a project's saved scripts in three stores; only the first two are ours:
  1. `projectSettingsOverrides.<id>.defaultProjectScripts` in `~/.t3/userdata/settings.json`: what T3 runs, and what the copy above syncs.
  2. The project record: `scripts` in `t3_project_read`, written by `t3_project_update`. Keep it equal to the first.
  3. Top-level `projectScriptOverrides`: the legacy map. With `projectSettingsFolded` true, T3 never reads it and rewrites it from the first store whenever it loads or saves settings (`deriveLegacyProjectOverrides`). It is a derived mirror: never edit it; it matches the first store after T3's next settings write.

  A checked-in `t3.json` stays unset.

### Desktop GPU

- **Driver.** RTX 5070 (Blackwell): NVIDIA's open kernel modules, not Nouveau or Debian 13's stock 550. [NVIDIA's Debian guide](https://docs.nvidia.com/datacenter/tesla/driver-installation-guide/debian.html), Debian 13 APT repository, headless compute packages; no desktop stack, no full CUDA toolkit.

```bash
curl -fsSLo /tmp/cuda-keyring_1.1-1_all.deb https://developer.download.nvidia.com/compute/cuda/repos/debian13/x86_64/cuda-keyring_1.1-1_all.deb
sudo dpkg -i /tmp/cuda-keyring_1.1-1_all.deb
sudo apt-get update
sudo apt-get install -y --no-install-recommends linux-headers-amd64 "linux-headers-$(uname -r)" nvidia-driver-cuda nvidia-kernel-open-dkms
```

- **Secure Boot.** Keep it on. DKMS signs with `/var/lib/dkms/mok.key` and `/var/lib/dkms/mok.pub`; keep that pair across updates. Check `sudo mokutil --sb-state` and `sudo mokutil --test-key /var/lib/dkms/mok.pub`; skip enrollment if enrolled. [MOK enrollment](https://wiki.debian.org/SecureBoot) needs physical confirmation before Linux boots, never over SSH; desktop has no monitor or keyboard, so arrange one or a remote KVM and the restart with the user first.

1. **Password.** One-time password through `request_secret` with file delivery, fed twice on stdin to `sudo mokutil --import /var/lib/dkms/mok.pub` without exposing it; confirm with `sudo mokutil --list-new`.
2. **Boot.** To connect a monitor, power off, not reboot. Boot; at “Press any key to perform MOK management”, press a key promptly, then choose **Enroll MOK**, **Continue** and **Yes**. Enter the temporary password, then choose **Reboot**.
3. **Deferred.** `sudo mokutil --revoke-import`, requeue before the agreed boot. Missed prompt: check `--list-new`, requeue if empty.

- **Check.** After boot, `nvidia-smi` lists the RTX 5070; `lspci -nnk -d 10de:` shows `Kernel driver in use: nvidia`; `sudo dkms status` has the module for `uname -r`; the MOK test says enrolled; `systemctl --failed` empty; `sudo journalctl -k -b` free of NVIDIA init failures and Xid errors. An install or DKMS build alone is no active driver; `Key was rejected by service` means enrollment is missing. After updates, compare `sudo modinfo -F version nvidia` with `nvidia-smi`; when the loaded driver or kernel lags, the restart waits on the user. `nvidia-smi`'s CUDA version is driver compatibility, not an installed toolkit.

### Mac

T3 desktop and iOS Simulator; builds from CI. No Docker.

- **MDM.** Keep the user's organization's policies.
- **Reachability.** System sleep off, so reachable with the display off; a closed lid isn't. When `ssh matteopaludgnach@macbook-pro true` fails, ask the user to wake it.
- **Sudo.** Needs the user's password: apps, updates and permissions are the user's, from a guide. Agents run only maintenance mutations: `vp upgrade`, `softwareupdate -l` and `xcrun simctl delete unavailable`; read-only checks and device setup below are separate.

**Device host.**

1. **Runtime.** `curl -fsSL https://vite.plus | bash`; `~/.zshenv` holds `export PATH="$HOME/.local/bin:$HOME/.vite-plus/bin:$PATH"` and `export DEVELOPER_DIR=/Applications/Xcode.app/Contents/Developer`.
2. **Xcode.** `open "macappstore://apps.apple.com/app/id497799835"`; guide: Get, open Xcode once, accept the license, download the iOS platform.
3. **Check.** Over SSH: `xcrun simctl list runtimes` lists iOS; `node --version` meets root `package.json`'s `engines` and the apps' EAS build requirements.
4. **T3.** Guide: Settings, Integrations, Devices, the worker's environment, Device hub and Agent device access on, add `matteopaludgnach@macbook-pro`, test. Copy the settings to the other worker.

### MCP sign-in

- **Endpoint.** Register the endpoint described in `apps/gateway/README.md`.
- **Codex.** Reads `gateway` from the installed configuration; OAuth sign-ins live in the Secret Service keyring, which D-Bus must start through its unit: Debian's default activation starts a locked daemon whose headless unlock prompt hangs every Codex start.
- **Claude.** Keeps local MCP servers in `~/.claude.json`: register the gateway per worker.

```bash
sudo apt-get install -y gnome-keyring libsecret-tools
mkdir -p ~/.config/systemd/user
printf '%s\n' '[Unit]' 'Description=Secret Service for headless CLI sign-ins' '[Service]' \
  "ExecStart=/bin/sh -c 'printf headless | exec /usr/bin/gnome-keyring-daemon --foreground --replace --unlock --components=secrets'" \
  'Restart=on-failure' '[Install]' 'WantedBy=default.target' > ~/.config/systemd/user/secret-service.service
mkdir -p ~/.local/share/dbus-1/services
printf '%s\n' '[D-BUS Service]' 'Name=org.freedesktop.secrets' 'Exec=/bin/false' 'SystemdService=secret-service.service' \
  > ~/.local/share/dbus-1/services/org.freedesktop.secrets.service
busctl --user call org.freedesktop.DBus / org.freedesktop.DBus ReloadConfig
systemctl --user daemon-reload && systemctl --user enable --now secret-service.service
claude mcp add --transport http --scope user gateway https://gateway.mp281x.xyz/mcp
```

**Harness sign-in.** `claude mcp login --no-browser gateway` or `codex mcp login --no-browser gateway`; approve the printed code at https://auth.mp281x.xyz. Claude appears as a Claude Code column in Sign-ins.

**Browser sign-in.** A profile without the user's GitHub, such as the Datapizza work profile: **Sign in with a code** at https://auth.mp281x.xyz, which the user approves. A provider whose account lives in that profile, such as Dual, connects from its row on the gateway's page there.

- **Connectors.** Use only the gateway, not a claude.ai connector, Mobbin included. Once any `serverUrl` entry exists, every remote server needs a URL rule, T3's `http://127.0.0.1:<port>/mcp` included.
- **Check.** `codex mcp list` and `claude mcp list`, plus one real tool call. `features.mcp_2026_07_28` is global: verify the gateway's tool list when changing it. Mobbin: one `mobbin__search_screens` with `mode: "standard"`; the default, `deep`, spends AI credits.

### Git identity

Picked from the remote; repositories carry no `user.*`.

```bash
mkdir -p ~/.config/git
printf '[user]\n\tname = MP281X\n\temail = dev@mp281x.xyz\n' > ~/.config/git/github.gitconfig
printf '[user]\n\tname = Matteo Paludgnach\n\temail = matteopaludgnach@datapizza.tech\n' > ~/.config/git/datapizza.gitconfig
for u in 'https://github.com/**' 'git@github.com:**' 'ssh://git@github.com/**'; do git config --global "includeIf.hasconfig:remote.*.url:$u.path" ~/.config/git/github.gitconfig; done
for u in 'https://git.datapizza.tech/**' 'git@git.datapizza.tech:**' 'ssh://git@git.datapizza.tech/**'; do git config --global "includeIf.hasconfig:remote.*.url:$u.path" ~/.config/git/datapizza.gitconfig; done
```

## Clean state

Update, Clean, Check, in that order. End by reporting what waits on the user's restart: a kernel, a macOS update, a T3 update.

### Update

1. **Packages.** `sudo apt-get update && sudo apt-get upgrade -y && sudo apt-get autoremove -y && sudo apt-get clean`, `vp upgrade`, `gh extension upgrade --all` (`gh-stack` lags per worker). glab: when `curl -fsSL https://gitlab.com/api/v4/projects/gitlab-org%2Fcli/releases/permalink/latest` names a newer `tag_name`, `curl -fLo /tmp/glab.deb` `https://gitlab.com/gitlab-org/cli/-/releases/<tag>/downloads/glab_<version>_linux_amd64.deb` then `sudo dpkg -i /tmp/glab.deb`.
2. **T3.** The user updates the service from T3's UI. Per worker, the global CLI only: `vp install -g t3@nightly`. A pending service update waits on the user.
3. **Mac.** `vp upgrade` ([Mac](#mac)); a pending macOS update is the user's, labelled from `softwareupdate -l`.

### Clean

**Clean removes; it does not list.** On every machine, remove what no kept thing needs, running or not. `docker system prune` stays out.

- **Owners.** Threads in `orchestration_v2_projection_threads.payload_json` (`worktreePath`, `settledAt`) with `archived_at` and `deleted_at`, delegated children counted by their root thread; a process whose `/proc/<pid>/cwd` is inside the worktree. Inventory from the local SQLite projection, not T3's first thread page; join owners to `lineage.rootThreadId`, inspect user side chats separately, and re-read ownership immediately before removal.
- **Keep.** Worktrees an unsettled thread owns; the default branch; a branch checked out in a kept worktree or with an OPEN pull or merge request; production `deslop-*` user services and their inactive `-update` oneshots (every 15 minutes); `t3code`, `minecraft`, `deploy-caddy`; a container stopped on purpose.
- **Never.** Conversation databases or sessions from T3, Codex or Claude as cache. Report unknown ownership, history, credentials, production data and running jobs separately from garbage.

1. **Worktrees.** Those no unsettled thread owns and no process uses, uncommitted changes included. Run its settle script ("Unit … not loaded" for an already stopped preview is harmless); for an Alchemy preview, run `preview:destroy` first. Then `git worktree remove --force --force <path>` and `git worktree prune`.
2. **Containers.** Remove each container that serves no kept worktree and no deliberate service, running ones included. Owners: a Compose container's `com.docker.compose.project.working_dir`; an Alchemy preview container's `dual.preview` label (`wt-<id>`) and the worktree holding `infra/saas/.alchemy/preview/wt-<id>` in its bind mounts; an OpenSandbox `sandbox-*` container (no Compose label) belongs to the `dualos-local-sandboxes-wt-<id>-*` network it joins. Then their networks and the unattached volumes.

   ```bash
   docker ps -a --format '{{.Names}}\t{{.Status}}\t{{.Label "com.docker.compose.project.working_dir"}}\t{{.Label "dual.preview"}}'
   docker rm -f <name> …
   docker network prune -f
   docker volume ls -q --filter dangling=true | xargs -r docker volume rm
   ```

   A container stopped on purpose and kept gets `docker update --restart no <name>`, so a reboot does not bring it back.

3. **Branches.** In `~/deslop` and `~/dual`, after the worktrees: keep a branch only if it is the default branch, is checked out in a kept worktree, or has an OPEN pull or merge request; delete the rest. A failed host query skips the branch.

   ```bash
   git fetch -q --prune origin
   keep=$(git worktree list --porcelain | awk '/^branch /{sub("refs/heads/","",$2); print $2}')
   default=$(git symbolic-ref --short refs/remotes/origin/HEAD | sed 's|origin/||')
   for b in $(git for-each-ref --format='%(refname:short)' refs/heads); do
     [ "$b" = "$default" ] && continue
     echo "$keep" | grep -qx "$b" && continue
     if git remote get-url origin | grep -q github.com; then open=$(gh pr list --head "$b" --state open --json number -q length)
     else open=$(glab mr list --source-branch "$b" -F json | jq length); fi
     [ -n "$open" ] || continue
     [ "$open" -gt 0 ] || { git branch -D "$b" >/dev/null && echo "deleted $b"; }
   done
   ```

4. **Exposures.** Remove each Serve mapping and Deploy exposure whose backend no longer answers. Any HTTP status, a deliberate 401 or 404 included, shows a backend; only a refused or timed-out connection does not.

   ```bash
   tailscale serve status --json | jq -r '.Web // {} | to_entries[] | .key as $k | .value.Handlers[] | select(.Proxy) | "\($k) \(.Proxy)"' |
     while read -r host url; do curl -s -o /dev/null --max-time 3 "$url" || sudo tailscale serve --https=${host##*:} off; done
   ```

   Deploy: `list_apps` per worker; an entry with a `url` and a `failure`, or a port `ss -ltn` does not list, gets `hide_exposure`.

5. **Orphans.** Processes with a deleted working directory; scratch leftovers; `preview-*` units of removed worktrees; a `~/.deslop/<name>` whose worktree is gone, unless a `deslop-<name>` service's data directory or env file.
6. **Caches.** No `docker build` or Compose build in progress: `docker image prune -a -f`, `docker builder prune -a -f`; long-lived preview watchers do not block these. No install running: `vp pm cache clean` in both repositories, `bun pm cache rm`, `npm cache clean --force`, `journalctl --vacuum-size=100M`.
7. **Versions.** Keep executables in `/proc/*/exe`, the current `~/.vite-plus/<version>` (`readlink ~/.vite-plus/current`), each Node major's newest patch under `~/.vite-plus/js_runtime/node`, and the Claude Code version `claude --version` reports under `~/.local/share/claude/versions`.
8. **T3 releases.** Skip while `~/.t3/runtime/service-state.json` shows an uncommitted update. Delete every `~/.t3/runtime/versions/<version>` except `activeVersion` (the running server), the one the unit's `ExecStart` names (the launcher), and a newer download.
9. **Mac.** `xcrun simctl delete unavailable`.

### Check

- **Units.** `systemctl --failed` and `systemctl --user --failed` empty.
- **Agents.** Agent configuration per its **Check**; every skill link resolves: this prints nothing. `~/deslop` clean on `main`, current with `origin/main`.

  ```bash
  find -L ~/.claude/skills ~/.codex/skills -maxdepth 1 -type l
  ```

- **Scripts.** Read all three stores. Per project, `projectSettingsOverrides` and the legacy `projectScriptOverrides` side by side, equal across both workers:

  ```bash
  dump='sqlite3 -readonly -json ~/.t3/userdata/statev2.sqlite "SELECT project_id, workspace_root FROM projection_projects WHERE deleted_at IS NULL" | jq -S --slurpfile s ~/.t3/userdata/settings.json '"'"'$s[0] as $s | map({(.workspace_root): {overrides: $s.projectSettingsOverrides[.project_id].defaultProjectScripts, legacy: $s.projectScriptOverrides[.project_id]}}) | add'"'"
  diff <(sh -c "$dump") <(ssh mp281x@<other worker> "$dump")
  ```

  Then `t3_project_read` per project: its `scripts` equals `overrides`. A difference in `overrides` or the record: fix per [T3 settings](#t3-settings); `legacy` differs from `overrides` only until T3's next settings write.

- **Git.** `git config --global --get-regexp '^(rebase|push|fetch|rerere|diff|merge|init)\.'` lists the git defaults.
- **sshd.** `sudo sshd -T` shows `usepam yes`, `kbdinteractiveauthentication no`, `passwordauthentication no`, `permitrootlogin no`; a fresh `ssh -tt <worker> 'echo $XDG_RUNTIME_DIR; systemctl --user is-active t3code'` prints `/run/user/1000` and `active`. Fix in the file sshd reads first ([sshd](#machines)), then `sudo sshd -t && sudo systemctl reload ssh`; a password-only login still gets `Permission denied (publickey)`.
- **T3 CLI.** `t3 --version` equals `activeVersion` in `~/.t3/runtime/service-state.json`; otherwise `vp install -g t3@nightly`.
- **T3 doctor.** `t3 doctor --base-dir ~/.t3 --dry-run` prints "Nothing to repair". Otherwise report the repairs: `--fix` pauses and restarts the service, so it is the user's.
- **T3 Connect.** `t3 connect status` ends with "✓ Other devices can reach this machine". An unlink, from the T3 app or `t3 connect unlink`, deletes the relay link and publishing state, and a reboot does not restore them: `t3 connect link --headless` (reuses the authorization when status shows "Authorization: stored credential"), then `t3 connect publish` (`--disable` turns it off); the service restart that follows is the user's. After a re-link, dev's provider resolvers and the home router (192.168.1.1, desktop's through MagicDNS) can cache NXDOMAIN for the same `prod-<id>.t3coderelay.com` for up to 30 minutes (Cloudflare SOA minimum 1800 s); `sudo resolvectl flush-caches` clears only the local cache. Test the tunnel with `curl --resolve <host>:443:<ip from dig @1.1.1.1> https://<host>/`.
- **Datapizza VPN.** dev: `openvpn3 sessions-list` shows "Client connected"; both workers: `git -C ~/dual ls-remote -q origin HEAD` succeeds. Otherwise `openvpn3 session-start --config datapizza` prints a `https://vpn-gw.datapizza.tech/oauth2/start?...` web SSO URL only the user can approve: show it to the user. A dev reboot needs that sign-in.
- **Desktop.** The [GPU check](#desktop-gpu), also after kernel or driver updates.
- **Docker.** Each prints nothing, except Minecraft's published 25565:

  ```bash
  docker ps -q | xargs -r docker inspect --format '{{.Name}}{{range $p,$b := .NetworkSettings.Ports}}{{range $b}}{{if or (eq .HostIp "0.0.0.0") (eq .HostIp "::")}} {{.HostPort}}{{end}}{{end}}{{end}}' | awk 'NF>1'
  docker network ls --filter dangling=true --format '{{.Name}}'
  docker ps -aq --filter status=exited --filter status=created | xargs -r docker inspect --format '{{.Name}} {{.HostConfig.RestartPolicy.Name}}' | grep -v ' no$'
  docker volume ls -q --filter dangling=true
  ```

  A port published on every interface: remove the container, or recreate it publishing on `127.0.0.1`. An unused network: `docker network prune -f`. A stopped container with another policy: `docker update --restart no <name>`.

- **Exposures.** Clean's loop over `tailscale serve status --json` and Deploy's `list_apps` leave no mapping or exposure without a backend. A health route beats a status code when the app has one: scope's `/health` returns `ready`; opm, stash and trips return 404 at `/` by design, so their health is the unit active plus a current run start in Scope `check_ingestion`.

### Deep pass

Once a pass shows faults, or on request:

- **Disk.** Capture `df -B1` on Debian, `df -k` on the Mac, and `df -i` on both, per disk-backed mount before and after; `du -xhd1` under the home, `/var/lib`, `/var/cache`, `/var/log` and `/tmp`. Measure containerd's snapshot store as well as `/var/lib/docker`. Compare `du`, `df` and `sudo lsof -l +L1 -nP` for deleted-but-open disk files; `-l` avoids UID lookup warnings. Chromium memfd and shared-memory files are not disk leaks. Report a deleted Deploy Caddy binary: `caddy reload` leaves it running until unit restart or reboot.
- **Listeners.** Identify each listener and Serve handler's unit or container and backend.
- **Close.** `dpkg --audit`, held and upgradable packages after refreshing apt, running versus installed kernel and driver, boot kernel errors, firewall and Docker bind policy, service health. Report denied cleanup without another utility, and faults, unknown owners or waiting restarts without calling the machine pristine.
