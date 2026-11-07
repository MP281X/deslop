---
name: environment
description: Load before worker operations, previews, devices, tracing, deployment, publishing, sign-in, runtime errors, saved reading, design references or Dual.
---

# Environment

Two headless Debian workers in one tailnet, same user, paths and agent configuration.

| Name          | Address          | Role                                                                                          |
| ------------- | ---------------- | --------------------------------------------------------------------------------------------- |
| `desktop`     | `100.97.120.3`   | Home worker for most development, on only when the user turns it on                           |
| `dev`         | `100.68.201.107` | Always on, public address: every Deslop app for `*.mp281x.xyz`, Datapizza VPN, overnight work |
| `macbook-pro` | `100.115.207.60` | The user's control plane and the iOS Simulator host, on demand                                |
| `iphone`      | `100.117.217.10` | T3 client only                                                                                |

- **Names.** MagicDNS short names; `<name>.tailnet-8c4c.ts.net` has HTTPS certificates. SSH as `mp281x@dev`, `mp281x@desktop`, `matteopaludgnach@macbook-pro`.
- **Tools.** `vp` and `vpx` (Vite+) on `PATH` everywhere, also over SSH; systemd units need `~/.vite-plus/bin`. Passwordless sudo on the workers; `gh`, `glab` and the MCP gateway signed in.
- **Scratch** under `/tmp/<task>/`, on disk, emptied at boot and of files unused for 7 days.
- **Git refs.** T3 checkpoints under `refs/t3/`; search history with `--branches --remotes`.
- **Task-local auxiliary services** run as temporary containers, not host installs.
- **Agent sign-in.** Claude: `claude mcp login --no-browser gateway`; Codex uses its configured gateway MCP sign-in. Approve the code in the URL it prints at https://auth.mp281x.xyz.

| Reference                                | For                                                       |
| ---------------------------------------- | --------------------------------------------------------- |
| [Deslop](references/deslop.md)           | Production, Stash data, npm, Apple and EAS, tracing       |
| [Dual](references/dual.md)               | Accounts, merges, preview, Jira, Google, VPN, tracing     |
| [Maintenance](references/maintenance.md) | Machines, setup, agent links, T3 settings, updates, clean |

## Previews

- **One per worktree:** the systemd user unit `preview-<worktree name>`, shared over tailnet HTTPS. Start or restart it only through the project's `preview` script from the worktree root, which prints the stable HTTPS URL and replaces the previous run; the repository's own preview command or a background task bypasses the unit and dies with the turn.

  Read the saved command with `t3_project_read`. Deslop selects a changed web app, or Portfolio; set `PREVIEW_APP=<app>` when checking another app in the same change. Invalid selections leave the existing preview running.

- **Share** only after the URL loads sign-in, assets and API calls.
- **Keep** it running: a turn that touched an app ends with that app's preview up on the latest code, started if it wasn't; where the app has no worktree preview, use its scratch run.
- **Webhooks.** Funnel exposes a whole port: pick a free one of 443, 8443, 10000 and run `sudo tailscale funnel --bg --https=<port> --set-path <path> http://127.0.0.1:<api port><path>`; remove it with `... --set-path <path> off`.

## Tools

One chain per trigger; if it returns no data, say so and proceed. Missing MCP data permits continued investigation, not a successful verification claim.

| Missing fact                             | First call                                                                                                                                         |
| ---------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------- |
| Runtime error, trace or latency          | Scope: `list_services` → `find` → `read_trace` / `measure_latency`                                                                                 |
| Runtime service, port or container state | Deploy: `inventory` / `resource_history` — not `ps`, `docker ps`, `ss` or `systemctl`; unit health is the maintenance check's `systemctl --failed` |
| Sign-in blocked                          | Auth: `answer_request`                                                                                                                             |
| Saved article, video or post             | Stash: `search_notes` / `read_note`                                                                                                                |
| Design reference                         | Mobbin: `search_screens` / `search_flows` / `save_content`                                                                                         |
| Dual behavior or skill                   | DualOS: `dual_context` → `read_skill` → `execute`                                                                                                  |
| A tool seems missing                     | `list_mcp_connections` before assuming it is absent                                                                                                |

## Diagnostics

- **Primary viewports** in T3: desktop 1440×900, phone `iphone-12-pro`.
