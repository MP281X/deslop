# Stash

A personal link inbox for one iPhone. One app folder holds an Effect server for `dev` and an Expo iOS client with a Swift share extension.

## Server

- **Run.** `vp -C apps/stash run preview` builds `dist/server.js` and serves it on `127.0.0.1:5017`; `sudo tailscale serve --bg --https=8443 http://127.0.0.1:5017` publishes it as `https://dev.tailnet-8c4c.ts.net:8443`. The tailnet is the only sign-in, so never bind it to `0.0.0.0` on `dev`, which has a public address.
- **Environment.** `OPENROUTER_API_KEY` in `~/.deslop/stash.env` turns tagging on. `STASH_DATA_DIR` defaults to `~/.deslop/stash`, `STASH_AI_MODEL` to `openai/gpt-6-luna` and `STASH_AI_BUDGET_USD` to 1 per month.
- **Routes.** The app uses the JSON WebSocket RPC at `/api/rpc` and downloads previews from `/api/images/<id>`; the Swift extension posts `{id, text}` to `/api/capture`, because it cannot speak the RPC protocol.
- **Previews.** The server keeps each link's preview image on disk, because TikTok's image links expire within days.

## iOS client

- **No controls.** Links arrive only from the share sheet and from the clipboard when the app opens; there is no button, composer or editor. Swipe deletes; a long press opens or copies.
- **Theme.** Colors, square corners and JetBrains Mono follow the deslop shadcn theme in `packages/components/src/theme.css`, applied to `@expo/ui` SwiftUI views through `src/lib/theme.ts`.
- **Outbox.** The app and the share extension both write `pending/<id>.json` to the App Group container before sending. The client picks the id, so a resend never makes a second note.
- **Share extension.** `@bacons/apple-targets` adds `targets/share` at prebuild. It finds the server in the containing app's `StashServer` Info.plist key and the App Group as `group.<app bundle id>`; the fonts live there once for both targets.
- **Variants.** `APP_VARIANT` from `eas.json` picks the bundle id, App Group and name, so the three builds install side by side. `APPLE_TEAM_ID` comes from the project's EAS environment variables, and `eas init` writes the project ID into `app.json`.
- **Layout.** The folders follow `apps/portfolio`: `src/routes` holds the root, the list in `(home)` and the note detail, without a file router, and the icon. Expo needs `app.config.ts`, `app.json` and `eas.json` beside `package.json`, and `@bacons/apple-targets` reads `targets/`.
- **Releases.** After check and test pass on main for a change under `apps/stash` or the lockfile, `deploy.yaml` calls `.github/workflows/stash.yaml`. It runs `eas build --local` on GitHub's `xcode-27` runner and submits the result to TestFlight with the `EXPO_TOKEN` secret. The first production build ran by hand on EAS, because it created the signing credentials, the App Group and the App Store Connect app `6821336145`, which `submit.production.ios.ascAppId` names for non-interactive submission. Each release is version `0.1.<run>` with build number `<run>`, the run number of `deploy.yaml` that also versions the packages.

## Development build

`vp -C apps/stash run start` serves Metro on localhost only and writes the tailnet URL into its manifest; `sudo tailscale serve --bg --https=8081 http://localhost:8081` lets the iPhone's stash dev reach it. Use `localhost`, not `127.0.0.1`: Metro listens on `::1`.

## Checks without a Mac

```bash
vp -C apps/stash exec expo config --type public
vp -C apps/stash exec expo prebuild --platform ios --no-install --clean && rm -rf apps/stash/ios
vp -C apps/stash exec expo export --platform ios --output-dir /tmp/stash-export
```

The first EAS build is the first Swift compile.

## Decisions

| Rejected                                     | Reason                                                                                                 |
| -------------------------------------------- | ------------------------------------------------------------------------------------------------------ |
| `expo-sharing` and `expo-share-intent`       | Both open the main app to save; sharing from TikTok must not leave TikTok                              |
| `expo-share-extension` (React Native inside) | 6.0.0 is a beta with open crashes on SDK 57, and React Native in an extension costs most of its memory |
| React Navigation and `react-native-screens`  | `@expo/ui` gives SwiftUI's own stack, search and swipe actions                                         |
| Paste & Save button, composer, tag editor    | The owner wants no controls: links come only from sharing and the clipboard                            |
| A GitHub macOS runner without EAS            | Signing on fresh runners and App Group registration need manual Apple setup and stayed unproven        |
| EAS cloud builds from the workflow           | The free plan allows 15 iOS builds a month; macOS runners are free for this public repository          |
| Binary RPC serialization                     | The earlier web version failed to reopen a cancelled watch with it                                     |
| A PWA                                        | iOS gives a web app no share sheet entry                                                               |
