---
name: maintenance
description: Load before a maintenance pass, setting up or repairing a worker, or agent-configuration links.
---

# Maintenance

A pass runs Update, Clean and Check on each machine that is on, without asking: `dev`, `mp281x@desktop`, `matteopaludgnach@macbook-pro`. It runs on Claude Sonnet, since Codex rejects `rm -f` and `rm -rf`. End by reporting what waits on the user's restart (a kernel or macOS update); never pending T3 updates. Never run `t3 update`, `t3 doctor --fix` or `t3 service restart`, and never reboot: those are the user's.

**Never touch:**

- History: T3's databases and logs, `~/.claude/projects`, `~/.codex/sessions`.
- Credentials.
- Production data.
- Running jobs.
- Worktrees of running threads.

## Update

1. **Packages.** `sudo apt-get update && sudo apt-get upgrade -y && sudo apt-get autoremove -y && sudo apt-get clean`, `vp upgrade`, `gh extension upgrade --all`. glab: when `curl -fsSL https://gitlab.com/api/v4/projects/gitlab-org%2Fcli/releases/permalink/latest` names a newer `tag_name`, download `https://gitlab.com/gitlab-org/cli/-/releases/<tag>/downloads/glab_<version>_linux_amd64.deb` and `sudo dpkg -i` it. Mac: `vp upgrade`; label a pending macOS update from `softwareupdate -l`.
2. **T3 CLI.** `vp install -g t3@nightly`; the service updates from T3's UI.
3. **Configuration.** On every worker, `git -C ~/deslop pull --ff-only`. A harness rewrite of a linked file (Claude Code re-indents `settings.json`) blocks it: when `git -C ~/deslop diff -w` is empty, `git -C ~/deslop restore` first; a real change goes into a PR.

## Clean

Each step stands alone: a refusal or failure skips only that step. A thread owns a worktree through `worktreePath` in `orchestration_v2_projection_threads.payload_json`, delegated children through `lineage.rootThreadId`; `settledAt`, `archived_at` or `deleted_at` settles it. Re-read ownership right before removing.

1. **Tool caches,** when nothing uses them:

   ```bash
   rm -rf ~/.cache/{ms-playwright,node-gyp,puppeteer,google-chrome-for-testing-headless} ~/.npm/_npx
   ```

2. **Claude Code versions.** Remove every `~/.local/share/claude/versions/<version>` except the one `claude --version` reports.
3. **T3 runtime versions.** Skip while `~/.t3/runtime/service-state.json` shows an uncommitted update. Remove every `~/.t3/runtime/versions/<version>` except `activeVersion`, the launcher named in `~/.config/systemd/user/t3code.service`'s `ExecStart`, and newer ones.
4. **Docker,** when no `docker build` or Compose build runs: `docker image prune -a -f`, `docker builder prune -a -f`. Never `docker system prune`.
5. **pnpm,** when no install runs: `pnpm store prune`.
6. **Previews.** Remove each stopped `preview-*` unit and its container whose worktree is gone; run an Alchemy preview's `preview:destroy` first.
7. **Worktrees** of settled threads that no process uses, uncommitted changes included: the settle script, then `git worktree remove --force --force <path>` and `git worktree prune`.
8. **Local branches** in `~/deslop` and `~/dual` that no worktree checks out, except the default branch: `git branch -D`.
9. **Remote branches,** only when the PR or MR is merged or closed, every commit is authored by the user, and no thread's worktree uses it. A failed host query keeps the branch.

   ```bash
   git fetch -q --prune origin
   for b in $(git for-each-ref --format='%(refname:lstrip=3)' refs/remotes/origin | grep -vx 'HEAD\|main'); do
     if git remote get-url origin | grep -q github.com; then s=$(gh pr list --head "$b" --state all --json state -q '.[0].state')
     else s=$(glab mr list --source-branch "$b" --all -F json | jq -r '.[0].state'); fi
     case "$s" in MERGED|CLOSED|merged|closed) ;; *) continue ;; esac
     [ -z "$(git log --format=%ae "origin/main..origin/$b" | grep -vx "$(git config user.email)")" ] || continue
     git worktree list --porcelain | grep -qx "branch refs/heads/$b" || git push -q origin --delete "$b"
   done
   ```

10. **Mac.** Keep only active Claude, Node and Vite+ versions; remove caches:

    ```bash
    find ~/Library/Caches -maxdepth 1 -type d \( -iname '*updater*' -o -name '*.ShipIt' -o -name 'com.apple.Safari*' -o -name 'com.t3tools.t3code*' \) -exec rm -r -- {} +
    rm -rf ~/Library/Caches/Google/Chrome ~/.cache/codex-runtimes "$HOME/Library/Application Support"/t3code*/{Cache,"Code Cache"}
    ```

