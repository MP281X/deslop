# Maintenance

Setup, upkeep and rebuild of the machines. Do established upkeep without asking; report failures and what Clean removed.

## Machines

`dev` and `desktop` run the latest Debian stable in text mode with the same setup, as `mp281x` with passwordless sudo (`/etc/sudoers.d/99-mp281x-nopasswd`, mode 0440). Setup never copies sign-ins or machine configuration between machines; only the [T3 settings](#t3-settings) are shared.

| Fact     | `dev`                                                     | `desktop`                                              |
| -------- | --------------------------------------------------------- | ------------------------------------------------------ |
| Hardware | VPS, 8 cores, 23 GB, 15 GB swap                           | Ryzen 9 9900X, 30 GB, 31 GB swap, 1 TB NVMe            |
| Network  | Always on, public `77.237.236.132`; ufw allows 80 and 443 | On demand, home LAN on `eno1`; ufw denies all incoming |
| GitLab   | Through the VPN; advertises the route to the tailnet      | Through dev's route (`--accept-routes`)                |

- **Toolchain.** Docker with Compose and Buildx, `gh` with `github/gh-stack`, `glab`, git, build tools, rsync, ripgrep, jq, sqlite3, lsof, ffmpeg, ImageMagick, `dig`, `psql`. Vite+ in `~/.vite-plus` holds Codex, `@opencode/cli@latest` (OpenCode v2) and `t3@nightly`; Claude Code is in `~/.local/bin`. The first lines of `~/.bashrc`, above its interactive guard, put `$HOME/.local/bin:$HOME/.vite-plus/bin` on `PATH`.
- **Sign-ins.** Each worker signs in on its own: `gh auth login`, `glab auth login --hostname git.datapizza.tech`, `claude auth login`, `codex login --device-auth`, and [MCP](#mcp-sign-in). Show each sign-in link to the user.
- **Repositories.** `~/dual` uses the credential helper `!glab auth git-credential` for `https://git.datapizza.tech`; GitHub uses `gh auth setup-git`. Identities follow [Git identity](#git-identity).
- **Updates.** `unattended-upgrades` runs daily. `desktop` has only local IPv6, so `/etc/apt/apt.conf.d/99force-ipv4` holds `Acquire::ForceIPv4 "true";`.
- **Git defaults:** `rebase.updateRefs`, `rebase.autoSquash`, `rebase.autoStash`, `push.autoSetupRemote`, `fetch.prune`, `rerere.enabled`, `diff.algorithm histogram`, `merge.conflictStyle zdiff3`, `init.defaultBranch main`.
- **Firewall.** Tailscale's `ts-input` chain accepts tailnet traffic before ufw. On dev, `/etc/sysctl.d/90-quiet-console.conf` keeps `[UFW BLOCK]` off the console.
- **Access.** Every machine holds the user's one ED25519 pair as `~/.ssh/id_ed25519`; `authorized_keys` holds only its public key; no `~/.ssh/config`. `known_hosts` comes from `ssh-keyscan -H dev desktop macbook-pro`. Disable a login method only after the remaining one worked from another machine. T3 shows `PRETTY_HOSTNAME`: `sudo hostnamectl set-hostname --pretty <name>`, then restart T3.

## Agent configuration

Every worker runs the same configuration from the deslop repository. `.codex/global-config.toml` and `.opencode/global-config.json` have those names so neither CLI loads them a second time as deslop's project config. The personal skills, orchestrator, environment, patterns and retrospective, are global; lint-companion, delivery and review belong to coding-standards and install into each repository. A variable only agents need goes in `.claude/settings.json` `env`, `.codex/global-config.toml` `shell_environment_policy.set` and T3's OpenCode provider environment, never in `~/.bashrc`.

Each installed path is a symlink into the main checkout `~/deslop`, so a worker runs the configuration on `origin/main`: Claude's `SessionStart` hook fast-forwards `~/deslop` in the background (`git pull --ff-only`), so the session after a merge loads it. T3's own automatic pull does not cover this: it pulls a checkout only while something refreshes that checkout's Git status. Never edit an installed path, and never switch `~/deslop` off `main`: both change every thread's configuration. Running threads keep the configuration they started with.

| Installed path                               | Links to `~/deslop/…`          |
| -------------------------------------------- | ------------------------------ |
| `~/.claude/settings.json`                    | `.claude/settings.json`        |
| `~/.claude/agents/pair.md`                   | `.claude/agents/pair.md`       |
| `~/.claude/skills/<personal skill>`          | `.claude/skills/<name>`        |
| `~/.codex/config.toml`                       | `.codex/global-config.toml`    |
| `~/.codex/instructions.md`                   | `.codex/instructions.md`       |
| `~/.codex/rules/deny.rules`                  | `.codex/rules/deny.rules`      |
| `~/.codex/skills/<personal skill>`           | `~/.claude/skills/<name>`      |
| `~/.config/opencode/opencode.json`           | `.opencode/global-config.json` |
| `~/.config/opencode/agents/build.md`         | `.opencode/agents/build.md`    |
| `~/.config/opencode/skills/<personal skill>` | `.claude/skills/<name>`        |

Set up once per worker, and again after a harness replaced a link with a file:

```bash
r=~/deslop
mkdir -p ~/.claude/agents ~/.claude/skills ~/.codex/rules ~/.codex/skills ~/.config/opencode/agents ~/.config/opencode/skills
ln -sfn $r/.claude/settings.json ~/.claude/settings.json
ln -sfn $r/.claude/agents/pair.md ~/.claude/agents/pair.md
for s in orchestrator environment patterns retrospective; do ln -sfn $r/.claude/skills/$s ~/.claude/skills/$s; ln -sfn ~/.claude/skills/$s ~/.codex/skills/$s; ln -sfn $r/.claude/skills/$s ~/.config/opencode/skills/$s; done
ln -sfn $r/.codex/global-config.toml ~/.codex/config.toml
ln -sfn $r/.codex/instructions.md ~/.codex/instructions.md
ln -sfn $r/.codex/rules/deny.rules ~/.codex/rules/deny.rules
ln -sfn $r/.opencode/global-config.json ~/.config/opencode/opencode.json
ln -sfn $r/.opencode/agents/build.md ~/.config/opencode/agents/build.md
codex execpolicy check --rules ~/.codex/rules/deny.rules true
```

**Skill renames.** Stage new discovery links on both workers before merging, targeting the future path in `~/deslop`, never a review worktree; leave the active old links untouched. The new links become readable when main fast-forwards. After that, retire only old links owned by this setup; preserve unrelated skills and real directories. No compatibility skill or startup hook is needed.

**Check** with `find ~/.claude/settings.json ~/.claude/agents/pair.md ~/.codex/config.toml ~/.codex/instructions.md ~/.codex/rules/deny.rules ~/.config/opencode/opencode.json ~/.config/opencode/agents/build.md ~/.claude/skills/* ~/.codex/skills/* ~/.config/opencode/skills/* -maxdepth 0 ! -type l` (prints a link a harness replaced) and `git -C ~/deslop status --short` (a harness that wrote through a link; carry the write into a PR, then `git -C ~/deslop restore` it, because a dirty checkout stops the automatic pull).

**OpenCode v2.** Install with `vp install -g @opencode/cli@latest`, not `opencode-ai` (v1). T3 selects `build`, so its Markdown agent replaces the base system prompt; project instructions, skills and T3's session instructions still load. The disabled built-in plugins remove native subagents, questions, session-management and worktree tools without removing Code Mode or MCP. T3 owns delegation and worktrees. Shell restrictions use `policies`, because T3's full-access session rules override ordinary agent permissions. The `plan` agent is disabled; use T3's default interaction mode.

Sign in separately on each worker with `opencode auth login`; select OpenCode and follow its browser authorization. Verify with `opencode auth list` and `opencode models`. The [Console](https://opencode.ai/console) manages Go subscriptions and Zen/Console credits; do not buy either on the user's behalf or copy credentials between workers. If a provider requires an API key, enter it in the CLI's private prompt, never chat. MCP sign-ins use `opencode mcp auth <name>` for the servers in the configuration; they do not reuse Codex or Claude credentials.

## T3 history

Search with `t3_thread_search` first. Each worker stores only its own threads: query both, the other through `ssh mp281x@<worker>`. Use `sqlite3 -readonly ~/.t3/userdata/statev2.sqlite`, selecting only needed fields; current records are in `orchestration_v2_projection_*` (`_threads`, `_messages`, `_turn_items`, `_runs`, `_subagents`). Native transcripts with every tool call: `~/.claude/projects/*/*.jsonl`, `~/.codex/sessions/**`.

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
  | .projectScriptOverrides |= ((. // {}) | remap)
  | .projectSettingsOverrides |= ((. // {}) | remap)
  | .projectSettingsFolded |= ((. // {}) | if type == "object" then remap else . end)
' ~/.t3/userdata/settings.json) && ssh "$target" 'cat > ~/.t3/userdata/settings.json' <<<"$new"
```

- **Claude launch arguments.** `providerInstances.claudeAgent.config.launchArgs` is `--system-prompt-snapshot off --thinking-display omitted --autocompact 500k`. T3 passes them to new Claude processes; never restart T3 or stop threads to apply them.
- **Project scripts** live in `projectSettingsOverrides.<project id>.defaultProjectScripts` and replace the project's own scripts. `install` runs on worktree creation and `settle` on settle; agents run `preview` per environment's Previews, and the user can run `preview` and `stop` from the script menu. Each preview is the unit `preview-<worktree name>`; deslop's port comes from the worktree path, Dual's from its `Preview ready:` line.

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

## Update

1. **Update.** `sudo apt-get update && sudo apt-get upgrade -y && sudo apt-get autoremove -y && sudo apt-get clean`, `vp upgrade`, `gh extension upgrade --all`. glab: when `curl -fsSL https://gitlab.com/api/v4/projects/gitlab-org%2Fcli/releases/permalink/latest` names a newer `tag_name`, install its `glab_<version>_linux_amd64.deb`.
2. **T3** runs the nightly channel as the `t3code.service` user unit: `vp install -g t3@nightly`, `t3 service install`, `t3 connect link --headless` (show the user the link), `t3 connect publish`, then `t3 service restart` with no run active.

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

1. `curl -fsSL https://vite.plus | bash`; `~/.zshenv` holds `export PATH="$HOME/.vite-plus/bin:$PATH"` and `export DEVELOPER_DIR=/Applications/Xcode.app/Contents/Developer`.
2. `open "macappstore://apps.apple.com/app/id497799835"`; guide: Get, open Xcode once, accept the license, download the iOS platform.
3. Over SSH: `xcrun simctl list runtimes` lists iOS and `node --version` is 22.12 or newer; boot the iPhone Air simulator once with `xcrun simctl boot <udid>`.
4. Guide: T3 Settings, Integrations, Devices, the worker's environment, turn on Device hub and Agent device access, add `matteopaludgnach@macbook-pro`, test. Copy the settings to the other worker.

## MCP sign-in

Codex reads `dual`, `scope`, `stash` and `mobbin` from the installed configuration and keeps OAuth sign-ins in the Secret Service keyring. Claude keeps locally registered MCP servers in `~/.claude.json`; register the following on each worker once the installed `.claude/settings.json` allows them. Mobbin uses the shared Claude connector instead.

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

After the public-auth release, remove each old Claude registration with `claude mcp remove --scope user <name>` before adding its public URL above. Codex URLs update with the installed configuration. Do this on each worker; never copy OAuth credentials between machines.

**Scope and Stash.** Run the native login on its worker and open its printed authorization URL in that worker's T3 preview. Leave that page waiting; the user signs in at https://auth.mp281x.xyz in their own browser, matches the displayed request ID against the thread, and approves the pending request. The inbox updates live. The original worker page completes the local callback without the user signing in there or copying codes. Repeat separately for each client and worker, replacing `scope` with `stash` and `auth`. Once `auth` is logged in, the agent approves later logins itself with its `answer_request`.

```bash
codex mcp login --no-browser scope
claude mcp login --no-browser scope
opencode mcp auth scope
```

Keep the waiting page on the worker running the CLI: `127.0.0.1` in another machine's browser is not its callback. If the CLI has timed out or the request expired, start a new login; never approve a request the thread did not start. The client name is self-reported, not a verified worker identity.

**Dual and other external issuers.** In each worker's T3 terminal run the lines below one at a time, open each printed URL and approve access; the browser then fails to load `http://127.0.0.1:…/callback?…`, so copy that full address from the address bar and paste it into the terminal. The callback carries a one-use authorization code, not a reusable API token; no port forwarding is required. External issuers do not use the Deslop approval inbox.

```bash
codex mcp login --no-browser dual
claude mcp login --no-browser dual
```

**Mobbin in Claude.** Connect the [verified connector](https://claude.ai/directory/connectors/mobbin) to the paid Mobbin account, then use `claude auth login` on each worker with that same Claude account. Subscription-authenticated Claude Code and T3 Claude sessions fetch the connector automatically; no separate Mobbin CLI OAuth or local server is needed. If a local `mobbin` entry already exists, remove it with `claude mcp remove mobbin --scope user`: a local server at the same URL shadows the shared connector. API-key and `claude setup-token` sessions do not import it. [Recommended Mobbin setup](https://docs.mobbin.com/mcp/clients/claude-code-cli), [Claude connector authentication](https://code.claude.com/docs/en/mcp#use-mcp-servers-from-claudeai).

The installed settings must not set `disableClaudeAiConnectors: true` in any scope; a project-level `false` cannot override it. The URL allowlist admits Mobbin and the existing services, not unrelated cloud connectors. Once any `serverUrl` entry exists, every remote server needs a URL rule, including T3's HTTP endpoint at `http://127.0.0.1:<port>/mcp`; name rules no longer admit remote servers. Skill and plugin synchronization stay disabled. After merging configuration changes, start a new session. Check `/mcp` for `claude.ai Mobbin` with status `connected`; `claude mcp list` alone does not prove a shared connector loaded. [Allowlist matching](https://code.claude.com/docs/en/managed-mcp#match-servers-by-url-command-or-name).

**Mobbin in Codex.** Authorize `https://api.mobbin.com/mcp` separately on each worker with `codex mcp login --no-browser mobbin` and the callback procedure above; Claude's connector authorization does not transfer to Codex. Never copy credentials between workers. [Official setup](https://docs.mobbin.com/mcp/introduction).

Keep `features.mcp_2026_07_28 = false`: in Codex 0.163.0, an authenticated Mobbin server exposed no tools with stateless MCP enabled; the same headless standard search succeeded with it disabled. This switch is global, not per-server; verify discovery for Dual, Scope and Stash when changing it. Check each worker's Mobbin sign-in with `codex mcp list`: `OAuth` means credentials are stored, `Not logged in` requires that worker's own authorization. Verify a real tool call separately.

Verify with a standard screen search for `iOS saved notes search filters` and a flow search for `workflow run failure details`. Inspect returned preview images and preserve the product names and Mobbin links; a connected server alone does not prove search or image access. Standard searches, `search_flows` and `search_sections` use no AI credits; only successful `search_screens` calls with `mode: "deep"` consume credits. [Tools and images](https://docs.mobbin.com/mcp/features), [credit rules](https://docs.mobbin.com/ai-credits).

If direct client registration or discovery returns a Vercel `HTTP 403` challenge, keep OAuth success separate from tool availability and report the failing step to [Mobbin support](https://help.mobbin.com/en/contact-us). For Claude, use the recommended shared connector rather than retrying direct registration.

## Git identity

Git picks the identity from the remote; repositories carry no `user.*`.

```bash
mkdir -p ~/.config/git
printf '[user]\n\tname = MP281X\n\temail = dev@mp281x.xyz\n' > ~/.config/git/github.gitconfig
printf '[user]\n\tname = Matteo Paludgnach\n\temail = matteopaludgnach@datapizza.tech\n' > ~/.config/git/datapizza.gitconfig
for u in 'https://github.com/**' 'git@github.com:**' 'ssh://git@github.com/**'; do git config --global "includeIf.hasconfig:remote.*.url:$u.path" ~/.config/git/github.gitconfig; done
for u in 'https://git.datapizza.tech/**' 'git@git.datapizza.tech:**' 'ssh://git@git.datapizza.tech/**'; do git config --global "includeIf.hasconfig:remote.*.url:$u.path" ~/.config/git/datapizza.gitconfig; done
```
