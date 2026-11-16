---
name: environment
description: Load before a command on another worker, Validate's tests, starting a preview, opening a device, reading a trace or runtime error, deploying, publishing, a sign-in, reading Stash data, a maintenance pass, or any Dual task.
---

# Environment

Two headless Debian workers in one tailnet, same user and paths.

| Name          | Address          | Role                                                                       |
| ------------- | ---------------- | -------------------------------------------------------------------------- |
| `desktop`     | `100.97.120.3`   | Fastest; sometimes off                                                     |
| `dev`         | `100.68.201.107` | Always on: Deslop apps for `*.mp281x.xyz`                                  |
| `macbook-pro` | `100.115.207.60` | The user's control plane, the iOS Simulator and a Deploy worker, on demand |
| `iphone`      | `100.117.217.10` | T3 client only                                                             |

- **Names.** MagicDNS short names; `<name>.tailnet-8c4c.ts.net` has HTTPS certificates. SSH as `mp281x@dev`, `mp281x@desktop`, `matteopaludgnach@macbook-pro`.
- **Validation worker.** For work on dev, when `desktop` answers SSH, Validate's tests run there over SSH, in a detached worktree under `/tmp/<task>/` of the commit fetched from dev (`git fetch mp281x@dev:<worktree> <sha>`) after `vp install`, never in the installed clone; fixes stay on dev.
- **Tools.** `vp` and `vpx` on `PATH`, also over SSH; systemd units need `~/.vite-plus/bin`. `gh`, `glab` and the MCP gateway signed in.
- **Scratch.** Use `/tmp/<task>/`, on disk, emptied at boot and of files unused for 7 days.
- **Git refs.** T3 checkpoints under `refs/t3/`; search history with `--branches --remotes`.
- **Auxiliary services.** Run task-local ones as temporary containers, not installs on the worker.
- **Agent MCP.** [Keyring and MCP](references/maintenance.md#keyring-and-mcp).

| Reference                                | For                                                      |
| ---------------------------------------- | -------------------------------------------------------- |
| [Deslop](references/deslop.md)           | Production, Stash data, npm, Apple and EAS, tracing      |
| [Dual](references/dual.md)               | Accounts, merges, preview, Jira, Google, VPN, tracing    |
| [Maintenance](references/maintenance.md) | Workers, setup, agent links, T3 settings, updates, clean |

## Previews

One per worktree: the systemd user unit `preview-<worktree name>`, shared over tailnet HTTPS.

```mermaid
stateDiagram-v2
    [*] --> Stale : edits touch an app
    Stale --> Starting : a capture needs it / run the project's preview script from the worktree root
    Starting --> Live : stable HTTPS URL printed / its URL goes in the next reply, once
    Starting --> Stale : [invalid selection] / the running preview stays untouched
    Live --> Stale : more edits
    Live --> [*] : worktree gone / maintenance removes the unit
```

- **Script.** Read the saved one with `t3_project_read`. Deslop's selects a changed web app, else Portfolio; `PREVIEW_APP=<app>` previews another app of the same change. The repository's own preview command or a background task bypasses the unit and dies with the turn.
- **No worktree preview** (Stash): use its scratch run.
- **Webhooks.** Funnel exposes a whole port: pick a free one of 443, 8443, 10000 and run `sudo tailscale funnel --bg --https=<port> --set-path <path> http://127.0.0.1:<api port><path>`; remove it with `... --set-path <path> off`.

## Tools

| Question                        | Tool                                                                                                                                        |
| ------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------- |
| Runtime state                   | Deploy's `list_apps` or `read_resource_history`, with the full worker name (`dev.mp281x.xyz`); host checks follow the maintenance reference |
| Runtime error, trace or latency | Scope's `list_operations`, then `search_traces`, then `read_trace` or `measure_latency`                                                     |
