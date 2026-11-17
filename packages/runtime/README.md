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

## Authorization contracts

`server/auth.requireAdmin(user, message)` returns a branded `shared/auth.Admin` capability. Admin-only service methods take that value; RPC contracts declare `.middleware(RpcAdmin)` and their handlers read `CurrentAdmin`. MCP and HTTP handlers obtain the capability with `requireAdmin` before calling the service.

Every built app binary has the same authorization check:

```bash
node apps/deploy/dist/server.js probe
```

`probe` starts the app's real server, migrations and handlers on an ephemeral loopback port, with temporary data, fixture identities and an isolated configuration provider containing no production credentials. It lists registered routes and RPC contracts, compares MCP `tools/list` with the toolkit contracts supplied to `layerMcp`, and calls each surface anonymously and as a non-admin using contract-derived inputs. Subscriptions stop after their first answer.

The single `publicAccess` list in `src/server/probe.ts` names exceptions and their admitted callers: public pages, protocols, sign-in, presence and ingestion permit anonymous callers; personal APIs permit members but still refuse anonymous callers. Every unnamed surface must refuse both. This checks authorization enforcement, not Auth's identity resolution or external provider integrations.

## APNs

Provide `layerApnsClient` to `Apns.layer` at the server entry; app services keep their own HTTP client and notification policy. `APNS_KEY` accepts PKCS#8 PEM or base64 DER. The registered bundle selects production or sandbox, not the server's environment.

Apps own per-device delivery records and exhaustively handle `shared/apns`'s `ApnsAnswer`: `Accepted`, `Retry`, `DeadToken` or `Refused`. Its shared `Device` model keeps tokens redacted. `mobile/push-token`'s `pushTokens(listener, readerEffect)` takes the app's Expo listener and initial-token reader; the runtime must not import `expo-notifications` and autolink it into every app.

## Client clocks

`client/clock` exports `clockAtom(every: Duration.Input): Atom<DateTime.Utc>`. Its first read is synchronous and current; the same cadence input shares a timer while observed. `client/problem` exports `problemSinceAtom(reader)`, an `Option<DateTime.Utc>` that starts on the reader's first failure and clears on recovery; mount it with the reader, not only its conditional error indicator. `shared/format`'s `dayOf(at, now)` takes the same explicit clock value as `ageOf`.
