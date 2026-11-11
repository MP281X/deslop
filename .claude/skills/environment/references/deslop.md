# Deslop

## Workers

- **Production.** On dev each app is `deslop-<app>.service`, running `~/.deslop/<app>/current`, with its flags in the unit. Deploy's Caddy, `deslop-deploy-caddy.service`, serves its owned `*.mp281x.xyz` hostnames on 80 and 443 (`/etc/sysctl.d/90-unprivileged-ports.conf` lets a user bind them).
- **Desktop.** Runs only Deploy, at `https://desktop.tailnet-8c4c.ts.net:5102`, reached by dev's Deploy; the shared worker key follows Deploy's README.
- **Stash.** No worktree preview: `deslop-stash.service` serves `https://stash.mp281x.xyz` and `~/.deslop/stash` is production data. The iPhone app and share sheet use that origin with shared Keychain credentials. A scratch run from a worktree keeps its own data in `.deslop/stash`: `vp -C apps/stash run build && node --env-file=$HOME/.deslop/stash.env apps/stash/dist/server.js --port 5018`.
- **Stash proxy.** `STASH_PROXY` is the DataImpulse residential plan "stash", with `__sessid.{session}` after the login.

## Accounts

- **npm.** `matteo_paludgnach` approves a first publish's URL.
- **Apple.** App Store Connect API key `XPDBFL4L6T`; the cached session in `~/.app-store/auth` answers `eas-cli` prompts; on expiry the user signs in again with the same command.
- **EAS.** Paid cloud builds need the user's approval.

## Tracing

- **Public.** `https://scope.mp281x.xyz`.
- **Tailnet.** `https://dev.tailnet-8c4c.ts.net:4318`, served by `sudo tailscale serve --bg --https=4318 http://127.0.0.1:5106` to Scope's port.
