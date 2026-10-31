---
name: environment
description: Load before worker operations, previews, devices, tracing, deployment, publishing or sign-in.
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
- **Tools.** `vp` and `vpx` (Vite+) on `PATH` everywhere, also over SSH; systemd units need `~/.vite-plus/bin`. Passwordless sudo on the workers; `gh`, `glab` and the `dual` MCP server signed in.
- **Scratch** under `/tmp/<task>/`, on disk, emptied at boot and of files unused for 7 days.
- **Git refs.** T3 checkpoints under `refs/t3/`; search history with `--branches --remotes`.
- **Services** run as temporary containers, not host installs.

| Reference                                | For                                                       |
| ---------------------------------------- | --------------------------------------------------------- |
| [Dual](references/dual.md)               | Accounts, merges, preview, Jira, Google, VPN, tracing     |
| [Maintenance](references/maintenance.md) | Machines, setup, agent links, T3 settings, updates, clean |
| [Video](references/video.md)             | Proof videos: camera targets, HyperFrames composition     |

## Previews

- **One per worktree:** the systemd user unit `preview-<worktree name>`, shared over tailnet HTTPS. Start or restart it only through the project's `preview` script from the worktree root, which prints the stable HTTPS URL and replaces the previous run; the repository's own preview command or a background task bypasses the unit and dies with the turn.

  ```bash
  root=$(dirname "$(git rev-parse --path-format=absolute --git-common-dir)")
  id=$(sqlite3 -readonly ~/.t3/userdata/statev2.sqlite "SELECT project_id FROM projection_projects WHERE workspace_root = '$root' AND deleted_at IS NULL")
  bash -c "$(jq -r --arg id "$id" '.projectSettingsOverrides[$id].defaultProjectScripts[] | select(.id == "preview").command' ~/.t3/userdata/settings.json)"
  ```

- **Share** only after the URL loads sign-in, assets and API calls.
- **Keep** a started preview on the latest code at the end of every turn: deslop's serves a production build of the portfolio, so rerun `preview` after edits.
- **Webhooks.** Funnel exposes a whole port: pick a free one of 443, 8443, 10000 and run `sudo tailscale funnel --bg --https=<port> --set-path <path> http://127.0.0.1:<api port><path>`; remove it with `... --set-path <path> off`.

## Deslop

- **Production.** dev runs `tools/compose.yaml` as the `deslop` project from `~/deslop`.
- **Stash.** No worktree preview: the `stash` service serves `https://stash.mp281x.xyz`; `~/.deslop/stash` is production data. The iPhone app and share sheet use that origin and shared Keychain credentials. API and MCP need authorization even on loopback. Scratch run on another port: `mkdir -p /tmp/<task>/stash && vp -C apps/stash run build && docker build apps/stash -t stash:local && docker run --rm -d --env-file ~/.deslop/stash.env -p 127.0.0.1:5018:5000 -v /tmp/<task>/stash:/home/node/.deslop/stash stash:local`.
- **`~/.deslop/stash.env`**: the variables of `apps/stash/.env.example`; `STASH_PROXY` is the DataImpulse residential plan "stash", `__sessid.{session}` after the login.
- **npm**: `matteo_paludgnach` approves a first publish's URL.
- **Apple**: App Store Connect API key `XPDBFL4L6T`; the cached session in `~/.app-store/auth` answers `eas-cli` prompts; on expiry the user signs in again with the same command.
- **EAS**: paid cloud builds need the user's approval.

## Diagnostics

Scope traces and logs when the failing operation exports them; otherwise the reproduction's output and source.

- **Deslop** exports from previews on dev and from deploys: apps default to `http://localhost:4318`, the `scope` service on dev.
- **Tailnet**: `https://dev.tailnet-8c4c.ts.net:4318`, via `sudo tailscale serve --bg --https=4318 http://127.0.0.1:4318`.
- **Public**: `https://otel.mp281x.xyz/v1/traces` and `/v1/logs`, with a Deslop session cookie or audience-bound bearer. Port 4318 has no MCP route; an allowed preflight proves no span.
- **Dual** only from a development launch (Dual reference, Tracing).
- **Web journeys** in T3 at the app's theme and primary viewport (desktop 1440×900, phone `iphone-12-pro`): the real input through its outcome, after the deciding condition holds.
