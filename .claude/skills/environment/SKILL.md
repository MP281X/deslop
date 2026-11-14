---
name: environment
description: Load before worker operations, previews, devices, tracing, deployment, publishing, sign-in, runtime errors, saved reading, design references, reading a reference or outside repository, or Dual.
---

# Environment

Two headless Debian workers in one tailnet, same user and paths.

| Name          | Address          | Role                                                                                |
| ------------- | ---------------- | ----------------------------------------------------------------------------------- |
| `desktop`     | `100.97.120.3`   | Fastest worker, for validation only; on only when the user turns it on              |
| `dev`         | `100.68.201.107` | Always on, where every thread starts: Deslop apps for `*.mp281x.xyz`, Datapizza VPN |
| `macbook-pro` | `100.115.207.60` | The user's control plane, the iOS Simulator and a Deploy worker, on demand          |
| `iphone`      | `100.117.217.10` | T3 client only                                                                      |

- **Names.** MagicDNS short names; `<name>.tailnet-8c4c.ts.net` has HTTPS certificates. SSH as `mp281x@dev`, `mp281x@desktop`, `matteopaludgnach@macbook-pro`.
- **Tools.** `vp` and `vpx` on `PATH`, also over SSH; systemd units need `~/.vite-plus/bin`. `gh`, `glab` and the MCP gateway signed in.
- **Scratch.** Use `/tmp/<task>/`, on disk, emptied at boot and of files unused for 7 days.
- **Git refs.** T3 checkpoints under `refs/t3/`; search history with `--branches --remotes`.
- **Auxiliary services.** Run task-local ones as temporary containers, not installs on the worker.

## Previews

- **One per worktree.** The systemd user unit `preview-<worktree name>`, shared over tailnet HTTPS. After edits, run the project's `preview` script from the worktree root: it replaces the previous run and prints the stable HTTPS URL. The repository's own preview command or a background task bypasses the unit and dies with the turn.
- **Command.** Read the saved one with `t3_project_read`. Deslop's selects a changed web app, else Portfolio; set `PREVIEW_APP=<app>` to preview another app of the same change. An invalid selection leaves the running preview untouched.
- **Fresh.** A turn that touched an app ends with its preview running the latest code; without a worktree preview, use the scratch run.
- **Share.** Only after the URL loads sign-in, assets and API calls.
- **Webhooks.** Funnel exposes a whole port: pick a free one of 443, 8443, 10000 and run `sudo tailscale funnel --bg --https=<port> --set-path <path> http://127.0.0.1:<api port><path>`; remove it with `... --set-path <path> off`.

## Tools

No data means report it and investigate further, not verification.

- **Runtime state.** Call Deploy's `list_apps` or `read_resource_history`, not `ps`, `docker ps`, `ss` or `systemctl`. Use the full worker name, such as `dev.mp281x.xyz`, not `dev`; check unit health with Check's `systemctl --failed`.
- **Missing tool.** Call `list_mcp_connections` before assuming it is absent.
- **Runtime error, trace or latency.** Call Scope's `list_operations`, then `search_traces`, then `read_trace` or `measure_latency`.

## Deslop

- **Production.** On dev each app is `deslop-<app>.service`, running `~/.deslop/<app>/current`, with its flags in the unit. Deploy's Caddy, `deslop-deploy-caddy.service`, serves its owned `*.mp281x.xyz` hostnames on 80 and 443 (`/etc/sysctl.d/90-unprivileged-ports.conf` lets a user bind them).
- **Desktop.** Runs only Deploy, at `https://desktop.tailnet-8c4c.ts.net:5102`, reached by dev's Deploy; the shared worker key follows Deploy's README.
- **MacBook.** Runs only Deploy, as the launch agent `deslop-deploy`, at `https://macbook-pro.tailnet-8c4c.ts.net:5102`, reached by dev's Deploy as `macbook-pro`; its `~/.deslop/deploy` holds a week of resource history and its owned tailnet exposures.
- **Stash.** No worktree preview: `deslop-stash.service` serves `https://stash.mp281x.xyz` and `~/.deslop/stash` is production data. The iPhone app and share sheet use that origin with shared Keychain credentials. A scratch run from a worktree keeps its own data in `.deslop/stash`: `vp -C apps/stash run build && node --env-file=$HOME/.deslop/stash.env apps/stash/dist/server.js --port 5018`.
- **Stash proxy.** `STASH_PROXY` is the DataImpulse residential plan "stash", with `__sessid.{session}` after the login.
- **npm.** `matteo_paludgnach` approves a first publish's URL.
- **Apple.** The App Store signing workflow sets up a new app and Release uploads, both with the App Store Connect API key in repository secrets `ASC_KEY_ID`, `ASC_ISSUER_ID` and `ASC_KEY_P8`; nothing signs in to Apple on a worker.
- **EAS.** Desktop's Expo session, an owner of `mp281x.xyz`, registers new projects; Release uses `EXPO_TOKEN`. Paid cloud builds need the user's approval.
- **Tracing.** Public `https://scope.mp281x.xyz`; tailnet `https://dev.tailnet-8c4c.ts.net:4318`, served by `sudo tailscale serve --bg --https=4318 http://127.0.0.1:5106` to Scope's port.

