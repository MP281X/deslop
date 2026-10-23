---
name: environment
description: Use before the first command, a resource-heavy local run, a preview or HTML page, a proof video, external accounts, iOS publishing or TestFlight, another worker, agent configuration links, deployment, thread history or machine maintenance.
---

# Environment

Two headless Debian workers in one tailnet, same user, paths and agent configuration; the user switches between them. Run commands for the other worker through `ssh mp281x@<worker>`.

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

| Reference                                | For                                                                         |
| ---------------------------------------- | --------------------------------------------------------------------------- |
| [Dual](references/dual.md)               | Turbo cache, accounts, preview, Jira, Google, VPN, tracing                  |
| [Deslop](references/deslop.md)           | Apps on dev, Simulator, npm and iOS publishing, TestFlight, tracing, deploy |
| [Maintenance](references/maintenance.md) | Machines, setup, agent links, T3 history and settings, updates, clean       |
| [Video](references/video.md)             | Proof videos: camera targets, HyperFrames composition and look              |

## Resource budget

The worker is shared with the user's other threads. Before a heavy gate, build, install or render, inspect RAM, swapping and heavy processes (`free -h`, `vmstat 1 3`, `ps -eo pid,ppid,comm,rss,pcpu --sort=-rss`). Run this thread's heavy commands serially and reuse its preview. Under memory pressure, defer and do bounded read-only work; never multiply workers, raise heap limits or retry into the same pressure. Inspect a process's checkout before attributing it, and stop only processes this thread started, never another thread's processes or preview. No custom scheduler, lock files or background polling loops.

## Previews

- **One per worktree:** the systemd user unit `preview-<worktree name>`, shared over tailnet HTTPS. Start or restart it only through the project's `preview` script from the worktree root, which prints the stable HTTPS URL and replaces the previous run. Never run the repository's preview command directly or as a background task: a second copy doubles its memory, and a background task dies after two hours.

  ```bash
  root=$(dirname "$(git rev-parse --path-format=absolute --git-common-dir)")
  id=$(sqlite3 -readonly ~/.t3/userdata/statev2.sqlite "SELECT project_id FROM projection_projects WHERE workspace_root = '$root' AND deleted_at IS NULL")
  bash -c "$(jq -r --arg id "$id" '.projectSettingsOverrides[$id].defaultProjectScripts[] | select(.id == "preview").command' ~/.t3/userdata/settings.json)"
  ```

- **Share** only after the URL loads sign-in, assets and API calls.
- **Simulator.** A native app runs on `macbook-pro` through the launcher and flags `device_open` returns: `open <bundle id>` before `snapshot -i`, `screenshot <path> --pixel-density 3` or `record start <path>`.
- **Keep** a started preview on the latest code at the end of every turn. `stop` runs only when the user asks; T3 runs `settle` when the thread settles or its PR merges.
- **Webhooks.** Funnel exposes a whole port: pick a free one of 443, 8443, 10000 and run `sudo tailscale funnel --bg --https=<port> --set-path <path> http://127.0.0.1:<api port><path>`; remove it with `... --set-path <path> off`.

## Diagnostics

- **Scope first.** The `scope` MCP server is the debugger: every Effect app in development, Deslop's and Dual's, exports its traces and logs to it. Reproduce the action, then `find_traces` and `read_trace` for what the code did, `find_logs` for what it said, `measure_latency` on the same operation before and after a change.
- **Layout:** `preview_snapshot` returns every element's box, the console and the network requests; a clipped, overflowing or misaligned element shows in its box against its container's.
- **Slow input:** a `PerformanceObserver` for `event`, `long-animation-frame` and `layout-shift` through `preview_evaluate`, read after the real input.
- **Rerenders:** React Profiler or a temporary `console.count` through `preview_evaluate`, removed before push.
- **Saved reading:** the `stash` MCP server holds the articles, videos and posts the user saved; `search_notes` when they refer to one.
