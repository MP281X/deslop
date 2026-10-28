# Maintenance

Setup, upkeep and rebuild of the machines.

## Machines

`dev` and `desktop` run the latest Debian stable in text mode with the same setup, as `mp281x` with passwordless sudo (`/etc/sudoers.d/99-mp281x-nopasswd`, mode 0440). Setup never copies sign-ins or machine configuration between machines; only the [T3 settings](#t3-settings) are shared.

| Fact     | `dev`                                                     | `desktop`                                              |
| -------- | --------------------------------------------------------- | ------------------------------------------------------ |
| Hardware | VPS, 8 cores, 23 GB, 15 GB swap                           | Ryzen 9 9900X, 30 GB, 31 GB swap, 1 TB NVMe            |
| Network  | Always on, public `77.237.236.132`; ufw allows 80 and 443 | On demand, home LAN on `eno1`; ufw denies all incoming |
| GitLab   | Through the VPN; advertises the route to the tailnet      | Through dev's route (`--accept-routes`)                |

- **Toolchain.** Docker with Compose and Buildx, `gh` with `github/gh-stack`, `glab`, git, build tools, rsync, ripgrep, jq, sqlite3, lsof, ffmpeg, ImageMagick, `dig`, `psql`. Vite+ in `~/.vite-plus` holds Codex and `t3@nightly`; Claude Code is in `~/.local/bin`. The first lines of `~/.bashrc`, above its interactive guard, put `$HOME/.local/bin:$HOME/.vite-plus/bin` on `PATH`.
- **Sign-ins.** Each worker signs in on its own: `gh auth login`, `glab auth login --hostname git.datapizza.tech`, `claude auth login`, `codex login --device-auth`, and [MCP](#mcp-sign-in). Show each sign-in link to the user.
- **Repositories.** `~/dual` uses the credential helper `!glab auth git-credential` for `https://git.datapizza.tech`; GitHub uses `gh auth setup-git`. Identities follow [Git identity](#git-identity).
- **Updates.** `unattended-upgrades` runs daily. `desktop` has only local IPv6, so `/etc/apt/apt.conf.d/99force-ipv4` holds `Acquire::ForceIPv4 "true";`.
- **Git defaults:** `rebase.updateRefs`, `rebase.autoSquash`, `rebase.autoStash`, `push.autoSetupRemote`, `fetch.prune`, `rerere.enabled`, `diff.algorithm histogram`, `merge.conflictStyle zdiff3`, `init.defaultBranch main`.
- **Firewall.** Tailscale's `ts-input` chain accepts tailnet traffic before ufw. On dev, `/etc/sysctl.d/90-quiet-console.conf` keeps `[UFW BLOCK]` off the console. Docker publishes Traefik's ports, UDP 443 for HTTP/3 included, past ufw.
- **TCP on dev.** `/etc/sysctl.d/90-tcp.conf` sets `fq`, `bbr` and `tcp_slow_start_after_idle = 0`, so phones on lossy links and idle keep-alive or WebSocket connections send at full speed.
- **Access.** Every machine holds the user's one ED25519 pair as `~/.ssh/id_ed25519`; `authorized_keys` holds only its public key; no `~/.ssh/config`. `known_hosts` comes from `ssh-keyscan -H dev desktop macbook-pro`. Disable a login method only after the remaining one worked from another machine. T3 shows `PRETTY_HOSTNAME`: `sudo hostnamectl set-hostname --pretty <name>`, then restart T3.

## Agent configuration

Every worker runs the same configuration from the deslop repository. `.codex/global-config.toml` has that name so the CLI does not load it a second time as deslop's project config. A variable only agents need goes in `.claude/settings.json` `env` and `.codex/global-config.toml` `shell_environment_policy.set`, never in `~/.bashrc`.

Each installed path is a symlink into the main checkout `~/deslop`, so a worker runs the configuration on `origin/main`: Claude's `SessionStart` hook fast-forwards `~/deslop` in the background (`git pull --ff-only`), so the session after a merge loads it. Never edit an installed path, and never switch `~/deslop` off `main`: both change every thread's configuration. Running threads keep the configuration they started with.

| Installed path                      | Links to `~/deslop/…`       |
| ----------------------------------- | --------------------------- |
| `~/.claude/settings.json`           | `.claude/settings.json`     |
| `~/.claude/agents/pair.md`          | `.claude/agents/pair.md`    |
| `~/.claude/skills/<personal skill>` | `.claude/skills/<name>`     |
| `~/.codex/config.toml`              | `.codex/global-config.toml` |
| `~/.codex/instructions.md`          | `.codex/instructions.md`    |
| `~/.codex/rules/deny.rules`         | `.codex/rules/deny.rules`   |
| `~/.codex/skills/<personal skill>`  | `~/.claude/skills/<name>`   |

Set up once per worker, and again after a harness replaced a link with a file:

```bash
r=~/deslop
mkdir -p ~/.claude/agents ~/.claude/skills ~/.codex/rules ~/.codex/skills
ln -sfn $r/.claude/settings.json ~/.claude/settings.json
ln -sfn $r/.claude/agents/pair.md ~/.claude/agents/pair.md
for s in planning environment references retrospective; do ln -sfn $r/.claude/skills/$s ~/.claude/skills/$s; ln -sfn ~/.claude/skills/$s ~/.codex/skills/$s; done
ln -sfn $r/.codex/global-config.toml ~/.codex/config.toml
ln -sfn $r/.codex/instructions.md ~/.codex/instructions.md
ln -sfn $r/.codex/rules/deny.rules ~/.codex/rules/deny.rules
codex execpolicy check --rules ~/.codex/rules/deny.rules true
```

**Skill renames.** Stage new discovery links on both workers before merging, targeting the future path in `~/deslop`, never a review worktree; leave the active old links untouched. The new links become readable when main fast-forwards. After that, retire only old links owned by this setup; preserve unrelated skills and real directories.

**Check** with `find ~/.claude/settings.json ~/.claude/agents/pair.md ~/.codex/config.toml ~/.codex/instructions.md ~/.codex/rules/deny.rules ~/.claude/skills/* ~/.codex/skills/* -maxdepth 0 ! -type l` (prints a link a harness replaced) and `git -C ~/deslop status --short` (a harness that wrote through a link; carry the write into a PR, then `git -C ~/deslop restore` it, because a dirty checkout stops the automatic pull).

## T3 history

Each worker stores only its own threads. For counts across many threads, `sqlite3 -readonly ~/.t3/userdata/statev2.sqlite` on each worker, the other through `ssh mp281x@<worker>`, selecting only needed fields; current records are in `orchestration_v2_projection_*` (`_threads`, `_messages`, `_turn_items`, `_runs`, `_subagents`). Native transcripts with every tool call: `~/.claude/projects/*/*.jsonl`, `~/.codex/sessions/**`.

## T3 settings

All workers share T3 settings. After the user changes one on a worker, run this there with `target=mp281x@<other worker>`; it maps project keys by workspace root and keeps the target's `environmentIcon`. T3 reloads the file.

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

- **Claude launch arguments.** `providerInstances.claudeAgent.config.launchArgs` is `--system-prompt-snapshot off --thinking-display omitted --autocompact 500k`. T3 passes them to new Claude processes; never restart T3 or stop threads to apply them.
- **Project scripts** live only in `projectSettingsOverrides.<project id>.defaultProjectScripts`; the legacy `projectScriptOverrides` and a checked-in `t3.json` stay unset, so the scripts stay the user's own. `install` runs on worktree creation and holds the agent until it exits (`async: false`); the script flagged `runOnSettle` runs on settle; the user runs `preview` and `stop` from the script menu. Deslop's port comes from the worktree path, Dual's from its `Preview ready:` line.

```bash
# deslop
install: vp install --frozen-lockfile                                      # async: false
preview: u=preview-${PWD##*/} p=$((20000 + 0x$(printf %s "$PWD" | sha256sum | cut -c1-4) % 10000)); systemctl --user stop $u 2>/dev/null; systemd-run --user -G -d -u $u -E PATH="$HOME/.vite-plus/bin:$PATH" -E HOST=127.0.0.1 -E PORT=$p vp run --filter @deslop/portfolio preview && until curl -fso /dev/null http://127.0.0.1:$p; do systemctl --user is-active -q $u || exit 1; sleep 2; done && sudo tailscale serve --bg --https=$p http://127.0.0.1:$p >/dev/null && echo https://$(hostname -s).tailnet-8c4c.ts.net:$p
stop: systemctl --user stop preview-${PWD##*/}; sudo tailscale serve --https=$((20000 + 0x$(printf %s "$PWD" | sha256sum | cut -c1-4) % 10000)) off 2>/dev/null || true   # runOnSettle

# dual
install: vp install --frozen-lockfile                                      # async: false
preview: u=preview-${PWD##*/} h=$(hostname -s).tailnet-8c4c.ts.net; systemctl --user stop $u 2>/dev/null; systemd-run --user -G -d -u $u -p KillSignal=SIGINT -E PATH="$HOME/.vite-plus/bin:$PATH" -E DUAL_PREVIEW_HOST=$h bun run preview && until p=$(journalctl --user _SYSTEMD_INVOCATION_ID=$(systemctl --user show -p InvocationID --value $u) -o cat | grep -oPm1 'Preview ready: \S+:\K[0-9]+'); do systemctl --user is-active -q $u || exit 1; sleep 5; done && sudo tailscale serve --bg --https=$p http://127.0.0.1:$p >/dev/null && echo https://$h:$p && echo 'Login: admin@dual.local / preview-password'
stop: u=preview-${PWD##*/}; p=$(journalctl --user -u $u -o cat | grep -oP 'Preview ready: \S+:\K[0-9]+' | tail -1); systemctl --user stop $u; [ -z "$p" ] || sudo tailscale serve --https=$p off 2>/dev/null || true
settle: u=preview-${PWD##*/}; p=$(journalctl --user -u $u -o cat | grep -oP 'Preview ready: \S+:\K[0-9]+' | tail -1); systemctl --user stop $u; [ -z "$p" ] || sudo tailscale serve --https=$p off 2>/dev/null || true; [ ! -d infra/saas/.alchemy ] || bun run preview:destroy   # runOnSettle
```

## Upkeep

"Maintenance" runs Update, Clean and Check on dev, desktop (when on) and the Mac, without asking; the reply shows each machine's disk before and after, what Clean removed, failures, and what still needs the user.

## Update

1. **Packages.** `sudo apt-get update && sudo apt-get upgrade -y && sudo apt-get autoremove -y && sudo apt-get clean`, `vp upgrade`, `gh extension upgrade --all` (`gh-stack` lags per worker). glab: when `curl -fsSL https://gitlab.com/api/v4/projects/gitlab-org%2Fcli/releases/permalink/latest` names a newer `tag_name`, install `https://gitlab.com/gitlab-org/cli/-/releases/<tag>/downloads/glab_<version>_linux_amd64.deb` with `dpkg -i`.
2. **T3** runs the nightly channel as the `t3code.service` user unit: with no run active, `t3 update --yes`; with runs active, leave the downloaded version for the user's update. A new worker first runs `vp install -g t3@nightly`, `t3 service install`, `t3 connect link --headless` (show the user the link) and `t3 connect publish`.
3. **Mac.** The agent steps under [Mac](#mac); a pending macOS update is the user's, with its label from `softwareupdate -l`.

## Clean

Remove rebuildable data and settled work; keep what a working or unsettled thread uses. Find a worktree's owners through `orchestration_v2_projection_threads.payload_json` (`worktreePath`, `settledAt`) with `archived_at` and `deleted_at`, judging delegated children by their root thread; a process whose `/proc/<pid>/cwd` is inside it also owns it. Stopped containers of unknown owners, unattached volumes and the production `deslop` project stay.

1. **Orphans.** Compose projects whose `com.docker.compose.project.working_dir` is gone, processes with a deleted working directory, Serve mappings whose backend no longer answers (`tailscale serve status --json`, then `sudo tailscale serve --https=<port> off`), `preview-*` units of removed worktrees, a `~/.deslop/<name>` whose worktree is gone and that is neither `deploy` nor a `tools/compose.yaml` service's data directory or env file.
2. **Settled worktrees.** Every worktree whose root threads are all settled, archived or deleted goes, uncommitted changes included: run its settle script, remove a remaining Compose project, then `git worktree remove --force --force <path>` and `git worktree prune`. A worktree no thread owns goes when its branch's PR merged; otherwise list it.
3. **Branches.** In `~/deslop` and `~/dual`, delete local branches no worktree uses whose PR merged; list branches without an open or merged PR.

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

4. **Caches.** With no build running: `docker image prune -a -f`, `docker builder prune -a -f` (the build cache reaches tens of GB). With no install running: `vp pm cache clean` in both repositories, `bun pm cache rm`, `npm cache clean --force`, `journalctl --vacuum-size=100M`. Never a blanket Docker system or volume prune.
5. **Versions.** Keep only the current `~/.vite-plus/<version>` (`readlink ~/.vite-plus/current`), the Node runtimes under `~/.vite-plus/js_runtime/node` that a running process uses plus the newest patch of each major, and the Claude Code version `claude --version` reports under `~/.local/share/claude/versions`.
6. **T3 releases.** Skip while `~/.t3/runtime/service-state.json` shows an uncommitted update. Delete every `~/.t3/runtime/versions/<version>` except `service-state.json`'s `activeVersion`, the version `ExecStart` names in `~/.config/systemd/user/t3code.service`, and a newer downloaded one.
7. **Scratch.** Top-level `/tmp` entries of this user older than a day, except `claude-*`, `codex*`, `/tmp/repos` and the `/tmp/<name>` paths that unsettled threads' turn items mention (`rg -o '/tmp/[A-Za-z0-9._-]+'` over their `payload_json`).

## Check

Fix what fails, then rerun the check:

- `systemctl --failed` and `systemctl --user --failed` are empty.
- Agent configuration per its **Check**, plus no dangling link under `~/.claude/skills` and `~/.codex/skills` except those staged for an unmerged rename; `~/deslop` is clean on `main` and current with `origin/main`.
- The project scripts match on both workers (`jq '.projectSettingsOverrides'`, mapped by workspace root); otherwise copy per [T3 settings](#t3-settings).
- `git config --global --get-regexp '^(rebase|push|fetch|rerere|diff|merge|init)\.'` lists the git defaults.

## Set up a worker

Start from a Debian netinst image with only the SSH server task.

1. Install `sudo`, `network-manager`, `ufw`. Put `/tmp` on disk: `printf 'D /tmp 1777 root root 7d\n' | sudo tee /etc/tmpfiles.d/tmp.conf && sudo systemctl mask tmp.mount`. Purge any desktop stack with `--autoremove`; keep `multi-user.target`.
2. Write the sudoers file; add the Docker and GitHub CLI apt sources with keys in `/etc/apt/keyrings/<name>.gpg`; install the toolchain, `glab` and `unattended-upgrades`; set the git defaults; add `mp281x` to `docker`; write `/etc/docker/daemon.json` as `{"live-restore": true, "ip": "127.0.0.1", "default-network-opts": {"bridge": {"com.docker.network.bridge.host_binding_ipv4": "127.0.0.1"}}}`.
3. Install the user's key pair. Run the Tailscale block below. After a second SSH login over the tailnet works: `ufw default deny incoming`, allow 80 and 443 only on dev, enable ufw.
4. Dev only: install `openvpn3-client`, `openvpn3 config-import --config <datapizza.ovpn> --name datapizza --persistent`, connect, advertise its route.
5. `loginctl enable-linger mp281x`. As `mp281x`: Vite+ with `VP_HOME="$HOME/.vite-plus"`, the global packages, Claude Code, the `PATH` line in `~/.bashrc`; check `ssh <worker> 'command -v vp claude codex'`. Write `~/.config/pnpm/config.yaml` with `minimumReleaseAgeExclude: ["@deslop/*"]`. Run the T3 step, `t3 browser setup`, set `PRETTY_HOSTNAME`.
6. GitHub, GitLab, Claude and Codex sign-ins, `gh extension install github/gh-stack`, Git identity, clone both repositories and `t3 project add --title <name> <path>`. On dev, deploy.
7. Install the agent configuration, copy the T3 settings from another worker, then MCP sign-in.
8. After a key login from another machine works, write `/etc/ssh/sshd_config.d/10-keys-only.conf` with `PasswordAuthentication no`, `KbdInteractiveAuthentication no`, `PermitRootLogin no`, `X11Forwarding no`, then `sudo sshd -t && sudo systemctl reload ssh`.

```bash
command -v tailscale >/dev/null || {
  curl -fsSL https://pkgs.tailscale.com/stable/debian/trixie.noarmor.gpg | sudo tee /usr/share/keyrings/tailscale-archive-keyring.gpg >/dev/null
  curl -fsSL https://pkgs.tailscale.com/stable/debian/trixie.tailscale-keyring.list | sudo tee /etc/apt/sources.list.d/tailscale.list
  sudo apt-get update && sudo apt-get install -y tailscale
}
openvpn3 configs-list 2>/dev/null | grep -q datapizza && R=$(getent ahostsv4 git.datapizza.tech | awk 'NR == 1 {print $1}')/32
sudo tailscale up --accept-routes --advertise-routes=$R
```

Show the user the `tailscale up` sign-in URL; the user disables key expiry and approves an advertised route at https://login.tailscale.com/admin/machines.

## Mac

T3's desktop app and the iOS Simulator; it builds nothing, the simulator app comes from CI. The user's organization manages it through MDM; keep its policies. System sleep is off, so it stays reachable with the display off; a closed lid makes it unreachable: when `ssh matteopaludgnach@macbook-pro true` fails, ask the user to wake it. Sudo needs the user's password, so the user installs apps, updates and permissions from a guide. Agents run `vp upgrade`, `softwareupdate -l` and `xcrun simctl delete unavailable`, and install nothing else.

**Device host.**

1. `curl -fsSL https://vite.plus | bash`; `~/.zshenv` holds `export PATH="$HOME/.local/bin:$HOME/.vite-plus/bin:$PATH"` and `export DEVELOPER_DIR=/Applications/Xcode.app/Contents/Developer`.
2. `open "macappstore://apps.apple.com/app/id497799835"`; guide: Get, open Xcode once, accept the license, download the iOS platform.
3. Over SSH: `xcrun simctl list runtimes` lists iOS and `node --version` is 22.12 or newer.
4. Guide: T3 Settings, Integrations, Devices, the worker's environment, turn on Device hub and Agent device access, add `matteopaludgnach@macbook-pro`, test. Copy the settings to the other worker.

## MCP sign-in

Codex reads `dual`, `scope`, `stash`, `auth` and `mobbin` from the installed configuration and keeps OAuth sign-ins in the Secret Service keyring. Claude keeps locally registered MCP servers in `~/.claude.json`; register the following on each worker once the installed `.claude/settings.json` allows them. Mobbin uses the shared Claude connector instead.

```bash
sudo apt-get install -y gnome-keyring libsecret-tools
mkdir -p ~/.config/systemd/user
printf '%s\n' '[Unit]' 'Description=Secret Service for headless CLI sign-ins' '[Service]' \
  "ExecStart=/bin/sh -c 'printf headless | exec /usr/bin/gnome-keyring-daemon --foreground --replace --unlock --components=secrets'" \
  'Restart=on-failure' '[Install]' 'WantedBy=default.target' > ~/.config/systemd/user/secret-service.service
systemctl --user daemon-reload && systemctl --user enable --now secret-service.service
claude mcp add --transport http --scope user dual https://app.dualos.ai/mcp
claude mcp add --transport http --scope user scope https://scope.mp281x.xyz/mcp
claude mcp add --transport http --scope user stash https://stash.mp281x.xyz/mcp
claude mcp add --transport http --scope user auth https://auth.mp281x.xyz/mcp
```

**Scope, Stash and Auth.** Run the native login on its worker and open its printed authorization URL in that worker's T3 preview. Leave that page waiting: it shows a QR code and a code, which the user scans with a phone where they are signed in or enters at https://auth.mp281x.xyz. The waiting page then completes the local callback. Repeat separately for each client and worker, replacing `scope` with `stash` and `auth`.

```bash
codex mcp login --no-browser scope
claude mcp login --no-browser scope
```

Keep the waiting page on the worker running the CLI: `127.0.0.1` in another machine's browser is not its callback. If the CLI has timed out or the request expired, start a new login; never approve a request the thread did not start. The client name is self-reported, not a verified worker identity.

**Dual and other external issuers.** In each worker's T3 terminal run the lines below one at a time, open each printed URL and approve access; the browser then fails to load `http://127.0.0.1:…/callback?…`, so copy that full address from the address bar and paste it into the terminal. The callback carries a one-use authorization code, not a reusable API token; no port forwarding is required.

```bash
codex mcp login --no-browser dual
claude mcp login --no-browser dual
```

**Mobbin in Claude.** Connect the [verified connector](https://claude.ai/directory/connectors/mobbin) to the paid Mobbin account and sign each worker in with `claude auth login` on that Claude account; API-key and `claude setup-token` sessions do not import it. A local `mobbin` entry shadows the connector: `claude mcp remove mobbin --scope user`.

The installed settings must not set `disableClaudeAiConnectors: true` in any scope. Once any `serverUrl` entry exists, every remote server needs a URL rule, including T3's `http://127.0.0.1:<port>/mcp`. `claude mcp list` shows `claude.ai Mobbin: ✔ Connected` when the connector loaded.

**Mobbin in Codex.** Authorize `https://api.mobbin.com/mcp` separately on each worker with `codex mcp login --no-browser mobbin` and the callback procedure above; Claude's connector authorization does not transfer to Codex.

`features.mcp_2026_07_28` (why in `.codex/global-config.toml`) is global: verify discovery for Dual, Scope and Stash when changing it. Check each worker's Mobbin sign-in with `codex mcp list`: `OAuth` means credentials are stored, `Not logged in` requires that worker's own authorization. Verify a real tool call separately.

Verify Mobbin with one `search_screens` call with `mode: "standard"`; the default, `deep`, spends AI credits.

## Git identity

Git picks the identity from the remote; repositories carry no `user.*`.

```bash
mkdir -p ~/.config/git
printf '[user]\n\tname = MP281X\n\temail = dev@mp281x.xyz\n' > ~/.config/git/github.gitconfig
printf '[user]\n\tname = Matteo Paludgnach\n\temail = matteopaludgnach@datapizza.tech\n' > ~/.config/git/datapizza.gitconfig
for u in 'https://github.com/**' 'git@github.com:**' 'ssh://git@github.com/**'; do git config --global "includeIf.hasconfig:remote.*.url:$u.path" ~/.config/git/github.gitconfig; done
for u in 'https://git.datapizza.tech/**' 'git@git.datapizza.tech:**' 'ssh://git@git.datapizza.tech/**'; do git config --global "includeIf.hasconfig:remote.*.url:$u.path" ~/.config/git/datapizza.gitconfig; done
```
