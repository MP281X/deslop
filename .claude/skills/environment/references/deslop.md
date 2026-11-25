# Deslop

## Workers

- **Production.** On dev the app units use `--domain mp281x.xyz`; Deploy uses `--workers desktop,macbook-pro`, though the desktop is sold and never answers. Deploy's Caddy unit, `deslop-deploy-caddy.service`, owns the exposed hostnames on 80 and 443, which `/etc/sysctl.d/90-unprivileged-ports.conf` lets a user bind.
- **MacBook.** Runs only Deploy, reached by dev's Deploy; its `~/.deslop/deploy` holds a week of resource history and its tailnet exposures.
- **Stash.** `deslop-stash.service` serves `https://stash.mp281x.xyz`, the origin of the iPhone app and share sheet, from production data in `~/.deslop/stash`; `vp run preview stash` serves a scratch copy. `STASH_PROXY` is the DataImpulse residential plan "stash", with `__sessid.{session}` after the login.

## Accounts

- **npm.** `matteo_paludgnach` approves a first publish's URL.
- **Apple.** Only GitHub workflows reach Apple, with the App Store Connect API key in repository secrets; nothing signs in to Apple on a worker.
- **EAS.** Dev's Expo session, `mp281x`, an owner of `mp281x.xyz`, registers new projects; Release uses `EXPO_TOKEN`.

## Tracing

Apps and OTLP exporters send to `https://scope.mp281x.xyz`, whose ingestion needs no sign-in.
