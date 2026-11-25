# Deslop app runtime

Every app installs with `npm install --global @deslop/<app>` and runs as `<app> service install --domain mp281x.xyz`; `<app> --help` lists the rest.

- **Secrets** go in `~/.deslop/<app>.env`, never in flags.
- **Node** comes from Vite+: the updater runs the npm beside it.
- **Updates.** Each app checks npm once at boot, and Release has Deploy start every app's update after each publish (`POST /api/update`).
- **Priority.** On Linux the apps share `deslop.slice`: ten times an agent's CPU share under contention, and their first gigabyte spared from reclaim once the machine's slices above it carry the same protection.
- **macOS.** Keep a GUI user logged in, even when installing over SSH: launch agents start only at login.

## Server

- An app whose services call `AiGateway` provides `AiGateway.layer` in its own routes, so other servers do not bundle the model client.
- Run commands with `server/process.executeProcess`.
- An app whose RPC payloads exceed 1 MiB passes `runApp` a larger `maxFrameSize`.

## Authorization

`server/auth.requireAdmin(user, message)` returns a branded `shared/auth.Admin`. Admin-only service methods take that value; admin RPC contracts declare `.middleware(RpcAdmin)` and their handlers read `CurrentAdmin`; MCP and HTTP handlers call `requireAdmin` before the service.

Check a built app's authorization with `node apps/<app>/dist/server.js probe`: it calls every route, RPC and MCP tool anonymously and as a member, on scratch data. `publicAccess` in `src/server/probe.ts` names the exceptions and their admitted callers; each surface must refuse every caller it doesn't admit. An entry whose caller the probe's fabricated request can't satisfy says why; an `admin` entry names a scratch-safe operation the probe runs as admin. A pass doesn't prove Auth's identity resolution, other inputs to the same surface, stateful MCP revisions, side effects before a refusal, or external providers.

## APNs

- Provide `layerApnsClient` to `Apns.layer` at the server entry; app services keep their own HTTP client, notification policy and per-device delivery records.
- Handle every `ApnsAnswer`. `ChannelGone`: nothing is owed for that channel. `TooLarge` (over Apple's 4 KB, never sent): never forget a token for it. Delete a channel again only after `deleteChannel` answers `Retry` or fails without an answer.
- A Live Activity start is three calls, so the app writes the channel down before the phone hears of it: `startHeld` (a start just told to retry or too large), `createChannel`, `startActivity(target, leg, channel, body)`. The app deletes channels; the runtime never does.
- `mobile/push-token`'s `registerPushTokens` takes the app's Expo listener and initial-token reader; keep `expo-notifications` out of the runtime, which would autolink it into every app.

## Client clocks

Read time through `client/clock`'s `clockAtom(every)`, and pass that value to `shared/format`'s `ageOf` and `dayOf`. Mount `client/problem`'s `problemSinceAtom(reader)` with the reader, not only inside its conditional error indicator.
