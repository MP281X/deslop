# Maintenance

Setup, upkeep and rebuild of the machines. Do established upkeep without asking; report failures and what Clean removed.

## Machines

`dev` and `desktop` run the latest Debian stable in text mode with the same setup, as `mp281x` with passwordless sudo (`/etc/sudoers.d/99-mp281x-nopasswd`, mode 0440). Setup never copies sign-ins or machine configuration between machines; only the [T3 settings](#t3-settings) are shared.

| Fact      | `dev`                                                                            | `desktop`                                              |
| --------- | -------------------------------------------------------------------------------- | ------------------------------------------------------ |
| Hardware  | VPS, 8 cores, 23 GB, 15 GB swap                                                  | Ryzen 9 9900X, 30 GB, 31 GB swap, 1 TB NVMe            |
| Network   | Always on, public `77.237.236.132`; ufw allows 80 and 443                        | On demand, home LAN on `eno1`; ufw denies all incoming |
| Only here | Traefik for `*.mp281x.xyz`, the Datapizza VPN, Jaeger, the Mullvad media proxies | Nothing                                                |
| GitLab    | Through the VPN; advertises the route to the tailnet                             | Through dev's route (`--accept-routes`)                |

- **Toolchain.** Docker with Compose and Buildx, `gh` with `github/gh-stack`, `glab`, `acli`, git, build tools, rsync, ripgrep, jq, sqlite3, lsof, ffmpeg, ImageMagick, `dig`, `psql`; on dev also `yt-dlp` in `/usr/local/bin`. Vite+ in `~/.vite-plus` holds Codex and `t3@nightly`; Claude Code is in `~/.local/bin`. The first lines of `~/.bashrc`, above its interactive guard, put `$HOME/.local/bin:$HOME/.vite-plus/bin` on `PATH`.
- **Sign-ins.** Each worker signs in on its own: `gh auth login`, `glab auth login --hostname git.datapizza.tech`, `claude auth login`, `codex login --device-auth`, and [Jira](#jira-sign-in). Show each sign-in link to the user.
- **Repositories.** `~/dual` uses the credential helper `!glab auth git-credential` for `https://git.datapizza.tech`; GitHub uses `gh auth setup-git`. Identities follow [Git identity](#git-identity).
- **Updates.** `unattended-upgrades` runs daily. `desktop` has only local IPv6, so `/etc/apt/apt.conf.d/99force-ipv4` holds `Acquire::ForceIPv4 "true";`.
- **Git defaults:** `rebase.updateRefs`, `rebase.autoSquash`, `rebase.autoStash`, `push.autoSetupRemote`, `fetch.prune`, `rerere.enabled`, `diff.algorithm histogram`, `merge.conflictStyle zdiff3`, `init.defaultBranch main`.
- **Media proxy.** On dev, `deslop-wireproxy@<relay>` user units run `~/.deslop/bin/wireproxy` (v1.1.3, `windtf/wireproxy`) per Mullvad relay with `~/.deslop/wireproxy/<relay>.conf` and a SOCKS5 port from 1080 up. `~/.deslop/mullvad/<relay>.conf` (0600, never print) holds the WireGuard file. To replace a blocked relay: take its key and address from `https://api.mullvad.net/www/relays/wireguard/`, write both files with the next port, `systemctl --user enable --now deslop-wireproxy@<relay>`, update `STASH_MEDIA_PROXY` in `~/.deslop/stash.env`.
- **Firewall.** Tailscale's `ts-input` chain accepts tailnet traffic before ufw. On dev, `/etc/sysctl.d/90-quiet-console.conf` keeps `[UFW BLOCK]` off the console.
- **Access.** Every machine holds the user's one ED25519 pair as `~/.ssh/id_ed25519`; `authorized_keys` holds only its public key; no `~/.ssh/config`. `known_hosts` comes from `ssh-keyscan -H dev desktop macbook-pro`. Disable a login method only after the remaining one worked from another machine. T3 shows `PRETTY_HOSTNAME`: `sudo hostnamectl set-hostname --pretty <name>`, then restart T3.

## Agent configuration

Every worker runs the same configuration from the deslop repository. Sources: `.claude/settings.json`, `.claude/agents/pair.md`, `.codex/config.toml`, `.codex/instructions.md`, `.codex/rules/deny.rules`, and the personal skills `.claude/skills/{orchestrator,delivery,explore,environment}`. Engineering, design and review belong to coding-standards and install into repositories; review also installs globally, so review children work in a checkout without installed skills. A variable only agents need goes in both `.claude/settings.json` `env` and `.codex/config.toml` `shell_environment_policy.set`, never in `~/.bashrc`.

Install from main or from a branch with an open PR, on every running worker; an unreachable worker that the user turned off gets it when it runs again. First `diff -r` each installed copy against the source: a difference that neither your branch nor `origin/main` made comes from another branch, so bring it in first.

```bash
set -e
for worker in dev desktop; do
  t=mp281x@$worker
  ssh -o ConnectTimeout=5 $t true || { echo "$worker is unreachable"; continue; }
  for s in orchestrator delivery explore environment; do rsync -a --delete --mkpath .claude/skills/$s/ $t:.claude/skills/$s/; done
  rsync -a --delete --delete-excluded --mkpath --exclude EVALS.md tools/coding-standards/skills/review/ $t:.claude/skills/review/
  rsync -a .claude/settings.json $t:.claude/settings.json
  rsync -a --mkpath .claude/agents/pair.md $t:.claude/agents/pair.md
  rsync -a --mkpath .codex/config.toml .codex/instructions.md $t:.codex/
  rsync -a --mkpath .codex/rules/deny.rules $t:.codex/rules/deny.rules
  ssh $t 'mkdir -p ~/.codex/skills && rm -rf ~/.codex/skills/review && for s in orchestrator delivery explore environment review; do ln -sfn ~/.claude/skills/$s ~/.codex/skills/$s; done; codex execpolicy check --rules ~/.codex/rules/deny.rules true >/dev/null'
done
```

New sessions load the change; running threads keep theirs. Verify with the same `diff -r`.

## T3 settings

All workers share T3 settings. After the user changes one on a worker, run this there with `target=mp281x@<other worker>`; it maps project keys by workspace root and keeps the target's `environmentIcon`. T3 reloads the file.

```bash
d=$(mktemp -d /tmp/t3-settings-XXXX)
q="SELECT project_id, workspace_root FROM projection_projects WHERE deleted_at IS NULL"
sqlite3 -readonly -json ~/.t3/userdata/statev2.sqlite "$q" > $d/src-projects.json
ssh "$target" "sqlite3 -readonly -json ~/.t3/userdata/statev2.sqlite '$q'" > $d/dst-projects.json
ssh "$target" 'cat ~/.t3/userdata/settings.json' > $d/dst-settings.json
jq --slurpfile src $d/src-projects.json --slurpfile dst $d/dst-projects.json --slurpfile old $d/dst-settings.json '
  ([$src[0][] | {key: .project_id, value: .workspace_root}] | from_entries) as $root
  | ([$dst[0][] | {key: .workspace_root, value: .project_id}] | from_entries) as $id
  | def remap: with_entries(select($id[$root[.key]] != null) | .key = $id[$root[.key]]);
  (. | del(.environmentIcon)) + ($old[0] | {environmentIcon} | with_entries(select(.value != null)))
  | .projectScriptOverrides |= ((. // {}) | remap)
  | .projectSettingsOverrides |= ((. // {}) | remap)
  | .projectSettingsFolded |= ((. // {}) | if type == "object" then remap else . end)
' ~/.t3/userdata/settings.json > $d/new-settings.json
ssh "$target" 'cat > ~/.t3/userdata/settings.json' < $d/new-settings.json
rm -rf $d
```

- **Claude launch arguments.** `providerInstances.claudeAgent.config.launchArgs` is `--system-prompt-snapshot off --thinking-display omitted --autocompact 500k`, with the custom pair prompt and `ENABLE_TOOL_SEARCH=false`. T3 passes them to new Claude processes; never restart T3 or stop threads to apply them.
- **Project scripts** live in `projectSettingsOverrides.<project id>.defaultProjectScripts` and replace the project's own scripts. `install` runs on worktree creation, `settle` on settle; the user runs `preview` and `stop` from the script menu. Each preview is the unit `preview-<worktree name>`; deslop's port comes from the worktree path, Dual's from its `Preview ready:` line.

```bash
# deslop
install: vp install --frozen-lockfile
preview: u=preview-${PWD##*/} p=$((20000 + 0x$(printf %s "$PWD" | sha256sum | cut -c1-4) % 10000)); systemctl --user stop $u 2>/dev/null; systemd-run --user -G -d -u $u -E PATH="$HOME/.vite-plus/bin:$PATH" -E HOST=127.0.0.1 -E PORT=$p vp run --filter @deslop/portfolio preview && sudo tailscale serve --bg --https=$p http://127.0.0.1:$p >/dev/null && echo https://$(hostname -s).tailnet-8c4c.ts.net:$p
stop: systemctl --user stop preview-${PWD##*/}; sudo tailscale serve --https=$((20000 + 0x$(printf %s "$PWD" | sha256sum | cut -c1-4) % 10000)) off 2>/dev/null || true
settle: systemctl --user stop preview-${PWD##*/}; sudo tailscale serve --https=$((20000 + 0x$(printf %s "$PWD" | sha256sum | cut -c1-4) % 10000)) off 2>/dev/null || true

# dual
install: vp install --frozen-lockfile && vpx @deslop/coding-standards@latest
preview: u=preview-${PWD##*/} h=$(hostname -s).tailnet-8c4c.ts.net; systemctl --user stop $u 2>/dev/null; systemd-run --user -G -d -u $u -p KillSignal=SIGINT -E PATH="$HOME/.vite-plus/bin:$PATH" -E DUAL_PREVIEW_HOST=$h bun run preview && until p=$(journalctl --user _SYSTEMD_INVOCATION_ID=$(systemctl --user show -p InvocationID --value $u) -o cat | grep -oPm1 'Preview ready: \S+:\K[0-9]+'); do systemctl --user is-active -q $u || exit 1; sleep 5; done && sudo tailscale serve --bg --https=$p http://127.0.0.1:$p >/dev/null && echo https://$h:$p
stop: u=preview-${PWD##*/}; p=$(journalctl --user -u $u -o cat | grep -oP 'Preview ready: \S+:\K[0-9]+' | tail -1); systemctl --user stop $u; [ -z "$p" ] || sudo tailscale serve --https=$p off 2>/dev/null || true
settle: u=preview-${PWD##*/}; p=$(journalctl --user -u $u -o cat | grep -oP 'Preview ready: \S+:\K[0-9]+' | tail -1); systemctl --user stop $u; [ -z "$p" ] || sudo tailscale serve --https=$p off 2>/dev/null || true; bun run preview:destroy
```

- **Review guides.** `reviewGuidesEnabled` is `true`, `reviewGuideModelSelection` is Codex `gpt-6.1-sol`, and `reviewGuideInstructions` holds exactly:

```text
The reader is a tired reviewer who wants to finish fast and must not miss a risk.
Open with the stop that can break something: a migration, a changed contract or schema, a permission change, removed behavior or a new dependency. Put the risk in its attention note.
Then follow what a user or caller sees change, then the interfaces, then the implementation.
Spend words only on choices a maintainer must agree with: a new abstraction, option, fallback, retry, special case, compatibility alias or comment. Name each one and what breaks without it.
Put generated files, lockfiles, formatting, renames and moves in one closing skim stop.
Use at most five stops of two short sentences each, in plain words. No praise, no restated diff, no test counts or pipeline results.
```

## Update and deploy

1. **Update.** `sudo apt-get update && sudo apt-get upgrade -y && sudo apt-get autoremove -y && sudo apt-get clean`, `vp upgrade`; on dev `sudo yt-dlp -U`. glab: when `curl -fsSL https://gitlab.com/api/v4/projects/gitlab-org%2Fcli/releases/permalink/latest` names a newer `tag_name`, install its `glab_<version>_linux_amd64.deb`.
2. **T3** runs the nightly channel as the `t3code.service` user unit: `vp install -g t3@nightly`, `t3 service install`, `t3 connect link --headless` (show the user the link), `t3 connect publish`, then `t3 service restart` with no run active.
3. **Deploy** on dev from `~/deslop` on published main: `docker compose --project-name deslop --file tools/compose.yaml pull`, then `up -d --remove-orphans`; a changed inline config needs `up -d --force-recreate --no-deps <service>`.
4. **Verify.** https://portfolio.mp281x.xyz and dev's http://127.0.0.1:16686/api/services return 200, and an OPTIONS preflight to otel's `/v1/traces` and `/v1/logs` with `Origin: https://portfolio.mp281x.xyz` succeeds.

## Clean

Remove rebuildable data, never unsettled work. A worktree is disposable only when every owning thread is settled, no run is queued and no process uses it. Find owners through `orchestration_v2_projection_threads.payload_json` (`worktreePath`, `settledAt`, `settledOverride`) and the latest `_runs` row. A missing path or owner starts an investigation, never a deletion. Unknown owners, stopped containers, unattached volumes and the production `deslop` project stay.

1. **Orphans.** Compose projects whose `com.docker.compose.project.working_dir` is gone, processes with a deleted working directory, Serve mappings without a backend, `~/.deslop/<worktree>` without a checkout (keep `~/.deslop/deploy`): remove when every owner is settled.
2. **Settled worktrees.** Run the settle script from the worktree, remove a remaining Compose project, then `git worktree remove --force --force <path>` only when clean; list dirty ones for the user.
3. **Branches.** In `~/deslop` and `~/dual`, delete local branches no worktree uses whose PR merged; list branches without an open or merged PR. Delete legacy `refs/t3/checkpoints/*`; keep `refs/t3/orchestration-v2/`.

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
   git for-each-ref --format='delete %(refname)' refs/t3/checkpoints | git update-ref --stdin
   ```

4. **Caches.** With no build running: `docker image prune -a -f`, `docker builder prune -a -f`. With no install running: `vp pm cache clean` in both repositories, identified caches under `~/.npm` and `~/.cache`, unused Vite+, Node, Codex and Claude Code versions, `journalctl --vacuum-size=100M`. Never a blanket Docker system or volume prune. Keep `claude-*` and `codex*` folders in `/tmp`.
5. **T3 releases.** Skip while `~/.t3/runtime/service-state.json` shows an uncommitted update. After a self-update, install the CLI at the active version (`vp install -g t3@<version>`); with no run active run `t3 service install`, otherwise point `ExecStart` in `~/.config/systemd/user/t3code.service` at it and `systemctl --user daemon-reload`. Delete unused versions.
6. **Report** `df -h /` before and after, what each step removed, and the ten largest folders (`du -xh --max-depth=2 ~ /tmp /var/lib/docker | sort -h | tail`).

## Set up a worker

Start from a Debian netinst image with only the SSH server task.

1. Install `sudo`, `network-manager`, `ufw`. Put `/tmp` on disk: `printf 'D /tmp 1777 root root 7d\n' | sudo tee /etc/tmpfiles.d/tmp.conf && sudo systemctl mask tmp.mount`. Purge any desktop stack with `--autoremove`; keep `multi-user.target`.
2. Write the sudoers file; add the Docker, GitHub CLI and `acli` apt sources with keys in `/etc/apt/keyrings/<name>.gpg`; install the toolchain, `glab` and `unattended-upgrades`; set the git defaults; add `mp281x` to `docker`; write `/etc/docker/daemon.json` as `{"live-restore": true, "ip": "127.0.0.1", "default-network-opts": {"bridge": {"com.docker.network.bridge.host_binding_ipv4": "127.0.0.1"}}}`.
3. Install the user's key pair. Run the Tailscale block below. After a second SSH login over the tailnet works: `ufw default deny incoming`, allow 80 and 443 only on dev, enable ufw.
4. Dev only: install `openvpn3-client`, `openvpn3 config-import --config <datapizza.ovpn> --name datapizza --persistent`, connect, advertise its route.
5. `loginctl enable-linger mp281x`. As `mp281x`: Vite+ with `VP_HOME="$HOME/.vite-plus"`, the global packages, Claude Code, the `PATH` line in `~/.bashrc`; check `ssh <worker> 'command -v vp claude codex'`. Write `~/.config/pnpm/config.yaml` with `minimumReleaseAgeExclude: ["@deslop/*"]`. Run the T3 step, `t3 browser setup`, set `PRETTY_HOSTNAME`.
6. Sign-ins, Jira sign-in, `gh extension install github/gh-stack`, Git identity, clone both repositories and `t3 project add --title <name> <path>`. On dev, deploy.
7. Install the agent configuration and copy the T3 settings from another worker.
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

T3's desktop app and the iOS Simulator; it builds nothing, the simulator app comes from CI. The user's organization manages it through MDM; keep its policies. System sleep is off, so it stays reachable with the display off; a closed lid makes it unreachable: when `ssh matteopaludgnach@macbook-pro true` fails, ask under **Needs you** to wake it. Sudo needs the user's password, so the user installs apps, updates and permissions from a guide. Agents run `vp upgrade`, `softwareupdate -l` and `xcrun simctl delete unavailable`, and install nothing else.

**Device host.**

1. `curl -fsSL https://vite.plus | bash`; `~/.zshenv` holds `export PATH="$HOME/.vite-plus/bin:$PATH"` and `export DEVELOPER_DIR=/Applications/Xcode.app/Contents/Developer`.
2. `open "macappstore://apps.apple.com/app/id497799835"`; guide: Get, open Xcode once, accept the license, download the iOS platform.
3. Over SSH: `xcrun simctl list runtimes` lists iOS and `node --version` is 22.12 or newer; boot the iPhone Air simulator once with `xcrun simctl boot <udid>`.
4. Guide: T3 Settings, Integrations, Devices, the worker's environment, turn on Device hub and Agent device access, add `matteopaludgnach@macbook-pro`, test. Copy the settings to the other worker.

## Jira sign-in

```bash
curl -fsSL https://acli.atlassian.com/gpg/public-key.asc | sudo gpg --batch --yes --dearmor -o /etc/apt/keyrings/acli.gpg
echo "deb [arch=amd64 signed-by=/etc/apt/keyrings/acli.gpg] https://acli.atlassian.com/linux/deb stable main" | sudo tee /etc/apt/sources.list.d/acli.list
sudo apt-get update && sudo apt-get install -y acli gnome-keyring libsecret-tools
mkdir -p ~/.config/systemd/user
printf '%s\n' '[Unit]' 'Description=Secret Service for headless CLI sign-ins' '[Service]' \
  "ExecStart=/bin/sh -c 'printf headless | exec /usr/bin/gnome-keyring-daemon --foreground --replace --unlock --components=secrets'" \
  'Restart=on-failure' '[Install]' 'WantedBy=default.target' > ~/.config/systemd/user/secret-service.service
systemctl --user daemon-reload && systemctl --user enable --now secret-service.service
```

Guide: create a classic API token without scopes at https://id.atlassian.com/manage-profile/security/api-tokens with a one-year expiry, then in each worker's T3 terminal run the line below, paste the token and press Enter. When `acli jira auth status` fails, repeat with a new token.

```bash
read -rs t && echo "$t" | acli jira auth login --site datapizza.atlassian.net --email matteopaludgnach@datapizza.tech --token; unset t
```

## Git identity

Git picks the identity from the remote; repositories carry no `user.*`.

```bash
mkdir -p ~/.config/git
printf '[user]\n\tname = MP281X\n\temail = dev@mp281x.xyz\n' > ~/.config/git/github.gitconfig
printf '[user]\n\tname = Matteo Paludgnach\n\temail = matteopaludgnach@datapizza.tech\n' > ~/.config/git/datapizza.gitconfig
for u in 'https://github.com/**' 'git@github.com:**' 'ssh://git@github.com/**'; do git config --global "includeIf.hasconfig:remote.*.url:$u.path" ~/.config/git/github.gitconfig; done
for u in 'https://git.datapizza.tech/**' 'git@git.datapizza.tech:**' 'ssh://git@git.datapizza.tech/**'; do git config --global "includeIf.hasconfig:remote.*.url:$u.path" ~/.config/git/datapizza.gitconfig; done
```