## Check

Every pass:

- **Disk.** `df -h` and `df -i` per disk mount; `du -xhd1` under the home, `/var/lib` and `/tmp`; `sudo lsof -l +L1 -nP` for deleted-but-open files.
- **Ports.** `ss -ltnp`: name each listener's unit or container. A container published on `0.0.0.0` other than Minecraft's 25565 is a fault.
- **Units.** `systemctl --failed` and `systemctl --user --failed` empty.
- **Agents.** `find ~/.claude/settings.json ~/.claude/agents/pair.md ~/.claude/skills ~/.codex/config.toml ~/.codex/instructions.md ~/.codex/rules/deny.rules ~/.codex/skills/* -maxdepth 0 ! -type l` prints only `~/.codex/skills/.system`; `find -L ~/.claude/skills ~/.codex/skills -maxdepth 1 -type l` prints nothing; `~/deslop` is clean on current `main`.
- **T3.** `t3 --version` equals `activeVersion`; `t3 doctor --base-dir ~/.t3 --dry-run` prints "Nothing to repair"; `t3 connect status` ends "✓ Other devices can reach this machine".
- **sshd.** `sudo sshd -T` shows `usepam yes`, `passwordauthentication no`, `permitrootlogin no`.
- **VPN.** `git -C ~/dual ls-remote -q origin HEAD` succeeds; otherwise show the user the URL `openvpn3 session-start --config datapizza` prints.
- **GPU.** desktop, after kernel or driver updates: `nvidia-smi` lists the RTX 5070 and `sudo modinfo -F version nvidia` matches it.

Report faults, unknown owners and denied steps; never call a machine pristine.

## Setup and repair

### Debian worker

From netinst; passwordless sudo in `/etc/sudoers.d/99-mp281x-nopasswd` (0440).

1. Install `sudo`, `network-manager`, `ufw`; `printf 'D /tmp 1777 root root 7d\n' | sudo tee /etc/tmpfiles.d/tmp.conf && sudo systemctl mask tmp.mount`.
2. Docker, `gh`, `glab`, `unattended-upgrades`, ripgrep, jq, sqlite3, btop; `mp281x` in `docker`; `/etc/docker/daemon.json`: `{"live-restore": true, "ip": "127.0.0.1", "default-network-opts": {"bridge": {"com.docker.network.bridge.host_binding_ipv4": "127.0.0.1"}}}`. desktop: `/etc/apt/apt.conf.d/99force-ipv4` holds `Acquire::ForceIPv4 "true";`.
3. Git: `rebase.updateRefs`, `rebase.autoSquash`, `rebase.autoStash`, `push.autoSetupRemote`, `fetch.prune`, `rerere.enabled` true; `diff.algorithm histogram`, `merge.conflictStyle zdiff3`, `init.defaultBranch main`.
4. Tailscale, then over the tailnet `ufw default deny incoming`; dev allows TCP 80, 443, 25565 and UDP 443. dev: `openvpn3 config-import --config <datapizza.ovpn> --name datapizza --persistent`.

   ```bash
   curl -fsSL https://pkgs.tailscale.com/stable/debian/trixie.noarmor.gpg | sudo tee /usr/share/keyrings/tailscale-archive-keyring.gpg >/dev/null
   curl -fsSL https://pkgs.tailscale.com/stable/debian/trixie.tailscale-keyring.list | sudo tee /etc/apt/sources.list.d/tailscale.list
   sudo apt-get update && sudo apt-get install -y tailscale
   openvpn3 configs-list 2>/dev/null | grep -q datapizza && R=$(getent ahostsv4 git.datapizza.tech | awk 'NR == 1 {print $1}')/32
   sudo tailscale up --accept-routes --advertise-routes=$R
   sudo tailscale set --operator=mp281x
   ```

5. `loginctl enable-linger mp281x`; Vite+ with `VP_HOME="$HOME/.vite-plus"`, Claude Code; `~/.bashrc`'s first lines put `$HOME/.local/bin:$HOME/.vite-plus/bin` on `PATH`. `~/.config/pnpm/config.yaml`: `minimumReleaseAgeExclude: ["@deslop/*"]`.
6. `vp install -g t3@nightly`, `t3 service install`, `t3 connect link --headless`, `t3 connect publish`, `t3 browser setup`, `sudo hostnamectl set-hostname --pretty <name>`.
7. Show the user each sign-in link: `gh auth login`, `glab auth login --hostname git.datapizza.tech`, `claude auth login`, `codex login --device-auth`; `gh auth setup-git`, `gh extension install github/gh-stack`; clone both repositories; `t3 project add --title <name> <path>`.
8. After a key login from another machine, `/etc/ssh/sshd_config.d/10-keys-only.conf`: `UsePAM yes`, `PasswordAuthentication no`, `KbdInteractiveAuthentication no`, `PermitRootLogin no`, `X11Forwarding no`; then `sudo sshd -t && sudo systemctl reload ssh`.

