# Deslop

Commands and releases: `AGENTS.md` and `.github/releasing.md`.

## Hosts

- **Production**: on dev each app is `deslop-<app>.service`, running `~/.deslop/<app>/current`; Deploy's Caddy, `deslop-deploy-caddy.service`, serves its owned `*.mp281x.xyz` hostnames on 80 and 443 (`/etc/sysctl.d/90-unprivileged-ports.conf` lets a user bind them). desktop runs only Deploy, at `https://desktop.tailnet-8c4c.ts.net:5102`, reached by dev's Deploy. Configure the shared worker key as described in Deploy's README. Flags live in each unit.
- **Preview.** Use the preview procedure in this skill. In a local preview, Auth's **Sign in with GitHub** returns at once; the auth policy is in root `AGENTS.md`.
- **Stash**: no worktree preview; `deslop-stash.service` serves `https://stash.mp281x.xyz`, and `~/.deslop/stash` is production data. The iPhone app and share sheet use that origin and shared Keychain credentials. Scratch run on another port from a checkout, with its own data in the checkout's `.deslop/stash`: `vp -C apps/stash run build && node --env-file=$HOME/.deslop/stash.env apps/stash/dist/server.js --port 5018`.
- **Stash proxy.** `STASH_PROXY` is the DataImpulse residential plan "stash", with `__sessid.{session}` after the login.

## Accounts

- **npm**: `matteo_paludgnach` approves a first publish's URL.
- **Apple**: App Store Connect API key `XPDBFL4L6T`; the cached session in `~/.app-store/auth` answers `eas-cli` prompts; on expiry the user signs in again with the same command.
- **EAS**: paid cloud builds need the user's approval.

## Tracing

- **Public.** Send telemetry to `https://scope.mp281x.xyz` as described in Scope's README.
- **Tailnet**: `https://dev.tailnet-8c4c.ts.net:4318`, Tailscale Serve to Scope's port, `sudo tailscale serve --bg --https=4318 http://127.0.0.1:5106`.
