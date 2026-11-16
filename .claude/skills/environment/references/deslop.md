# Deslop

## Workers

- **Production.** On dev each app is `deslop-<app>.service`, running `~/.deslop/<app>/current`, with `--domain mp281x.xyz` and its app-specific flags in the unit. Deploy uses `--workers desktop,macbook-pro`, resolving their HTTPS origins through Tailscale's MagicDNS suffix and its own package port. Deploy's Caddy, `deslop-deploy-caddy.service`, serves its owned `*.mp281x.xyz` hostnames on 80 and 443 (`/etc/sysctl.d/90-unprivileged-ports.conf` lets a user bind them).
- **Desktop.** Runs only Deploy, at `https://desktop.tailnet-8c4c.ts.net:5102`, reached by dev's Deploy.
- **MacBook.** Runs only Deploy, as the launch agent `deslop-deploy`, at `https://macbook-pro.tailnet-8c4c.ts.net:5102`, reached by dev's Deploy as `macbook-pro`; its `~/.deslop/deploy` holds a week of resource history and its owned tailnet exposures.
- **Stash.** No worktree preview: `deslop-stash.service` serves `https://stash.mp281x.xyz` and `~/.deslop/stash` is production data. The iPhone app and share sheet use that origin without credentials: Auth names the phone by its tailnet address. A scratch run from a worktree keeps its own data in `.deslop/stash`: `vp -C apps/stash run build && node --env-file=$HOME/.deslop/stash.env apps/stash/dist/server.js --port 5018`.
- **Stash proxy.** `STASH_PROXY` is the DataImpulse residential plan "stash", with `__sessid.{session}` after the login.

## Accounts

- **npm.** `matteo_paludgnach` approves a first publish's URL.
- **Apple.** Only GitHub workflows reach Apple, with the App Store Connect API key in repository secrets; nothing signs in to Apple on a worker.
- **EAS.** Desktop's Expo session, an owner of `mp281x.xyz`, registers new projects; Release uses `EXPO_TOKEN`.

## Tracing

- **Endpoint.** `https://scope.mp281x.xyz`, for apps and OTLP exporters alike; ingestion at `/v1/traces` needs no sign-in.