## Dual

`~/dual` is the code, its `CONTEXT.md` the domain terms and its README the local setup.

- **Production.** One instance; a deployment stops and starts it, with no rolling overlap.
- **Organizations.** One company each: B2B, no self sign-up. Names, ids and icons are visible to everyone in it. Access protects contents (prompts, steps, sub-workflow structure, Skill and Knowledge Base contents, Connection secrets); lists show only what you were given, and opening something without access says so.
- **Dependencies.** Sharing lends them only during a run: a Workflow's Connection works inside it, nowhere else, and never appears as yours.
- **Deploy sharing.** Grants Use: running it and seeing your own Runs.
- **Spaces.** Nesting is visual, never permission. Nobody requests access; someone invites you.
- **Migrations.** Model changes ship as one lossless database migration, with no runtime path for old data.
- **Accounts.** Writes go only to GitHub `MP281X`, GitLab `matteopaludgnach` and the user's Discord test channel. Saved preview tokens are read-only; write tokens come from `gh auth token` and the `glab` configuration.
- **Merge requests.** Squash-merged, stacks included; the source branch is deleted on merge.
- **Preview.** T3's `preview` script runs `bun run preview` and prints its URL; `settle` destroys its data. Funnel `/api/webhooks` to the preview port, which proxies `/api` to the API.
- **Google.** The same `execute` as Jira reads, never writes, the user's work calendar and mail, `matteopaludgnach@datapizza.tech` (`google-api.*`, calendar `primary`), in `Europe/Rome`. Its sandbox has no `Intl`: convert by the zone's offset.

**Jira.** Project `DOS`, board 1053, `datapizza.atlassian.net`; the user's account ID `712020:87e4f57e-6b5d-40ab-8dfa-faf159ead71a`; link `https://datapizza.atlassian.net/browse/<key>`.

- **Tools.** Dual's MCP `execute` (`dualos__execute` through the gateway), which finds its own tools (`atlassian-api.*`), never `acli`. Access is a service account: `currentUser()` and `@me` are not the user, so name the account ID. `To Do` is `status = "To Do"` (`statusCategory` also returns Backlog); `Doing` is transition `21`. A slow or confusing step is a Dual defect for the final reply.
- **Picking.** On "what to work on": rank only unassigned `To Do` Epics, Tasks, Stories and Bugs by priority (`P1` highest), size and fit with the code. After approval, assign each to the user and move it to `Doing`: the only Jira writes.
- **Assigned.** A ticket key in a request, branch or commit is work the user started: read it, quote the requirements used.

**VPN.** `git.datapizza.tech` works only through dev's VPN route. When it does not answer, reconnect on dev (`ssh mp281x@dev` from desktop), give the user the printed sign-in URL once, then check again:

```bash
curl -fsS --max-time 5 https://git.datapizza.tech/users/sign_in >/dev/null || {
  openvpn3 session-manage --config datapizza --disconnect
  openvpn3 session-start --config datapizza --background
  # right after the start it prints "No sessions requires authentication interaction"
  timeout 55 bash -c 'until openvpn3 session-auth | rg -o "https://\S+"; do sleep 1; done'
}
```

**Tracing.** Preview exports nothing: trace a development launch. The startup timestamp is fresh at every launch, so a restarted service hides its previous traces. A nonempty PostHog marker enables the exporter, which Scope ignores; production PostHog configuration stays. After `vp run build:runtime` at the root, from `packages/saas` with its development environment configured (same environment with `src/dev.ts worker` for the worker):

```bash
OTEL_RESOURCE_ATTRIBUTES="scope.runtime=server,scope.run.started_unix_nano=$(date +%s%N)" \
POSTHOG_PROJECT_TOKEN=scope-dev POSTHOG_OTLP_BASE_URL=https://dev.tailnet-8c4c.ts.net:4318 \
bun --env-file .env src/dev.ts api
```

## Reference repositories

Pick the one whose subject matches; read its source, never a summary of it. Clone to `/tmp/repos/<name>` (read-only, never edit, commit or push; emptied at boot): `git clone --depth 1 https://github.com/<owner>/<name> /tmp/repos/<name>`. Reuse one only when `git -C /tmp/repos/<name> remote get-url origin` names it, after `git -C /tmp/repos/<name> pull --ff-only`.

