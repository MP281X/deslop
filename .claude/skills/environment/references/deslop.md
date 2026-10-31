# Deslop

The repository's `AGENTS.md` and `RELEASING.md` hold its commands and release procedures; this is the user's infrastructure and accounts around them.

## Apps

- **Preview.** The deslop `preview` project script runs the portfolio build for iteration, browser tests and captures.
- **Production.** dev runs `tools/compose.yaml` as the `deslop` project from `~/deslop`; its `deploy` service applies each published main.
- **Stash** has no worktree preview: the `stash` compose service on dev serves `https://stash.mp281x.xyz`, and the real notes in `~/.deslop/stash` are production data. The iPhone app and share sheet use the fixed public origin and shared Keychain credentials. Try its image with scratch data on another port: `mkdir -p /tmp/<task>/stash && vp -C apps/stash run build && docker build apps/stash -t stash:local && docker run --rm -d --env-file ~/.deslop/stash.env -p 127.0.0.1:5018:5000 -v /tmp/<task>/stash:/home/node/.deslop/stash stash:local`. The API and MCP require authorization even on loopback. `~/.deslop/stash.env` holds the variables in `apps/stash/.env.example`; `STASH_PROXY` is the user's DataImpulse residential plan "stash", with `__sessid.{session}` after the login.

## Accounts

- **npm:** the user (`matteo_paludgnach`) approves a first publish's npmjs.com URL.
- **Apple:** the team's App Store Connect API key is `XPDBFL4L6T`. The Apple session the user's last sign-in cached in `~/.app-store/auth` answers `eas-cli` prompts; when it has expired, the user signs in again with the same command.
- **EAS:** paid cloud builds need the user's approval.

## Tracing

The `scope` compose service on dev receives trusted OTLP/HTTP JSON on `127.0.0.1:4318`, published on the tailnet as `https://dev.tailnet-8c4c.ts.net:4318` with `sudo tailscale serve --bg --https=4318 http://127.0.0.1:4318`. Public ingestion at `https://otel.mp281x.xyz/v1/traces` and `/v1/logs` requires a Deslop session cookie or audience-bound bearer. Port 4318 has no MCP route. Apps default to `http://localhost:4318`, so a preview exports only on dev; an allowed preflight does not prove spans.
