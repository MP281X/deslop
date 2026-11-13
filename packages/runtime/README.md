# Deslop app runtime

Every Deslop app uses the same command line.

```bash
npm install --global @deslop/<app>
<app>                                   # run in the foreground on 127.0.0.1
<app> service install [flags]           # run as a user service that updates itself from npm
<app> service status | update | uninstall
```

Run `<app> --help` to list settings. Root `AGENTS.md` holds the repository's data and secrets policy.

Services use systemd user units on Linux and launchd agents on macOS. On macOS, a GUI user must be logged in (installation can run over SSH): agents live in `~/Library/LaunchAgents/deslop-<app>.plist` in the `gui/<uid>` domain and start at login, not before it. Reinstall replaces the loaded agent; status prints its path, state, PID and last exit information. Failed apps restart after a three-second throttle; a successful exit does not restart.

Both platforms set `NODE_ENV=production`, restrict newly created files to the user and read optional settings from `~/.deslop/<app>.env`. On macOS, Node loads that file with `--env-file-if-exists`; the service PATH is `~/.vite-plus/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin`.

The separate `deslop-<app>-update` agent checks npm every 900 seconds on macOS (sleeping or already-running intervals are skipped). Updates install alongside the running release, atomically promote `~/.deslop/<app>/current`, restart only the app and retain the previous release. Uninstall removes the app and update agents but preserves application data.

## APNs

`server/apns` owns Apple's HTTP/2 transport, ES256 provider signing, 40-minute bearer caching, throttling backoff and endpoint selection. `Apns.layer` reads `APNS_KEY` (redacted PKCS#8 PEM or base64 DER), `APNS_KEY_ID` and `APNS_TEAM_ID`. Provide `layerApnsClient` to it at the server entry; app services keep their own HTTP client and notification policy. `sendToDevice` takes the bundle and native token; the runtime's Expo configuration convention selects production or sandbox. `startActivity` also takes the leg, creates its channel and returns it with the answer, deleting it if the start fails; the attributes and leg identify its internal backoff. `broadcast` and `deleteChannel` own the remaining Apple requests. Sender errors omit unsafe causes, and device requests omit HTTP client spans to keep tokens out of their URLs. Missing signing settings disable pushes with a warning. `shared/apns` exports only the native token schema and has no native module dependency.
