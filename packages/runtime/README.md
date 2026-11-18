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

Install with Node from Vite+: `service install` refuses a Node without npm beside it, which the updater runs. Install, update and uninstall of one app take turns. An update installs into a staging directory, promotes it only once npm installed the whole release, and checks that the restarted service serves the new version; otherwise it restarts the previous release and says whether that one serves again.

On macOS, a GUI user must be logged in even when installation runs over SSH: launch agents start at login, not before it. Uninstall stops a running update and preserves application data.

## Server entry

`runApp` takes `maxFrameSize` (a `ByteSize`, default 1 MiB) for an app whose RPC payloads are larger: the socket refuses a bigger message before any schema reads it. An app whose services call `AiGateway` provides `AiGateway.layer` in its own routes, so other servers do not bundle the model client.

`server/process.executeProcess(command, args, options?)` stops a command after 30 seconds and fails one that writes more than 4 MiB to stdout or stderr; `options.timeout` and `options.output` choose other bounds.

## Authorization contracts

`server/auth.requireAdmin(user, message)` returns a branded `shared/auth.Admin` capability. Admin-only service methods take that value; RPC contracts declare `.middleware(RpcAdmin)` and their handlers read `CurrentAdmin`. MCP and HTTP handlers obtain the capability with `requireAdmin` before calling the service.

Every built app binary has the same authorization check:

```bash
node apps/deploy/dist/server.js probe
```

`probe` starts the app's real server, migrations and handlers on an ephemeral loopback port, with temporary data, fixture identities and an isolated configuration provider containing no production credentials. It lists the routes registered on the router, the RPC contracts given to `layerRpc` and the tools given to `layerMcp`, compares MCP `tools/list` on the stateless revision with those tools, and calls each surface anonymously and as a member with one contract-derived input, from the app's own origin. Subscriptions stop after their first answer.

The single `publicAccess` list in `src/server/probe.ts` names exceptions and their admitted callers: public pages, protocols, sign-in, presence and ingestion permit anonymous callers; personal APIs permit members but still refuse anonymous callers. Every unnamed surface must refuse a caller it does not name with 401, 403, a sign-in redirect, an `AuthError` or an admin-only tool result. Every named surface must not refuse the callers it names, unless its entry says why the probe's fabricated request is refused; a domain failure on empty data counts as admitted. An `admin` entry names a scratch-safe admin operation the probe runs as admin. Every app-specific entry must name a surface the app registers.

A pass proves the runtime's middleware and the inventory agree on those requests. It does not prove Auth's identity resolution, other inputs to the same surface (one suffix stands for a `*` route), the stateful MCP revisions, side effects before a refusal, or external providers.

## APNs

Provide `layerApnsClient` to `Apns.layer` at the server entry; app services keep their own HTTP client and notification policy. `APNS_KEY` accepts PKCS#8 PEM or base64 DER. The registered bundle selects production or sandbox, not the server's environment.

Apps own per-device delivery records and exhaustively handle `shared/apns`'s `ApnsAnswer`: `Accepted`, `Retry`, `DeadToken`, `Refused` or `TooLarge`. `TooLarge` is a payload over Apple's 4 KB, answered without asking Apple; it is never a reason to forget a token. An expired provider token is renewed and answered `Retry`. `deleteChannel` returns Apple's answer: only `Retry` leaves the channel to delete again. A start that is not `Accepted` still names its channel when deleting it was not confirmed, for the app to delete later. Its shared `Device` model keeps tokens redacted. `mobile/push-token`'s `registerPushTokens(listener, readerEffect, register)` takes the app's Expo listener, its initial-token reader and the effect that registers a token, and runs while mounted; the runtime must not import `expo-notifications` and autolink it into every app.

## Client clocks

`client/clock` exports `clockAtom(every: Duration.Input): Atom<DateTime.Utc>`. Its first read is synchronous and current; the same cadence input shares a timer while observed. `client/problem` exports `problemSinceAtom(reader)`, an `Option<DateTime.Utc>` that starts on the reader's first failure and clears on recovery; mount it with the reader, not only its conditional error indicator. `shared/format`'s `dayOf(at, now)` takes the same explicit clock value as `ageOf`.
