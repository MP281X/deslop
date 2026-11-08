# Maintenance

Setup, upkeep and rebuild of the machines.

## Machines

`dev` and `desktop`: latest Debian stable, text mode, same setup, `mp281x` with passwordless sudo (`/etc/sudoers.d/99-mp281x-nopasswd`, mode 0440). Sign-ins and machine configuration are never copied between machines; only [T3 settings](#t3-settings) are shared.

| Fact     | `dev`                                                                                   | `desktop`                                              |
| -------- | --------------------------------------------------------------------------------------- | ------------------------------------------------------ |
| Hardware | VPS, 8 cores, 23 GB, 15 GB swap                                                         | Ryzen 9 9900X, 30 GB, 31 GB swap, 1 TB NVMe            |
| Network  | Always on, public `77.237.236.132`; ufw allows 80, 443 and UDP 443                      | On demand, home LAN on `eno1`; ufw denies all incoming |
| GitLab   | Through the VPN, signed in again after each reboot; advertises the route to the tailnet | Through dev's route (`--accept-routes`)                |
| sshd     | The VPS provider's `/etc/ssh/sshd_config` (2025-12-29)                                  | Debian's                                               |
| GPU      | None                                                                                    | NVIDIA GeForce RTX 5070, 12 GB; [setup](#desktop-gpu)  |

- **Toolchain.** Docker with Compose and Buildx, `gh` with `github/gh-stack`, `glab`, git, build tools, rsync, ripgrep, jq, sqlite3, lsof, btop (never htop), ffmpeg, ImageMagick, `dig`, `psql`. Vite+ in `~/.vite-plus` holds Codex and `t3@nightly`; Claude Code in `~/.local/bin`. `~/.bashrc`'s first lines, above its interactive guard, put `$HOME/.local/bin:$HOME/.vite-plus/bin` on `PATH`. `swapon`, `sshd` and `ufw` live in `/usr/sbin`, off a non-login `PATH`.
- **T3 versions.** The service runs `activeVersion` from `~/.t3/runtime/versions`; the global `t3` in `~/.vite-plus`, which runs `t3 doctor` and `t3 service restart`, is a separate install. A stale CLI prints "unknown to this build" migration warnings against the newer database.
- **Sign-ins**, per worker, link shown to the user: `gh auth login`, `glab auth login --hostname git.datapizza.tech`, `claude auth login`, `codex login --device-auth`, [MCP](#mcp-sign-in).
- **Repositories.** `~/dual`: credential helper `!glab auth git-credential` for `https://git.datapizza.tech`; GitHub: `gh auth setup-git`; [Git identity](#git-identity).
- **Updates.** `unattended-upgrades` daily. desktop has only local IPv6: `/etc/apt/apt.conf.d/99force-ipv4` holds `Acquire::ForceIPv4 "true";`.
- **Git defaults:** `rebase.updateRefs`, `rebase.autoSquash`, `rebase.autoStash`, `push.autoSetupRemote`, `fetch.prune`, `rerere.enabled`, `diff.algorithm histogram`, `merge.conflictStyle zdiff3`, `init.defaultBranch main`.
- **Firewall.** Tailscale's `ts-input` accepts tailnet traffic before ufw; ufw allows dev's 80, 443 and UDP 443 for Deploy's Caddy, which runs as a user service. dev: `/etc/sysctl.d/90-quiet-console.conf` keeps `[UFW BLOCK]` off the console.
- **TCP on dev.** `/etc/sysctl.d/90-tcp.conf`: `fq`, `bbr`, `tcp_slow_start_after_idle = 0`, for lossy phones and idle keep-alive or WebSocket connections.
- **Access.** One ED25519 pair as `~/.ssh/id_ed25519` everywhere; `authorized_keys` holds only its public key; no `~/.ssh/config`; `known_hosts` from `ssh-keyscan -H dev desktop macbook-pro`. Disable a login method only after the other worked from another machine.
- **sshd.** `UsePAM yes` gives an SSH login its systemd user session; OpenSSH's default is `no`, which leaves `XDG_RUNTIME_DIR` and `DBUS_SESSION_BUS_ADDRESS` unset, so `systemctl --user` fails with "Failed to connect to user scope bus" and `t3 service restart` with `BootServiceCommandError`. dev's provider file has no `UsePAM yes` and no `Include /etc/ssh/sshd_config.d/*.conf`, so no drop-in is read there; it ends with appended `UsePAM yes` and `KbdInteractiveAuthentication no` (keeps PAM from offering password prompts). A provider `sshd_config.d/50-cloud-init.conf` sets `PasswordAuthentication yes`. Trust `sudo sshd -T`, not a file.
- **Hostname** T3 shows: `sudo hostnamectl set-hostname --pretty <name>`, then restart T3.

## Agent configuration

- **Variables** for agents only: `.claude/settings.json` `env` and `.codex/global-config.toml` `shell_environment_policy.set`, never `~/.bashrc`.
- **`.codex/global-config.toml`** avoids loading the global config again as project config.
- **Links** into the main checkout `~/deslop`, so workers run `origin/main`; update it explicitly with `git -C ~/deslop pull --ff-only` between sessions. Running threads keep their configuration.
- **Never** edit an installed path or switch `~/deslop` off `main`: both change every thread.

| Installed path              | Links to                    |
| --------------------------- | --------------------------- |
| `~/.claude/settings.json`   | `.claude/settings.json`     |
| `~/.claude/agents/pair.md`  | `.claude/agents/pair.md`    |
| `~/.claude/skills/*`        | `.claude/skills/*`          |
| `~/.codex/config.toml`      | `.codex/global-config.toml` |
| `~/.codex/instructions.md`  | `.codex/instructions.md`    |
| `~/.codex/rules/deny.rules` | `.codex/rules/deny.rules`   |
| `~/.codex/skills/*`         | `~/.claude/skills/*`        |

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

- **New links** before merging, on both workers, to the future path in `~/deslop`, never a review worktree; they resolve once main fast-forwards. Remove the previous links before recreating them; retire only this setup's old links and keep unrelated skills and real directories.
- **Check.** `find ~/.claude/settings.json ~/.claude/agents/pair.md ~/.codex/config.toml ~/.codex/instructions.md ~/.codex/rules/deny.rules ~/.claude/skills/* ~/.codex/skills/* -maxdepth 0 ! -type l` prints a replaced link; `git -C ~/deslop status --short` shows a harness write through a link: carry it into a PR, then `git -C ~/deslop restore` it, since a dirty checkout stops the pull.

## T3 settings

Shared by all workers. After the user changes one, run this on that worker with `target=mp281x@<other worker>`; it maps project keys by workspace root and keeps the target's `environmentIcon`. T3 reloads the file.

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
- **Project scripts** live in T3, not this document. Read and update current scripts through `t3_project_read` / `t3_project_update`; keep the project's `defaultProjectScripts` in settings equal for future worktrees, remapping project IDs by workspace root between workers. A checked-in `t3.json` and legacy `projectScriptOverrides` stay unset.

## Upkeep

"Maintenance" runs Update, Clean and Check on dev, desktop (when on) and the Mac, without asking. Reply: each machine's disk before and after, what Clean removed, failures, what still needs the user.

### Deep pass

Cache pruning alone is not maintenance. Capture `df -B1` and `df -i` per disk-backed mount before and after; use `du -xhd1` to attribute the largest directories under the home, `/var/lib`, `/var/cache`, `/var/log` and `/tmp`. Docker's containerd snapshot store can exceed `/var/lib/docker`; measure both. Compare `du` with `df` and `sudo lsof +L1 -nP` for deleted-but-open disk files; Chromium memfd/shared-memory files are not disk leaks. A `.../deploy/tools/<old version>/caddy (deleted)` is a known Deploy gap: it installs `deslop-deploy-caddy` with `restart: false` and only runs `caddy reload` (`apps/deploy/src/services/exposures/service.ts`), so the old binary runs until the unit restarts or the machine reboots; report it.

Over non-interactive `ssh`, `systemctl --user` and `journalctl --user` need `export XDG_RUNTIME_DIR=/run/user/$(id -u)`; call `/usr/sbin` tools by path.

Build the ownership inventory from the local SQLite projection, not the first page of T3's thread list. Join every worktree's owners to `lineage.rootThreadId`, inspect user side chats separately, and cross-check `/proc/*/cwd` before removal. A settled parent does not authorize deleting an unsettled side chat's checkout. Re-read ownership immediately before destructive cleanup. Preserve unknown ownership, history, credentials, production data and running jobs; report them separately from verified garbage.

For each listener and Serve handler, identify its unit/container and backend. A bounded HTTP response, including a deliberate 401/404, proves a responding server, not application health; use the app's real health route when one exists: scope's `/health` returns `ready`. opm, stash and trips return 404 at `/` by design, since their releases ship only `dist/server.js` for the native apps; their health is the unit active plus a current `runStartedAt` in Scope `list_services`. Remove a mapping only after its backend and owner are both proven obsolete. For Alchemy previews, run that settled worktree's `preview:destroy` before removing it; an orphaned bind path plus matching stage/container/volume names can establish ownership after its checkout disappeared. Remove those exact resources, never all stopped containers or unattached volumes.

Close with `dpkg --audit`, held/upgradable packages after refreshing apt, running versus installed kernel/driver, both failed-unit lists, boot kernel errors, firewall and Docker bind policy, service health, agent links, and clean/current main checkouts. Check caches only after builds/installs finish; protect executable versions still in `/proc/*/exe`, each Node major's newest patch, the active T3 service version and any staged update. Never erase T3/Codex/Claude conversation databases or sessions as cache. Report denied cleanup without retrying through another utility; do not call a machine pristine while a fault, unknown owner or deferred reboot/update remains. A dev reboot needs the user's Datapizza VPN sign-in (Check).

## Update

1. **Packages.** `sudo apt-get update && sudo apt-get upgrade -y && sudo apt-get autoremove -y && sudo apt-get clean`, `vp upgrade`, `gh extension upgrade --all` (`gh-stack` lags per worker). glab: when `curl -fsSL https://gitlab.com/api/v4/projects/gitlab-org%2Fcli/releases/permalink/latest` names a newer `tag_name`, `curl -fLo /tmp/glab.deb` `https://gitlab.com/gitlab-org/cli/-/releases/<tag>/downloads/glab_<version>_linux_amd64.deb` then `sudo dpkg -i /tmp/glab.deb`.
2. **T3**, nightly, as the `t3code.service` user unit: `t3 update --yes` with no run active; otherwise leave the download for the user. It updates only the service runtime: also `vp install -g t3@nightly` on each worker for the global CLI. New worker: `vp install -g t3@nightly`, `t3 service install`, `t3 connect link --headless` (link to the user), `t3 connect publish`.
3. **Mac.** The agent steps under [Mac](#mac); a pending macOS update is the user's, labelled from `softwareupdate -l`.

## Clean

Remove rebuildable data and settled work; keep what a working or unsettled thread uses.

- **Owners** of a worktree: threads in `orchestration_v2_projection_threads.payload_json` (`worktreePath`, `settledAt`) with `archived_at` and `deleted_at`, delegated children judged by their root thread; a process whose `/proc/<pid>/cwd` is inside it.
- **Keep** unattached volumes, the production `deslop-*` user services and their inactive `-update` oneshots, which run every 15 minutes.

1. **Orphans.** Compose projects whose `com.docker.compose.project.working_dir` is gone; containers exited for more than three days, a scratch run's leftovers, since a container that matters runs or restarts; processes with a deleted working directory; Serve mappings meeting the **Deep pass** ownership/obsolescence rule (`tailscale serve status --json`, then `sudo tailscale serve --https=<port> off`); `preview-*` units of removed worktrees; a `~/.deslop/<name>` whose worktree is gone, unless a `deslop-<name>` service's data directory or env file.
2. **Settled worktrees.** All user threads sharing it (roots and side chats) settled, archived or deleted, and no running process: remove it, uncommitted changes included. Run its settle script, remove a remaining Compose project, `git worktree remove --force --force <path>`, `git worktree prune`. No owner: remove when its branch's PR merged, otherwise list it.
3. **Branches.** In `~/deslop` and `~/dual`: delete unused local branches whose PR merged; list those without an open or merged PR.

   ```bash
   git fetch -q --prune origin
   used=$(git worktree list --porcelain | awk '/^branch /{sub("refs/heads/","",$2); print $2}')
   default=$(git symbolic-ref --short refs/remotes/origin/HEAD | sed 's|origin/||')
   for b in $(git for-each-ref --format='%(refname:short)' refs/heads); do
     [ "$b" = "$default" ] && continue
     echo "$used" | grep -qx "$b" && continue
     if git remote get-url origin | grep -q github.com; then state=$(gh pr list --head "$b" --state all --json state -q '.[0].state')
     else state=$(glab mr list --source-branch "$b" --all -F json | jq -r '.[0].state // empty'); fi
     case "$state" in
       MERGED|merged) git branch -D "$b" >/dev/null && echo "deleted $b" ;;
       OPEN|opened) ;;
       *) echo "keep $b: ${state:-no pull request}" ;;
     esac
   done
   ```

4. **Caches.** No build running: `docker image prune -a -f`, `docker builder prune -a -f` (tens of GB). No install running: `vp pm cache clean` in both repositories, `bun pm cache rm`, `npm cache clean --force`, `journalctl --vacuum-size=100M`. Never a blanket Docker system or volume prune.
5. **Versions.** Keep the current `~/.vite-plus/<version>` (`readlink ~/.vite-plus/current`); Node runtimes under `~/.vite-plus/js_runtime/node` a running process uses, plus each major's newest patch; the Claude Code version `claude --version` reports under `~/.local/share/claude/versions`.
6. **T3 releases.** Skip while `~/.t3/runtime/service-state.json` shows an uncommitted update. Delete every `~/.t3/runtime/versions/<version>` except its `activeVersion`, the one `ExecStart` names in `~/.config/systemd/user/t3code.service`, and a newer download.

## Check

Fix what fails, then rerun:

- `systemctl --failed` and `systemctl --user --failed` empty.
- Agent configuration per its **Check**; no dangling link under `~/.claude/skills` and `~/.codex/skills` except one staged for an unmerged rename; `~/deslop` clean on `main`, current with `origin/main`.
- Project scripts equal on both workers (`jq '.projectSettingsOverrides'`, mapped by workspace root); otherwise copy per [T3 settings](#t3-settings).
- `git config --global --get-regexp '^(rebase|push|fetch|rerere|diff|merge|init)\.'` lists the git defaults.
- **sshd.** `sudo sshd -T` shows `usepam yes`, `kbdinteractiveauthentication no`, `passwordauthentication no`, `permitrootlogin no`; a fresh `ssh -tt <worker> 'echo $XDG_RUNTIME_DIR; systemctl --user is-active t3code'` prints `/run/user/1000` and `active`. Fix in the file sshd reads first ([sshd](#machines)), then `sudo sshd -t && sudo systemctl reload ssh`; a password-only login still gets `Permission denied (publickey)`.
- **T3 CLI.** `t3 --version` equals `activeVersion` in `~/.t3/runtime/service-state.json`; otherwise `vp install -g t3@nightly`.
- **T3 doctor.** `t3 doctor --base-dir ~/.t3` marks nothing "(recommended)". Otherwise, with no run active, `t3 doctor --base-dir ~/.t3 --fix` (dev's `statev2.sqlite`: 8.18 → 3.29 GiB in about 2 minutes). It pauses the service: never on the worker hosting the current thread's run.
- **T3 Connect.** `t3 connect status` ends with "✓ Other devices can reach this machine". An unlink, from the T3 app or `t3 connect unlink`, deletes the relay link and publishing state, and a reboot does not restore them: `t3 connect link --headless` (reuses the authorization when status shows "Authorization: stored credential"), `t3 service restart`, `t3 connect publish` (`--disable` turns it off). After a re-link, dev's provider resolvers and the home router (192.168.1.1, desktop's through MagicDNS) can cache NXDOMAIN for the same `prod-<id>.t3coderelay.com` for up to 30 minutes (Cloudflare SOA minimum 1800 s); `sudo resolvectl flush-caches` clears only the local cache. Test the tunnel with `curl --resolve <host>:443:<ip from dig @1.1.1.1> https://<host>/`.
- **Datapizza VPN.** dev: `openvpn3 sessions-list` shows "Client connected"; both workers: `git -C ~/dual ls-remote -q origin HEAD` succeeds. Otherwise `openvpn3 session-start --config datapizza` prints a `https://vpn-gw.datapizza.tech/oauth2/start?...` web SSO URL only the user can approve: show it to the user.
- desktop: the [GPU check](#desktop-gpu), also after kernel or driver updates.

## Set up a worker

From a Debian netinst image with only the SSH server task.

1. Install `sudo`, `network-manager`, `ufw`. `/tmp` on disk: `printf 'D /tmp 1777 root root 7d\n' | sudo tee /etc/tmpfiles.d/tmp.conf && sudo systemctl mask tmp.mount`. Purge any desktop stack with `--autoremove`; keep `multi-user.target`.
2. Sudoers file; Docker and GitHub CLI apt sources with keys in `/etc/apt/keyrings/<name>.gpg`; the toolchain, `glab`, `unattended-upgrades`; git defaults; `mp281x` in `docker`; `/etc/docker/daemon.json` as `{"live-restore": true, "ip": "127.0.0.1", "default-network-opts": {"bridge": {"com.docker.network.bridge.host_binding_ipv4": "127.0.0.1"}}}`.
3. The user's key pair, then the Tailscale block below. After a second SSH login over the tailnet: `ufw default deny incoming`, allow 80 and 443 only on dev, enable ufw.
4. dev only: `openvpn3-client`, `openvpn3 config-import --config <datapizza.ovpn> --name datapizza --persistent`, connect with the user's web SSO (Check's **Datapizza VPN**), advertise its route.
5. `loginctl enable-linger mp281x`. As `mp281x`: Vite+ with `VP_HOME="$HOME/.vite-plus"`, the global packages, Claude Code, the `PATH` line; check `ssh <worker> 'command -v vp claude codex'`. `~/.config/pnpm/config.yaml`: `minimumReleaseAgeExclude: ["@deslop/*"]`. The T3 step, `t3 browser setup`, the hostname.
6. GitHub, GitLab, Claude and Codex sign-ins, `gh extension install github/gh-stack`, Git identity, clone both repositories, `t3 project add --title <name> <path>`. dev: deploy.
7. Agent configuration, T3 settings from another worker, MCP sign-in.
8. After a key login from another machine: `/etc/ssh/sshd_config.d/10-keys-only.conf` with `UsePAM yes`, `PasswordAuthentication no`, `KbdInteractiveAuthentication no`, `PermitRootLogin no`, `X11Forwarding no`. sshd keeps the first value it reads: `sshd_config` must start with `Include /etc/ssh/sshd_config.d/*.conf`, which a provider file may lack, and `10-keys-only.conf` must sort before a provider's `50-cloud-init.conf`. Then `sudo sshd -t && sudo systemctl reload ssh` and Check's **sshd**.
9. desktop only: the [GPU](#desktop-gpu).

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

## Desktop GPU

- **Driver.** RTX 5070 (Blackwell): NVIDIA's open kernel modules, not Nouveau or Debian 13's stock 550. [NVIDIA's Debian guide](https://docs.nvidia.com/datacenter/tesla/driver-installation-guide/debian.html), Debian 13 APT repository, headless compute packages; no desktop stack, no full CUDA toolkit.

```bash
curl -fsSLo /tmp/cuda-keyring_1.1-1_all.deb https://developer.download.nvidia.com/compute/cuda/repos/debian13/x86_64/cuda-keyring_1.1-1_all.deb
sudo dpkg -i /tmp/cuda-keyring_1.1-1_all.deb
sudo apt-get update
sudo apt-get install -y --no-install-recommends linux-headers-amd64 "linux-headers-$(uname -r)" nvidia-driver-cuda nvidia-kernel-open-dkms
```

- **Secure Boot** stays on. DKMS signs with `/var/lib/dkms/mok.key` and `/var/lib/dkms/mok.pub`; keep that pair across updates. Check `sudo mokutil --sb-state` and `sudo mokutil --test-key /var/lib/dkms/mok.pub`; skip enrollment if enrolled. [MOK enrollment](https://wiki.debian.org/SecureBoot) needs physical confirmation before Linux boots, never over SSH; desktop has no monitor or keyboard, so arrange one or a remote KVM and the restart with the user first.

1. One-time password through `request_secret` with file delivery, fed twice on stdin to `sudo mokutil --import /var/lib/dkms/mok.pub` without exposing it; confirm with `sudo mokutil --list-new`.
2. To connect a monitor, power off, not reboot. Boot; at “Press any key to perform MOK management”, press a key promptly, then **Enroll MOK → Continue → Yes → temporary password → Reboot**.
3. Deferred: `sudo mokutil --revoke-import`, requeue before the agreed boot. Missed prompt: check `--list-new`, requeue if empty.

- **Check** after the boot: `nvidia-smi` lists the RTX 5070; `lspci -nnk -d 10de:` shows `Kernel driver in use: nvidia`; `sudo dkms status` has the module for `uname -r`; the MOK test says enrolled; `systemctl --failed` empty; `sudo journalctl -k -b` free of NVIDIA init failures and Xid errors. An install or DKMS build alone is no active driver; `Key was rejected by service` means enrollment is missing. After updates, compare `sudo modinfo -F version nvidia` with `nvidia-smi` and coordinate a reboot when the loaded driver or kernel lags. `nvidia-smi`'s CUDA version is driver compatibility, not an installed toolkit.

## Mac

T3's desktop app and the iOS Simulator; builds nothing, the Simulator app comes from CI.

- **MDM** by the user's organization: keep its policies.
- **Reachability.** System sleep off, so reachable with the display off; a closed lid isn't. When `ssh matteopaludgnach@macbook-pro true` fails, ask the user to wake it.
- **Sudo** needs the user's password: apps, updates and permissions are the user's, from a guide. Agents run only maintenance mutations: `vp upgrade`, `softwareupdate -l` and `xcrun simctl delete unavailable`; read-only checks and the device workflow below are separate.

**Device host.**

1. `curl -fsSL https://vite.plus | bash`; `~/.zshenv` holds `export PATH="$HOME/.local/bin:$HOME/.vite-plus/bin:$PATH"` and `export DEVELOPER_DIR=/Applications/Xcode.app/Contents/Developer`.
2. `open "macappstore://apps.apple.com/app/id497799835"`; guide: Get, open Xcode once, accept the license, download the iOS platform.
3. Over SSH: `xcrun simctl list runtimes` lists iOS; `node --version` is 22.12 or newer.
4. Guide: T3 Settings, Integrations, Devices, the worker's environment, Device hub and Agent device access on, add `matteopaludgnach@macbook-pro`, test. Copy the settings to the other worker.

## MCP sign-in

- **One server** per harness: the gateway (`apps/gateway/README.md`), whose upstreams are Auth, Scope, Stash, Dual and Mobbin.
- **Codex** reads `gateway` from the installed configuration; OAuth sign-ins live in the Secret Service keyring, which D-Bus must start through its unit: Debian's default activation starts a locked daemon whose headless unlock prompt hangs every Codex start.
- **Claude** keeps local MCP servers in `~/.claude.json`: register the gateway per worker.

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

**Harness sign-in.** `claude mcp login --no-browser gateway` prints an authorization URL; approve its code at https://auth.mp281x.xyz. The sign-in is a Claude Code column in Sign-ins. Codex: `codex mcp login --no-browser gateway`.

**Browser sign-in.** A profile without the user's GitHub, such as the Datapizza work profile: **Sign in with a code** at https://auth.mp281x.xyz, which the user approves (`apps/auth/README.md`). A provider whose account lives in that profile, such as Dual, connects from its row on the gateway's page there.

- **Connectors.** `.claude/settings.json` sets `disableClaudeAiConnectors`: no claude.ai connector, Mobbin included, only the gateway. Once any `serverUrl` entry exists, every remote server needs a URL rule, T3's `http://127.0.0.1:<port>/mcp` included.
- **Check** with `codex mcp list` and `claude mcp list`, plus one real tool call. `features.mcp_2026_07_28` is global: verify the gateway's tool list when changing it. Mobbin: one `mobbin__search_screens` with `mode: "standard"`; the default, `deep`, spends AI credits.

## Git identity

Picked from the remote; repositories carry no `user.*`.

```bash
mkdir -p ~/.config/git
printf '[user]\n\tname = MP281X\n\temail = dev@mp281x.xyz\n' > ~/.config/git/github.gitconfig
printf '[user]\n\tname = Matteo Paludgnach\n\temail = matteopaludgnach@datapizza.tech\n' > ~/.config/git/datapizza.gitconfig
for u in 'https://github.com/**' 'git@github.com:**' 'ssh://git@github.com/**'; do git config --global "includeIf.hasconfig:remote.*.url:$u.path" ~/.config/git/github.gitconfig; done
for u in 'https://git.datapizza.tech/**' 'git@git.datapizza.tech:**' 'ssh://git@git.datapizza.tech/**'; do git config --global "includeIf.hasconfig:remote.*.url:$u.path" ~/.config/git/datapizza.gitconfig; done
```
