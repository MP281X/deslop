# Deslop app runtime

Every app installs with `npm install --global @deslop/<app>` and runs as `<app> service install --domain mp281x.xyz`; `<app> --help` lists the rest.

- **Secrets** go in `~/.deslop/<app>.env`, never in flags.
- **Node** comes from Vite+: the updater runs the npm beside it.
- **Priority.** On Linux the apps share `deslop.slice`: ten times an agent's CPU share under contention, and their first gigabyte spared from reclaim once the machine's slices above it carry the same protection.
- **macOS.** Keep a GUI user logged in, even when installing over SSH: launch agents start only at login.

## Server

- An app whose services call `AiGateway` provides `AiGateway.layer` in its own routes, so other servers do not bundle the model client.
- Run commands with `server/process.executeProcess`.
- An app whose RPC payloads exceed 1 MiB passes `runApp` a larger `maxFrameSize`.

## iPhone updates

- In the Expo app config, spread `iphoneUpdates(appUrl)` from `config/iphone`. Install `expo-updates` in the app; it downloads on launch and uses the download on the next launch. There is no Expo account or service.
- Call `runIPhoneBuild()` from `tooling/iphone` in the app's `bin/iphone.ts`. It prepares the iOS project with `prepare`; otherwise it exports the bundle and records its resolved runtime version. Use the same native project and config as the Xcode build so the fingerprints match.
- Ship `dist/iphone` in the same package as `dist/server.js`. The server offers that update only to clients on its fingerprint, through Auth like any other native request.

## Authorization

`server/auth.requireAdmin(user, message)` returns a branded `shared/auth.Admin`. Admin-only service methods take that value; admin RPC contracts declare `.middleware(RpcAdmin)` and their handlers read `CurrentAdmin`; MCP and HTTP handlers call `requireAdmin` before the service.

Check a built app's authorization with `node apps/<app>/dist/server.js probe`: it calls every route, RPC and MCP tool anonymously and as a member, on scratch data. `publicAccess` in `src/server/probe.ts` names the exceptions and their admitted callers; each surface must refuse every caller it doesn't admit. An entry whose caller the probe's fabricated request can't satisfy says why; an `admin` entry names a scratch-safe operation the probe runs as admin. A pass doesn't prove Auth's identity resolution, other inputs to the same surface, stateful MCP revisions, side effects before a refusal, or external providers.

## APNs

- Provide `layerApnsClient` to `Apns.layer` at the server entry; app services keep their own HTTP client, notification policy and per-device delivery records.
- Handle every `ApnsAnswer`. `ChannelGone`: nothing is owed for that channel. `TooLarge` (over Apple's 4 KB, never sent): never forget a token for it. Delete a channel again only after `deleteChannel` answers `Retry` or fails without an answer.
- A Live Activity start is three calls, so the app writes the channel down before the phone hears of it: `startHeld` (a start just told to retry or too large), `createChannel`, `startActivity(target, leg, channel, body)`. The app deletes channels; the runtime never does.

## Client clocks

Read time through `client/clock`'s `clockAtom(every)`, and pass that value to `shared/format`'s `ageOf` and `dayOf`.