| Repository                                                                                                                                                    | Reference for                                       |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------- |
| [Effect-TS/effect](https://github.com/Effect-TS/effect)                                                                                                       | Effect APIs and atoms                               |
| [kitlangton/effect-solutions](https://github.com/kitlangton/effect-solutions)                                                                                 | Effect services                                     |
| [Effect-TS/skills](https://github.com/Effect-TS/skills)                                                                                                       | Agent knowledge of Effect                           |
| [pingdotgg/t3code](https://github.com/pingdotgg/t3code)                                                                                                       | Server and client contracts, RPC, MCP, Expo, web UX |
| [anomalyco/opencode](https://github.com/anomalyco/opencode)                                                                                                   | Architecture, agent loop, tools, permissions        |
| [UsefulSoftwareCo/executor](https://github.com/UsefulSoftwareCo/executor)                                                                                     | Plugin SDK, MCP hosts                               |
| [tim-smart/lalph](https://github.com/tim-smart/lalph)                                                                                                         | CLI, processes, cluster                             |
| [tim-smart/bunnings-lite](https://github.com/tim-smart/bunnings-lite)                                                                                         | App atoms                                           |
| [typeonce-dev/effect-machine](https://github.com/typeonce-dev/effect-machine)                                                                                 | State machines                                      |
| [shadcn-ui/ui](https://github.com/shadcn-ui/ui)                                                                                                               | Shipped components                                  |
| [google-labs-code/design.md](https://github.com/google-labs-code/design.md)                                                                                   | Design documents                                    |
| [Effect-TS/website](https://github.com/Effect-TS/website), [discord-bot](https://github.com/Effect-TS/discord-bot), [cafe](https://github.com/Effect-TS/cafe) | Whole Effect apps                                   |
| [mattpocock/skills](https://github.com/mattpocock/skills)                                                                                                     | Writing for agents                                  |
| [cursor/plugins](https://github.com/cursor/plugins)                                                                                                           | Skills that augment strong models                   |
| [anthropics/skills](https://github.com/anthropics/skills)                                                                                                     | Skill evaluation                                    |

## Maintenance

Maintenance returns each machine that is on (`dev`, `desktop`, the Mac) to a clean state without asking: Update, Clean, Check, then report what waits on the user's restart (a kernel or macOS update; never pending T3 updates). Reach the others with `ssh mp281x@desktop` and `ssh matteopaludgnach@macbook-pro`. Run a pass on Claude (Sonnet): Codex rejects `rm -f` and `rm -rf`.

**Never** run `t3 update`, `t3 doctor --fix`, `t3 service restart` or a reboot: the user does. Never delete:

- history, whatever its size or age: T3's databases and logs, `~/.claude/projects`, `~/.codex/sessions`, opencode's storage, every app's usage data;
- credentials and production data (`~/.deslop/<app>` of a `deslop-*` service, `~/.deslop/stash`);
- running jobs, and `deslop-*` user services with their `-update` oneshots, `t3code`, `minecraft`, `deploy-caddy`, a container stopped on purpose;
- the worktree of any unsettled thread, the default branch, a branch checked out in a kept worktree or with an OPEN pull or merge request.

Report unknown ownership separately from garbage.

### Update

1. **Packages.** `sudo apt-get update && sudo apt-get upgrade -y && sudo apt-get autoremove -y && sudo apt-get clean`, `vp upgrade`, `gh extension upgrade --all`. glab: when `curl -fsSL https://gitlab.com/api/v4/projects/gitlab-org%2Fcli/releases/permalink/latest` names a newer `tag_name`, download `https://gitlab.com/gitlab-org/cli/-/releases/<tag>/downloads/glab_<version>_linux_amd64.deb` to `/tmp/glab.deb` and `sudo dpkg -i` it. Mac: `vp upgrade`; a pending macOS update is the user's, labelled from `softwareupdate -l`.
2. **T3 CLI.** Global only: `vp install -g t3@nightly`.
3. **Configuration.** `git -C ~/deslop pull --ff-only` on every worker. A harness whitespace rewrite (Claude Code re-indents `settings.json`) blocks it: when `git -C ~/deslop diff -w` is empty, `git -C ~/deslop restore` and pull; a real change goes into a PR first.

### Clean

Remove what no kept thing needs, running or not; list only the unknown. Run each step on its own so one refusal does not stop the rest, and never `docker system prune`.

**Owners.** A thread owns its worktree: read `orchestration_v2_projection_threads.payload_json` (`worktreePath`, `settledAt`), `archived_at` and `deleted_at` from the local SQLite projection (not T3's first thread page); count delegated children by `lineage.rootThreadId`, inspect user side chats separately, and re-read ownership immediately before each removal. A process whose `/proc/<pid>/cwd` is inside a worktree also owns it.

1. **Worktrees of settled threads.** Those no unsettled thread owns and no process uses, uncommitted changes included. Run its settle script ("Unit … not loaded" for a stopped preview is harmless; an Alchemy preview needs `preview:destroy` first), then `git worktree remove --force --force <path>` and `git worktree prune`.
2. **Stopped previews.** `preview-*` units of removed worktrees, and a `~/.deslop/<name>` whose worktree is gone unless a `deslop-<name>` service uses it.
3. **Containers.** Remove each container serving no kept worktree or deliberate service, running ones included. Owners: a Compose container's `com.docker.compose.project.working_dir`; an Alchemy preview's `dual.preview` label (`wt-<id>`) and the worktree holding `infra/saas/.alchemy/preview/wt-<id>` in its bind mounts; an OpenSandbox `sandbox-*` container belongs to the `dualos-local-sandboxes-wt-<id>-*` network it joins.

   ```bash
   docker ps -a --format '{{.Names}}\t{{.Status}}\t{{.Label "com.docker.compose.project.working_dir"}}\t{{.Label "dual.preview"}}'
   docker rm -f <name> …
   docker network prune -f
   docker volume ls -q --filter dangling=true | xargs -r docker volume rm
   ```

   A container kept stopped gets `docker update --restart no <name>`.

4. **Docker images.** With no `docker build` or Compose build running: `docker image prune -a -f`, `docker builder prune -a -f`.
5. **Branches.** In `~/deslop` and `~/dual`, after the worktrees: delete local `t3/*` branches without a worktree, and remote `t3/*` branches only when their PR or MR is merged or closed and no thread uses them; a failed host query skips the branch.

   ```bash
   git fetch -q --prune origin
   keep=$(git worktree list --porcelain | awk '/^branch /{sub("refs/heads/","",$2); print $2}')
   default=$(git symbolic-ref --short refs/remotes/origin/HEAD | sed 's|origin/||')
   for b in $(git for-each-ref --format='%(refname:short)' refs/heads/t3); do
     [ "$b" = "$default" ] && continue
     echo "$keep" | grep -qx "$b" && continue
     if git remote get-url origin | grep -q github.com; then open=$(gh pr list --head "$b" --state open --json number -q length)
     else open=$(glab mr list --source-branch "$b" -F json | jq length); fi
     [ -n "$open" ] || continue
     [ "$open" -gt 0 ] || { git branch -D "$b" >/dev/null && echo "deleted $b"; }
   done
   ```

   A remote `t3/*` branch is deleted (`git push origin --delete <branch>`) only when the same query finds its PR or MR merged or closed and `t3_thread_list` shows no thread on it.

6. **Exposures.** Remove each Serve mapping and Deploy exposure whose backend no longer answers (any HTTP status shows a backend; only a refused or timed-out connection does not). Deploy: `list_apps` per worker; an entry with a `url` and a `failure`, or a port `ss -ltn` does not list, gets `remove_exposure`.

   ```bash
   tailscale serve status --json | jq -r '.Web // {} | to_entries[] | .key as $k | .value.Handlers[] | select(.Proxy) | "\($k) \(.Proxy)"' |
     while read -r host url; do curl -s -o /dev/null --max-time 3 "$url" || sudo tailscale serve --https=${host##*:} off; done
   ```

7. **Orphans.** Processes with a deleted working directory; stale scratch under `/tmp` no kept thread or process uses, never `/tmp/repos`.
8. **Caches.** No install running: `vp pm cache clean` in both repositories, `pnpm store prune`, `bun pm cache rm`, `npm cache clean --force`. No install or browser using them: `rm -rf ~/.cache/{ms-playwright,node-gyp,puppeteer,google-chrome-for-testing-headless} ~/.npm/_npx`. Remove other identified tool downloads under `~/.cache` too.
9. **Old versions.** Claude Code: all of `~/.local/share/claude/versions` except what `claude --version` reports. Vite+: keep `readlink ~/.vite-plus/current` and each Node major's newest patch under `~/.vite-plus/js_runtime/node`. Keep any executable in `/proc/*/exe`.
10. **T3 runtime.** Skip while `~/.t3/runtime/service-state.json` shows an uncommitted update. Delete each `~/.t3/runtime/versions/<version>` except `activeVersion`, the one the unit's `ExecStart` names (the launcher), and a newer download.
11. **Mac.** Caches, then versions (keep only the active Claude, Node and Vite+, and any still in use per `lsof -nP | grep -F '<old-version-path>'`):

    ```bash
    find ~/Library/Caches -maxdepth 1 -type d \( -iname '*updater*' -o -name '*.ShipIt' -o -name 'com.apple.Safari*' -o -name 'com.t3tools.t3code*' \) -exec rm -r -- {} +
    rm -rf ~/Library/Caches/Google/Chrome ~/.cache/codex-runtimes
    for app in t3code t3code-v2; do
      rm -rf "$HOME/Library/Application Support/$app/Cache" "$HOME/Library/Application Support/$app/Code Cache"
    done
    claude --version; node --version; readlink ~/.vite-plus/current
    rm -r -- ~/.local/share/claude/versions/<old-version> ~/.vite-plus/js_runtime/node/<old-version> ~/.vite-plus/<old-version>
    ```

12. **Simulators.** Delete every device no unsettled thread uses, on both workers, applying **Owners**. On the Mac a session name is `t3-` plus the first 24 hex characters of SHA-256 of JSON `[threadId, hostId, deviceId]` (no spaces); an unknown owner stays.

    ```bash
    xcrun simctl list devices --json
    find ~/.t3/device/hosts -path '*/requests/*.ndjson' -exec jq -r 'select(.phase == "resolve_target_device" and .data.udid) | [.session, .data.udid] | @tsv' {} + | sort -u
    xcrun simctl shutdown <UDID>  # only if booted
    xcrun simctl delete <UDID>
    xcrun simctl delete unavailable  # only when every unavailable device passed the ownership check
    ```

### Check

Every pass, before and after cleaning, measure disk use (`df -B1` on Debian, `df -k` on the Mac, `df -i`; `du -xhd1` under the home, `/var/lib`, `/var/cache`, `/var/log`, `/tmp`; containerd's snapshot store as well as `/var/lib/docker`) and listening ports (identify each listener and Serve handler's unit or container and backend). Compare `du`, `df` and `sudo lsof -l +L1 -nP` for deleted-but-open files (Chromium memfd and shared memory are not leaks; a deleted Deploy Caddy binary stays until unit restart or reboot: report it). Then:

- **Units.** `systemctl --failed` and `systemctl --user --failed` empty; `dpkg --audit`, held and upgradable packages after refreshing apt, boot kernel errors, running versus installed kernel and driver.
- **Tailscale.** Debian workers: `tailscale debug prefs` shows `"OperatorUser": "mp281x"`.
- **Agents.** [Agent configuration](#agent-configuration) **Check**; this prints nothing; `~/deslop` is clean on `main` and current with `origin/main`:

  ```bash
  find -L ~/.claude/skills ~/.codex/skills -maxdepth 1 -type l
  ```

- **Scripts.** All three project-script stores equal across both workers (`legacy` may differ from `overrides` only until T3's next settings write):

  ```bash
  dump='sqlite3 -readonly -json ~/.t3/userdata/statev2.sqlite "SELECT project_id, workspace_root FROM projection_projects WHERE deleted_at IS NULL" | jq -S --slurpfile s ~/.t3/userdata/settings.json '"'"'$s[0] as $s | map({(.workspace_root): {overrides: $s.projectSettingsOverrides[.project_id].defaultProjectScripts, legacy: $s.projectScriptOverrides[.project_id]}}) | add'"'"
  diff <(sh -c "$dump") <(ssh mp281x@<other worker> "$dump")
  ```

  Then `t3_project_read` per project: its `scripts` equals `overrides`; fix a difference per [T3 settings](#t3-settings).

- **Git.** `git config --global --get-regexp '^(rebase|push|fetch|rerere|diff|merge|init)\.'` lists the git defaults.
- **sshd.** `sudo sshd -T` shows `usepam yes`, `kbdinteractiveauthentication no`, `passwordauthentication no`, `permitrootlogin no`; `ssh -tt <worker> 'echo $XDG_RUNTIME_DIR; systemctl --user is-active t3code'` prints `/run/user/1000` and `active`. Fix in the file sshd reads first, then `sudo sshd -t && sudo systemctl reload ssh`; a password-only login still gets `Permission denied (publickey)`.
- **T3 CLI.** `t3 --version` equals `activeVersion`; otherwise `vp install -g t3@nightly`.
- **T3 doctor.** `t3 doctor --base-dir ~/.t3 --dry-run` prints "Nothing to repair"; otherwise report the repairs.
- **T3 Connect.** `t3 connect status` ends with "✓ Other devices can reach this machine". After an unlink (T3 app or `t3 connect unlink`; a reboot does not restore it): `t3 connect link --headless` (reuses a stored credential), then `t3 connect publish` (`--disable` turns it off); the service restart that follows is the user's. After a re-link, dev's resolvers and the home router (192.168.1.1; desktop's through MagicDNS) can cache NXDOMAIN for `prod-<id>.t3coderelay.com` for up to 30 minutes; `sudo resolvectl flush-caches` clears only the local cache. Test with `curl --resolve <host>:443:<ip from dig @1.1.1.1> https://<host>/`.
- **Datapizza VPN.** dev: `openvpn3 sessions-list` shows "Client connected"; both workers: `git -C ~/dual ls-remote -q origin HEAD` succeeds. Otherwise `openvpn3 session-start --config datapizza` prints a `https://vpn-gw.datapizza.tech/oauth2/start?...` web SSO URL: show it to the user (a dev reboot needs that sign-in).
- **Desktop.** The [GPU check](#desktop-gpu), also after kernel or driver updates.
- **Docker.** Each prints nothing, except Minecraft's published 25565:

  ```bash
  docker ps -q | xargs -r docker inspect --format '{{.Name}}{{range $p,$b := .NetworkSettings.Ports}}{{range $b}}{{if or (eq .HostIp "0.0.0.0") (eq .HostIp "::")}} {{.HostPort}}{{end}}{{end}}{{end}}' | awk 'NF>1'
  docker network ls --filter dangling=true --format '{{.Name}}'
  docker ps -aq --filter status=exited --filter status=created | xargs -r docker inspect --format '{{.Name}} {{.HostConfig.RestartPolicy.Name}}' | grep -v ' no$'
  docker volume ls -q --filter dangling=true
  ```

  A port published on every interface: remove the container or recreate it on `127.0.0.1`. Unused network: `docker network prune -f`. Stopped container with another policy: `docker update --restart no <name>`.

- **Exposures.** No Serve mapping or Deploy exposure without a backend. Each app's `/api/runtime` returns 200 with its version; opm, stash and trips return 404 at `/` by design, so check the unit is active plus a current run start in Scope `check_ingestion`.

Report faults, denied cleanup, unknown owners and waiting restarts; never call a machine pristine.

## Setup and repair

### Machines

`dev` and `desktop`: latest Debian stable, text mode, same setup, `mp281x` with passwordless sudo (`/etc/sudoers.d/99-mp281x-nopasswd`, mode 0440). Sign-ins and machine configuration are never copied between machines; only [T3 settings](#t3-settings) are.

| Fact     | `dev`                                                                                     | `desktop`                                                                      |
| -------- | ----------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------ |
| Hardware | VPS, 8 cores, 23 GB, 15 GB swap                                                           | Ryzen 9 9900X, 30 GB, 31 GB swap, 1 TB NVMe                                    |
| Network  | Always on, public `77.237.236.132`; ufw allows TCP 80, 443, 25565 (Minecraft) and UDP 443 | On demand, behind NAT: `eno1` has LAN `192.168.1.112`; ufw denies all incoming |
| GitLab   | Through the VPN, signed in again after each reboot; advertises the route to the tailnet   | Through dev's route (`--accept-routes`)                                        |
| sshd     | `/etc/ssh/sshd_config`, with drop-ins                                                     | Debian's                                                                       |
| GPU      | None                                                                                      | NVIDIA GeForce RTX 5070, 12 GB; [setup](#desktop-gpu)                          |

- **Toolchain.** Docker with Compose and Buildx, `gh` with `github/gh-stack`, `glab`, git, build tools, rsync, ripgrep, jq, sqlite3, lsof, btop (never htop), ffmpeg, ImageMagick, `dig`, `psql`. Vite+ in `~/.vite-plus` holds Codex and `t3@nightly`; Claude Code in `~/.local/bin`. `~/.bashrc`'s first lines, above its interactive guard, put `$HOME/.local/bin:$HOME/.vite-plus/bin` on `PATH`. `swapon`, `sshd` and `ufw` live in `/usr/sbin`: call them by path.
- **T3 versions.** `activeVersion` in `~/.t3/runtime/service-state.json` is the server child (`t3 serve`) that runs. `ExecStart` of `~/.config/systemd/user/t3code.service` names an older `__service-launcher` (0.1.3 on dev, 0.1.6 on desktop, against 0.1.9 active): both directories stay. The global `t3` in `~/.vite-plus` is separate; a stale one prints "unknown to this build" migration warnings.
- **Sign-ins.** Per worker, show the user each link: `gh auth login`, `glab auth login --hostname git.datapizza.tech`, `claude auth login`, `codex login --device-auth`, [MCP](#mcp-sign-in).
- **Repositories.** `~/dual`: credential helper `!glab auth git-credential` for `https://git.datapizza.tech`; GitHub: `gh auth setup-git`; [Git identity](#git-identity).
- **Updates.** `unattended-upgrades` daily. desktop has no public IPv4: `/etc/apt/apt.conf.d/99force-ipv4` holds `Acquire::ForceIPv4 "true";`.
- **Git defaults.** `rebase.updateRefs`, `rebase.autoSquash`, `rebase.autoStash`, `push.autoSetupRemote`, `fetch.prune`, `rerere.enabled`, `diff.algorithm histogram`, `merge.conflictStyle zdiff3`, `init.defaultBranch main`.
- **Firewall.** Tailscale's `ts-input` accepts tailnet traffic before ufw; dev's web ports serve Deploy's Caddy user service. `/etc/sysctl.d/90-quiet-console.conf` keeps `[UFW BLOCK]` off dev's console. `/etc/sysctl.d/90-tcp.conf` on dev: `fq`, `bbr`, `tcp_slow_start_after_idle = 0`.
- **Access.** One ED25519 pair as `~/.ssh/id_ed25519` everywhere; `authorized_keys` holds only its public key; no `~/.ssh/config`; `known_hosts` from `ssh-keyscan -H dev desktop macbook-pro`. Disable a login method only after the other worked from another machine.
- **sshd.** `UsePAM yes` supplies `XDG_RUNTIME_DIR` and `DBUS_SESSION_BUS_ADDRESS`, including non-interactive SSH; without it `systemctl --user` fails with "Failed to connect to user scope bus". dev's `sshd_config` includes `/etc/ssh/sshd_config.d/*.conf`; `10-keys-only.conf` disables password, keyboard-interactive and root login. Trust `sudo sshd -T`.

### Debian worker

From a Debian netinst image with only the SSH server task.

1. **Base.** Install `sudo`, `network-manager`, `ufw`. `/tmp` on disk: `printf 'D /tmp 1777 root root 7d\n' | sudo tee /etc/tmpfiles.d/tmp.conf && sudo systemctl mask tmp.mount`. Purge any desktop stack with `--autoremove`; keep `multi-user.target`.
2. **Tools.** Sudoers file; Docker and GitHub CLI apt sources with keys in `/etc/apt/keyrings/<name>.gpg`; the toolchain, `glab`, `unattended-upgrades`; git defaults; `mp281x` in `docker`; `/etc/docker/daemon.json` as `{"live-restore": true, "ip": "127.0.0.1", "default-network-opts": {"bridge": {"com.docker.network.bridge.host_binding_ipv4": "127.0.0.1"}}}`.
3. **Network.** The user's key pair, then the Tailscale block below. After a second SSH login over the tailnet: `ufw default deny incoming`, dev's ports from **Machines**, enable ufw.
4. **VPN.** dev only: `openvpn3-client`, `openvpn3 config-import --config <datapizza.ovpn> --name datapizza --persistent`, connect with the user's web SSO (Check's **Datapizza VPN**), advertise its route.
5. **Runtime.** `loginctl enable-linger mp281x`. As `mp281x`: Vite+ with `VP_HOME="$HOME/.vite-plus"`, the global packages, Claude Code, the `PATH` line; check `ssh <worker> 'command -v vp claude codex'`. `~/.config/pnpm/config.yaml`: `minimumReleaseAgeExclude: ["@deslop/*"]`.
6. **T3.** `vp install -g t3@nightly`, `t3 service install`, `t3 connect link --headless` (link to the user), `t3 connect publish`, `t3 browser setup`. Name it: `sudo hostnamectl set-hostname --pretty <name>`.
7. **Accounts.** GitHub, GitLab, Claude and Codex sign-ins, `gh extension install github/gh-stack`, Git identity, clone both repositories, `t3 project add --title <name> <path>`. dev: deploy.
8. **Agents.** [Agent configuration](#agent-configuration), [T3 settings](#t3-settings) from another worker, [MCP sign-in](#mcp-sign-in).
9. **SSH.** After a key login from another machine: `/etc/ssh/sshd_config.d/10-keys-only.conf` with `UsePAM yes`, `PasswordAuthentication no`, `KbdInteractiveAuthentication no`, `PermitRootLogin no`, `X11Forwarding no`. sshd keeps the first value it reads: `sshd_config` must start with `Include /etc/ssh/sshd_config.d/*.conf`. Then `sudo sshd -t && sudo systemctl reload ssh` and Check's **sshd**.
10. **GPU.** desktop only: [setup](#desktop-gpu).

```bash
command -v tailscale >/dev/null || {
  curl -fsSL https://pkgs.tailscale.com/stable/debian/trixie.noarmor.gpg | sudo tee /usr/share/keyrings/tailscale-archive-keyring.gpg >/dev/null
  curl -fsSL https://pkgs.tailscale.com/stable/debian/trixie.tailscale-keyring.list | sudo tee /etc/apt/sources.list.d/tailscale.list
  sudo apt-get update && sudo apt-get install -y tailscale
}
openvpn3 configs-list 2>/dev/null | grep -q datapizza && R=$(getent ahostsv4 git.datapizza.tech | awk 'NR == 1 {print $1}')/32
sudo tailscale up --accept-routes --advertise-routes=$R
sudo tailscale set --operator=mp281x # Deploy publishes tailnet exposures as this user.
```

Show the user the `tailscale up` URL; the user disables key expiry and approves an advertised route at https://login.tailscale.com/admin/machines.

### Agent configuration

Agent-only variables go in `.claude/settings.json` `env` and `.codex/global-config.toml` `shell_environment_policy.set`, never `~/.bashrc`. Links target `~/deslop` on `main`, never switched off it; running threads keep their configuration. Once per worker, and after a harness replaced a link with a file:

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

- **Skills.** `~/.claude/skills` is one folder link, so adding or deleting a skill needs nothing on the workers. `~/.codex/skills` stays a real folder (Codex writes `.system` there) with one link per skill, rebuilt by the block above. Skills from outside the repository are not installed.
- **New links.** Before merging, link both workers to the future path in `~/deslop`, never a review worktree.
- **Check.** `find ~/.claude/settings.json ~/.claude/agents/pair.md ~/.claude/skills ~/.codex/config.toml ~/.codex/instructions.md ~/.codex/rules/deny.rules ~/.codex/skills/* -maxdepth 0 ! -type l` prints only `~/.codex/skills/.system`; anything else is a replaced link to restore. `git -C ~/deslop status --short` shows a harness write through a link: carry it into a PR, then `git -C ~/deslop restore` it.

### T3 settings

After a settings change, run on that worker with `target=mp281x@<other worker>`; it maps project keys by workspace root and preserves the target's `environmentIcon`. T3 reloads the file.

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
- **Project scripts.** Three stores; only the first two are ours, and a checked-in `t3.json` stays unset:
  1. `projectSettingsOverrides.<id>.defaultProjectScripts` in `~/.t3/userdata/settings.json`: what T3 runs, and what the copy above syncs.
  2. The project record (`scripts` in `t3_project_read`, written by `t3_project_update`): keep it equal to the first.
  3. Top-level `projectScriptOverrides`: a legacy mirror T3 rewrites from the first store on its next settings write. Never edit it.

### Desktop GPU

RTX 5070 (Blackwell): NVIDIA's open kernel modules, not Nouveau or Debian 13's stock 550; headless compute packages, no desktop stack, no full CUDA toolkit ([NVIDIA's Debian guide](https://docs.nvidia.com/datacenter/tesla/driver-installation-guide/debian.html)).

```bash
curl -fsSLo /tmp/cuda-keyring_1.1-1_all.deb https://developer.download.nvidia.com/compute/cuda/repos/debian13/x86_64/cuda-keyring_1.1-1_all.deb
sudo dpkg -i /tmp/cuda-keyring_1.1-1_all.deb
sudo apt-get update
sudo apt-get install -y --no-install-recommends linux-headers-amd64 "linux-headers-$(uname -r)" nvidia-driver-cuda nvidia-kernel-open-dkms
```

- **Secure Boot.** Stays on. DKMS signs with `/var/lib/dkms/mok.key` and `/var/lib/dkms/mok.pub`; keep that pair across updates. `sudo mokutil --sb-state` and `sudo mokutil --test-key /var/lib/dkms/mok.pub`; skip enrollment if enrolled. [MOK enrollment](https://wiki.debian.org/SecureBoot) needs physical confirmation before Linux boots, never over SSH; desktop has no monitor or keyboard, so arrange one or a remote KVM and the restart with the user first.
  1. **Password.** One-time password through `request_secret` with file delivery, fed twice on stdin to `sudo mokutil --import /var/lib/dkms/mok.pub`; confirm with `sudo mokutil --list-new`.
  2. **Boot.** Power off, not reboot, to connect a monitor. At "Press any key to perform MOK management", press a key promptly, choose **Enroll MOK**, **Continue**, **Yes**, enter the password, **Reboot**.
  3. **Missed.** Check `--list-new`, requeue if empty; `sudo mokutil --revoke-import` and requeue before a deferred boot.
- **Check.** `nvidia-smi` lists the RTX 5070; `lspci -nnk -d 10de:` shows `Kernel driver in use: nvidia`; `sudo dkms status` has the module for `uname -r`; the MOK test says enrolled; `systemctl --failed` empty; `sudo journalctl -k -b` free of NVIDIA init failures and Xid errors. An install or DKMS build alone is no active driver; `Key was rejected by service` means enrollment is missing. After updates compare `sudo modinfo -F version nvidia` with `nvidia-smi`; a lagging driver or kernel waits on the user's restart.

### Mac

T3 desktop and iOS Simulator; builds from CI; no Docker. Keep the user's organization's MDM policies. System sleep is off, so it is reachable with the display off (a closed lid isn't): when `ssh matteopaludgnach@macbook-pro true` fails, ask the user to wake it. Sudo needs the user's password, so apps, updates and permissions are the user's, from a guide; agents run only Maintenance and the device setup below.

1. **Runtime.** `curl -fsSL https://vite.plus | bash`; `~/.zshenv` holds `export PATH="$HOME/.local/bin:$HOME/.vite-plus/bin:$PATH"` and `export DEVELOPER_DIR=/Applications/Xcode.app/Contents/Developer`.
2. **Xcode.** `open "macappstore://apps.apple.com/app/id497799835"`; guide: Get, open Xcode once, accept the license, download the iOS platform.
3. **Check.** `xcrun simctl list runtimes` lists iOS; `node --version` meets root `package.json`'s `engines` and the apps' EAS build requirements.
4. **T3.** Guide: Settings, Integrations, Devices, the worker's environment, Device hub and Agent device access on, add `matteopaludgnach@macbook-pro`, test. Copy the settings to the other worker.

### MCP sign-in

Register the endpoint described in `apps/gateway/README.md`. Codex reads `gateway` from the installed configuration; its OAuth sign-ins live in the Secret Service keyring, which D-Bus must start through its own unit (Debian's default activation starts a locked daemon whose unlock prompt hangs every Codex start). Claude keeps local MCP servers in `~/.claude.json`: register the gateway per worker.

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

- **Harness sign-in.** `claude mcp login --no-browser gateway` or `codex mcp login --no-browser gateway`; the user approves the printed code at https://auth.mp281x.xyz. Claude appears as a Claude Code column in Sign-ins.
- **Browser sign-in.** A profile without the user's GitHub, such as the Datapizza work profile: **Sign in with a code** at https://auth.mp281x.xyz, which the user approves. A provider whose account lives in that profile, such as Dual, connects from its row on the gateway's page there.
- **Connectors.** Only the gateway, not a claude.ai connector, Mobbin included. Once any `serverUrl` entry exists, every remote server needs a URL rule, T3's `http://127.0.0.1:<port>/mcp` included.
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
