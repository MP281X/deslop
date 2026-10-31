---
name: environment
description: Load before worker operations, previews, devices, tracing, deployment, publishing or sign-in, and when analyzing agent failures or changing instructions.
---

# Environment

Two headless Debian workers in one tailnet, same user, paths and agent configuration.

| Name          | Address          | Role                                                                                        |
| ------------- | ---------------- | ------------------------------------------------------------------------------------------- |
| `desktop`     | `100.97.120.3`   | Home worker for most development, on only when the user turns it on                         |
| `dev`         | `100.68.201.107` | Always on, public address: Traefik for `*.mp281x.xyz`, Datapizza VPN, Scope, overnight work |
| `macbook-pro` | `100.115.207.60` | The user's control plane and the iOS Simulator host, on demand                              |
| `iphone`      | `100.117.217.10` | T3 client only                                                                              |

- **Names.** MagicDNS short names; `<name>.tailnet-8c4c.ts.net` has HTTPS certificates. SSH as `mp281x@dev`, `mp281x@desktop`, `matteopaludgnach@macbook-pro`.
- **Tools.** `vp` and `vpx` (Vite+) on `PATH` everywhere, also over SSH; systemd units need `~/.vite-plus/bin`. Sudo needs no password on the workers; `gh` and `glab` are signed in, and so is the `dual` MCP server.
- **Scratch** under `/tmp/<task>/`, on disk, emptied at boot and of files unused for 7 days.
- **Git refs.** T3 keeps checkpoint commits under `refs/t3/`; search history with `--branches --remotes`.
- **Services** run as temporary containers, not host installs.

| Reference                                    | For                                                                         |
| -------------------------------------------- | --------------------------------------------------------------------------- |
| [Dual](references/dual.md)                   | Accounts, merges, preview, Jira, Google, VPN, tracing                       |
| [Deslop](references/deslop.md)               | Apps on dev, Simulator, npm and iOS publishing, TestFlight, tracing, deploy |
| [Maintenance](references/maintenance.md)     | Machines, setup, agent links, T3 settings, updates, clean                   |
| [Video](references/video.md)                 | Proof videos: camera targets, HyperFrames composition and look              |
| [Retrospective](references/retrospective.md) | When analyzing agent failures or changing prompts, skills or lint policy    |

## Previews

- **One per worktree:** the systemd user unit `preview-<worktree name>`, shared over tailnet HTTPS. Start or restart it only through the project's `preview` script from the worktree root, which prints the stable HTTPS URL and replaces the previous run; the repository's own preview command or a background task bypasses the unit and dies with the turn.

  ```bash
  root=$(dirname "$(git rev-parse --path-format=absolute --git-common-dir)")
  id=$(sqlite3 -readonly ~/.t3/userdata/statev2.sqlite "SELECT project_id FROM projection_projects WHERE workspace_root = '$root' AND deleted_at IS NULL")
  bash -c "$(jq -r --arg id "$id" '.projectSettingsOverrides[$id].defaultProjectScripts[] | select(.id == "preview").command' ~/.t3/userdata/settings.json)"
  ```

- **Share** only after the URL loads sign-in, assets and API calls.
- **Keep** a started preview on the latest code at the end of every turn: deslop's serves a production build, so rerun `preview` after edits.
- **Webhooks.** Funnel exposes a whole port: pick a free one of 443, 8443, 10000 and run `sudo tailscale funnel --bg --https=<port> --set-path <path> http://127.0.0.1:<api port><path>`; remove it with `... --set-path <path> off`.

## Diagnostics

Use Scope traces and logs when the failing operation exports them; otherwise use the reproduction's output and source. Deslop exports from previews on dev and from deploys; Dual only from a development launch (Dual reference, Tracing).

Validate web journeys in T3 at the app's theme and primary viewport: desktop 1440×900, phone `iphone-12-pro`. Capture the real input through its outcome after the deciding condition holds.
