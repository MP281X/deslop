---
name: environment
description: Load before worker operations, previews, devices, tracing, deployment, publishing, sign-in, runtime errors, saved reading, design references, reading an outside repository or Dual.
---

# Environment

Two headless Debian workers in one tailnet, same user and paths.

| Name          | Address          | Role                                                                                          |
| ------------- | ---------------- | --------------------------------------------------------------------------------------------- |
| `desktop`     | `100.97.120.3`   | Home worker for most development, on only when the user turns it on                           |
| `dev`         | `100.68.201.107` | Always on, public address: every Deslop app for `*.mp281x.xyz`, Datapizza VPN, overnight work |
| `macbook-pro` | `100.115.207.60` | The user's control plane and the iOS Simulator host, on demand                                |
| `iphone`      | `100.117.217.10` | T3 client only                                                                                |

- **Names.** MagicDNS short names; `<name>.tailnet-8c4c.ts.net` has HTTPS certificates. SSH as `mp281x@dev`, `mp281x@desktop`, `matteopaludgnach@macbook-pro`.
- **Tools.** `vp` and `vpx` on `PATH`, also over SSH; systemd units need `~/.vite-plus/bin`. `gh`, `glab` and the MCP gateway signed in.
- **Scratch.** Use `/tmp/<task>/`, on disk, emptied at boot and of files unused for 7 days.
- **Git refs.** T3 checkpoints under `refs/t3/`; search history with `--branches --remotes`.
- **Auxiliary services.** Run task-local ones as temporary containers, not host installs.
- **Agent sign-in.** [MCP sign-in](references/maintenance.md#mcp-sign-in).

| Reference                                | For                                                       |
| ---------------------------------------- | --------------------------------------------------------- |
| [Deslop](references/deslop.md)           | Production, Stash data, npm, Apple and EAS, tracing       |
| [Dual](references/dual.md)               | Accounts, merges, preview, Jira, Google, VPN, tracing     |
| [Maintenance](references/maintenance.md) | Machines, setup, agent links, T3 settings, updates, clean |
| [Repositories](references/repos.md)      | Outside repositories to read when no example exists here  |

## Previews

- **One per worktree.** The systemd user unit `preview-<worktree name>`, shared over tailnet HTTPS. Start or restart it after edits through the project's `preview` script from the worktree root, which prints the stable HTTPS URL and replaces the previous run; the repository's own preview command or a background task bypasses the unit and dies with the turn.

  Read the saved command with `t3_project_read`. Deslop selects a changed web app, or Portfolio; set `PREVIEW_APP=<app>` when checking another app in the same change. Invalid selections leave the existing preview running.

  A turn that touched an app ends with its preview running the latest code; where no worktree preview exists, use its scratch run.

- **Share.** Only after the URL loads sign-in, assets and API calls.
- **Webhooks.** Funnel exposes a whole port: pick a free one of 443, 8443, 10000 and run `sudo tailscale funnel --bg --https=<port> --set-path <path> http://127.0.0.1:<api port><path>`; remove it with `... --set-path <path> off`.

## Tools

No data means report it and investigate further, not verification.

- **Runtime state.** Call Deploy's `list_apps` or `resource_history`, not `ps`, `docker ps`, `ss` or `systemctl`. Use the full worker name, such as `dev.mp281x.xyz`, not `dev`; check unit health with the maintenance check's `systemctl --failed`.
- **Missing tool.** Call `list_mcp_connections` before assuming it is absent.
- **Runtime error, trace or latency.** Call Scope's `list_operations`, then `find_traces`, then `read_trace` or `measure_latency`.