### Agent configuration links

Also after a harness replaced a link with a file. `~/.codex/skills` stays a real folder for Codex's `.system`.

```bash
r=~/deslop
mkdir -p ~/.claude/agents ~/.codex/rules ~/.codex/skills
ln -sfn $r/.claude/settings.json ~/.claude/settings.json
ln -sfn $r/.claude/agents/pair.md ~/.claude/agents/pair.md
ln -sfn $r/.claude/skills ~/.claude/skills
find ~/.codex/skills -maxdepth 1 -type l -delete
ln -sfn ~/.claude/skills/* ~/.codex/skills/
ln -sfn $r/.codex/global-config.toml ~/.codex/config.toml
ln -sfn $r/.codex/instructions.md ~/.codex/instructions.md
ln -sfn $r/.codex/rules/deny.rules ~/.codex/rules/deny.rules
codex execpolicy check --rules ~/.codex/rules/deny.rules true
```

### T3 settings

Copy after a change, with `target=mp281x@<other worker>`.

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

Keep each project's `scripts` (`t3_project_update`) equal to `projectSettingsOverrides.<id>.defaultProjectScripts`; never edit `projectScriptOverrides`.

### Desktop GPU

Secure Boot stays on; MOK enrollment needs the user at the console.

```bash
curl -fsSLo /tmp/cuda-keyring.deb https://developer.download.nvidia.com/compute/cuda/repos/debian13/x86_64/cuda-keyring_1.1-1_all.deb
sudo dpkg -i /tmp/cuda-keyring.deb && sudo apt-get update
sudo apt-get install -y --no-install-recommends linux-headers-amd64 "linux-headers-$(uname -r)" nvidia-driver-cuda nvidia-kernel-open-dkms
sudo mokutil --import /var/lib/dkms/mok.pub  # password via request_secret, file delivery, twice on stdin
```

### Mac

`curl -fsSL https://vite.plus | bash`; `~/.zshenv` exports `PATH="$HOME/.local/bin:$HOME/.vite-plus/bin:$PATH"` and `DEVELOPER_DIR=/Applications/Xcode.app/Contents/Developer`. Xcode: `open "macappstore://apps.apple.com/app/id497799835"`.

### MCP sign-in

```bash
sudo apt-get install -y gnome-keyring libsecret-tools
mkdir -p ~/.config/systemd/user ~/.local/share/dbus-1/services
printf '%s\n' '[Unit]' 'Description=Secret Service for headless CLI sign-ins' '[Service]' \
  "ExecStart=/bin/sh -c 'printf headless | exec /usr/bin/gnome-keyring-daemon --foreground --replace --unlock --components=secrets'" \
  'Restart=on-failure' '[Install]' 'WantedBy=default.target' > ~/.config/systemd/user/secret-service.service
printf '%s\n' '[D-BUS Service]' 'Name=org.freedesktop.secrets' 'Exec=/bin/false' 'SystemdService=secret-service.service' \
  > ~/.local/share/dbus-1/services/org.freedesktop.secrets.service
busctl --user call org.freedesktop.DBus / org.freedesktop.DBus ReloadConfig
systemctl --user daemon-reload && systemctl --user enable --now secret-service.service
claude mcp add --transport http --scope user gateway https://gateway.mp281x.xyz/mcp
claude mcp login --no-browser gateway  # or codex; approve at https://auth.mp281x.xyz
```

### Git identity

```bash
mkdir -p ~/.config/git
printf '[user]\n\tname = MP281X\n\temail = dev@mp281x.xyz\n' > ~/.config/git/github.gitconfig
printf '[user]\n\tname = Matteo Paludgnach\n\temail = matteopaludgnach@datapizza.tech\n' > ~/.config/git/datapizza.gitconfig
for u in 'https://github.com/**' 'git@github.com:**' 'ssh://git@github.com/**'; do git config --global "includeIf.hasconfig:remote.*.url:$u.path" ~/.config/git/github.gitconfig; done
for u in 'https://git.datapizza.tech/**' 'git@git.datapizza.tech:**' 'ssh://git@git.datapizza.tech/**'; do git config --global "includeIf.hasconfig:remote.*.url:$u.path" ~/.config/git/datapizza.gitconfig; done
```
