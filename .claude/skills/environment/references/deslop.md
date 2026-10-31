# Deslop

The repository's `AGENTS.md` and `RELEASING.md` own its commands and releases; this is the user's hosts and accounts around them.

## Hosts

- **Production**: dev runs `tools/compose.yaml` as the `deslop` project from `~/deslop`.
- **Preview**: the portfolio's production build, so rerun `preview` after edits.
- **Stash**: no worktree preview; the `stash` service serves `https://stash.mp281x.xyz`, and `~/.deslop/stash` is production data. The iPhone app and share sheet use that origin and shared Keychain credentials. Scratch run on another port: `mkdir -p /tmp/<task>/stash && vp -C apps/stash run build && docker build apps/stash -t stash:local && docker run --rm -d --env-file ~/.deslop/stash.env -p 127.0.0.1:5018:5000 -v /tmp/<task>/stash:/home/node/.deslop/stash stash:local`.
- **`~/.deslop/stash.env`**: the variables of `apps/stash/.env.example`; `STASH_PROXY` is the DataImpulse residential plan "stash", `__sessid.{session}` after the login.

## Accounts

- **npm**: `matteo_paludgnach` approves a first publish's URL.
- **Apple**: App Store Connect API key `XPDBFL4L6T`; the cached session in `~/.app-store/auth` answers `eas-cli` prompts; on expiry the user signs in again with the same command.
- **EAS**: paid cloud builds need the user's approval.

## Tracing

- **Local**: apps default to `http://localhost:4318`, the `scope` service on dev, so previews on dev and deploys export.
- **Tailnet**: `https://dev.tailnet-8c4c.ts.net:4318`, via `sudo tailscale serve --bg --https=4318 http://127.0.0.1:4318`.
- **Public**: `https://otel.mp281x.xyz/v1/traces` and `/v1/logs`, with a Deslop session cookie or audience-bound bearer.
