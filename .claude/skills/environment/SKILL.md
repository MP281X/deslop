---
name: environment
description: Use before the first command of a session, and before any preview, a Jira or DOS ticket, a GitLab or VPN step, a change to persisted Dual data, a task on another worker, the agent configuration links, updating T3 or the machines, a deploy, earlier threads, and machine setup or cleanup.
---

# Environment

Two headless Debian workers in one tailnet, same user and paths; the user switches between them. The session hook prints `Execution worker: <name>`; run commands for the other worker through `ssh mp281x@<worker>`.

| Name          | Address          | Role                                                                                        |
| ------------- | ---------------- | ------------------------------------------------------------------------------------------- |
| `desktop`     | `100.97.120.3`   | Home worker for most development, on only when the user turns it on                         |
| `dev`         | `100.68.201.107` | Always on, public address: Traefik for `*.mp281x.xyz`, Datapizza VPN, Scope, overnight work |
| `macbook-pro` | `100.115.207.60` | The user's control plane and the iOS Simulator host, on demand                              |
| `iphone`      | `100.117.217.10` | T3 client only                                                                              |

- **Names.** MagicDNS short names; `<name>.tailnet-8c4c.ts.net` has HTTPS certificates. SSH as `mp281x@dev`, `mp281x@desktop`, `matteopaludgnach@macbook-pro`.
- **Tools.** `vp` and `vpx` (Vite+) on `PATH` everywhere, also over SSH; systemd units need `~/.vite-plus/bin`. Sudo needs no password; `gh` and `glab` are signed in, and so is the `dual` MCP server.
- **Scratch** under `/tmp/<task>/`, on disk, emptied at boot.
- **Git refs.** T3 keeps checkpoint commits under `refs/t3/`; search history with `--branches --remotes`.
- **Services** run as temporary containers, not host installs.
- **Threads on the other worker.** T3 tools reach only this worker's threads. To start work in a thread on the other worker, give the user the message to paste there; never reach its T3 server through its API, auth tokens or pairing codes.

| Reference                                | For                                                                    |
| ---------------------------------------- | ---------------------------------------------------------------------- |
| [Dual](references/dual.md)               | Commands, production data, Jira, VPN, preview, accounts, CI, standards |
| [Deslop](references/deslop.md)           | Commands, app, tracing, coding standards                               |
| [Maintenance](references/maintenance.md) | Machines, setup, agent links, T3 history and settings, updates, clean  |

## Previews

- **One per worktree:** the systemd user unit `preview-<worktree name>`, shared over tailnet HTTPS. A thread that changes the app starts or restarts it only with the project's `preview` script, run from the worktree root; it prints the stable HTTPS URL and replaces the previous one. Never run the repository's preview command directly or as a harness background task: a second copy doubles its memory, and a background task dies after two hours.

  ```bash
  root=$(dirname "$(git rev-parse --path-format=absolute --git-common-dir)")
  id=$(sqlite3 -readonly ~/.t3/userdata/statev2.sqlite "SELECT project_id FROM projection_projects WHERE workspace_root = '$root' AND deleted_at IS NULL")
  bash -c "$(jq -r --arg id "$id" '.projectSettingsOverrides[$id].defaultProjectScripts[] | select(.id == "preview").command' ~/.t3/userdata/settings.json)"
  ```

- **Share** only after the URL loads sign-in, assets and API calls; open it in the thread's one T3 tab per delivery's Captures.
- **Keep** a started preview on the latest code at the end of every turn. `stop` runs only when the user asks; T3 runs `settle` when the thread settles or its PR merges.
- **Webhooks.** Funnel exposes a whole port: pick a free one of 443, 8443, 10000 and run `sudo tailscale funnel --bg --https=<port> --set-path <path> http://127.0.0.1:<api port><path>`; remove it with `... --set-path <path> off`.

## Diagnostics

- **Rerenders:** React Profiler or a temporary `console.count` through `preview_evaluate`, removed before push.
- **Slow input:** `performance.mark` and a `PerformanceObserver` for `longtask` and `event`.
- **Tracing:** correlate one real action's client and server spans before and after, per the repository reference.
