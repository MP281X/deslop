# Deslop

## Workers

- **Production.** On dev the app units use `--domain mp281x.xyz`; Deploy uses `--workers desktop,macbook-pro`. Its Caddy unit, `deslop-deploy-caddy.service`, owns the exposed hostnames on 80 and 443 (`/etc/sysctl.d/90-unprivileged-ports.conf` lets a user bind them).
- **Peer workers.** Desktop and MacBook run only Deploy, reached by dev's Deploy; the Mac's `~/.deslop/deploy` holds a week of resource history and its owned tailnet exposures.
- **Stash.** `vp run preview stash` serves a scratch copy, never the phone's origin: `deslop-stash.service` serves `https://stash.mp281x.xyz` and `~/.deslop/stash` is production data. The iPhone app and share sheet use that origin. A scratch run from a worktree keeps its own data in `.deslop/stash`: build with `vp -C apps/stash run build`, then run `node --env-file=$HOME/.deslop/stash.env apps/stash/dist/server.js --port 5018` from the worktree root; 5018 is the scratch port, not the installed app's port.
- **Stash proxy.** `STASH_PROXY` is the DataImpulse residential plan "stash", with `__sessid.{session}` after the login.

## Accounts

- **npm.** `matteo_paludgnach` approves a first publish's URL.
- **Apple.** Only GitHub workflows reach Apple, with the App Store Connect API key in repository secrets; nothing signs in to Apple on a worker.
- **EAS.** Desktop's Expo session, an owner of `mp281x.xyz`, registers new projects; Release uses `EXPO_TOKEN`.

## Tracing

- **Endpoint.** `https://scope.mp281x.xyz`, for apps and OTLP exporters alike; ingestion at `/v1/traces` needs no sign-in.
