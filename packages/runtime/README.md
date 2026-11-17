# Deslop app runtime

Every Deslop app uses the same command line.

```bash
npm install --global @deslop/<app>
<app>                                   # run in the foreground on 127.0.0.1
<app> service install --domain mp281x.xyz # run as a user service that updates itself from npm
<app> service status | update | uninstall
```

Run `<app> --help` for settings and its README for app-specific setup. Put service secrets in `~/.deslop/<app>.env`, not command-line flags.

`--domain` (`DESLOP_DOMAIN`) takes a bare hostname. It derives the app's `https://<app>.<domain>` origin and Auth, Gateway and Scope origins on the same domain. Without it the app requires Tailscale, uses `https://<machine's tailnet name>:<port>` through Tailscale Serve and names every caller as the developer, an admin.

On macOS, a GUI user must be logged in even when installation runs over SSH: launch agents start at login, not before it. Uninstall preserves application data.

## APNs

Provide `layerApnsClient` to `Apns.layer` at the server entry; app services keep their own HTTP client and notification policy. `APNS_KEY` accepts PKCS#8 PEM or base64 DER. The registered bundle selects production or sandbox, not the server's environment.

Apps own per-device delivery records and exhaustively handle `shared/apns`'s `ApnsAnswer`: `Accepted`, `Retry`, `DeadToken` or `Refused`. Its shared `Device` model keeps tokens redacted. `mobile/push-token`'s `pushTokens(listener, readerEffect)` takes the app's Expo listener and initial-token reader; the runtime must not import `expo-notifications` and autolink it into every app.

## Client clocks

`client/clock` exports `clockAtom(every: Duration.Input): Atom<DateTime.Utc>`. Its first read is synchronous and current; the same cadence input shares a timer while observed. `client/problem` exports `problemSinceAtom(reader)`, an `Option<DateTime.Utc>` that starts on the reader's first failure and clears on recovery; mount it with the reader, not only its conditional error indicator. `shared/format`'s `dayOf(at, now)` takes the same explicit clock value as `ageOf`.
