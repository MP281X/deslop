# Stash

A personal link inbox for one iPhone, and a CLI that reads what a video or social post says. One package holds the Effect server for `dev`, the Expo iOS client with a Swift share extension, and the `stash` command.

## CLI

Runs on Linux or macOS (x64 or arm64) with Node 26+ and `ffmpeg` on `PATH`.

```bash
vpx @deslop/stash@latest media '<url>' [output directory] [--language it]
```

| Output           | Content                                                                                                  |
| ---------------- | -------------------------------------------------------------------------------------------------------- |
| `info.md`        | Title, author, date, duration, description and chapters; the text of an X post and of the post it quotes |
| `transcript.txt` | One `[mm:ss] text` line per caption or speech segment                                                    |

The output directory defaults to `/tmp/media`. The spoken language comes from `--language`, the video's original caption track or its declared language, defaulting to English, and published captions in that language win. Without them, the audio is transcribed locally with Whisper `small.en`, in about a quarter of the audio's duration (a 38-minute talk took 9 minutes on an 8-core server). Speech that is not English uses the multilingual Whisper model.

The first run downloads the standalone `yt-dlp`, and the first transcription the Whisper model, into `$XDG_CACHE_HOME/deslop/media` (`~/.cache` by default); later runs update `yt-dlp` in place. When YouTube refuses the connection, as it does for most datacenter addresses, `info.md` holds only the oEmbed title and channel. A URL nothing can be read from fails.

## Server

- **Run.** `vp -C apps/stash run preview` builds `dist/server.js` and serves it on `127.0.0.1:5017`; `sudo tailscale serve --bg --https=8443 http://127.0.0.1:5017` publishes it as `https://dev.tailnet-8c4c.ts.net:8443`. The tailnet is the only sign-in, so never bind it to `0.0.0.0` on `dev`, which has a public address.
- **Environment.** `OPENROUTER_API_KEY` in `~/.deslop/stash.env` turns tagging on. `STASH_DATA_DIR` defaults to `~/.deslop/stash`, `STASH_AI_MODEL` to `openai/gpt-6-luna` and `STASH_AI_BUDGET_USD` to 1 per month.
- **Routes.** The app uses the JSON WebSocket RPC at `/api/rpc` and downloads previews from `/api/images/<id>`; the Swift extension posts `{id, text}` to `/api/capture`, because it cannot speak the RPC protocol.
- **Previews.** The server keeps each link's preview image on disk, because TikTok's image links expire within days.
- **Video stills.** Six stills sampled across a TikTok, X or YouTube video go to the tagging model at low detail, so the title, summary and tags cover what the video only shows; a TikTok cost $0.0004 to tag this way.
- **Transcripts.** A TikTok, X or YouTube note keeps what its video says, read like the CLI does, so tags and search cover it. Without captions, Whisper transcribes audio up to 30 minutes long, one video at a time.

## iOS client

- **No controls.** Links arrive only from the share sheet and from the clipboard when the app opens; there is no button, composer or editor. Swipe deletes; a long press opens or copies.
- **Theme.** Colors, square corners and JetBrains Mono follow the deslop shadcn theme in `packages/components/src/theme.css`, applied to `@expo/ui` SwiftUI views through `src/lib/theme.ts`.
- **Outbox.** The app and the share extension both write `pending/<id>.json` to the App Group container before sending. The client picks the id, so a resend never makes a second note.
- **Share extension.** `@bacons/apple-targets` adds `targets/share` at prebuild. It finds the server in the containing app's `StashServer` Info.plist key and the App Group as `group.<app bundle id>`; the fonts live there once for both targets.
- **Variants.** `APP_VARIANT` from `eas.json` picks the bundle id, App Group and name, so the three builds install side by side. `APPLE_TEAM_ID` comes from the project's EAS environment variables; `app.config.ts` names the EAS project.
- **Updates.** JavaScript-only changes reach the installed build with `APP_VARIANT=production vpx eas-cli update --channel production --environment production --message '<what changed>'` from `apps/stash`, in about a minute. The runtime version is a fingerprint of the native project and `targets/share`, so a native change needs a new build first; the variant and the EAS environment must match the build's, or the fingerprint differs.
- **Layout.** The folders follow `apps/portfolio`: `src/routes` holds the root, the list in `(home)` and the note detail, without a file router, and the icon. Expo needs `app.config.ts`, `app.json` and `eas.json` beside `package.json`, and `@bacons/apple-targets` reads `targets/`.
- **Releases.** After check and test pass on main for a change under `apps/stash` or the lockfile, `deploy.yaml` calls `.github/workflows/stash.yaml`. It runs `eas build --local` on GitHub's `xcode-27` runner and submits the result to TestFlight with the `EXPO_TOKEN` secret. The first production build ran by hand on EAS, because it created the signing credentials, the App Group and the App Store Connect app `6821336145`, which `submit.production.ios.ascAppId` names for non-interactive submission. Each release is version `0.1.<run>` with build number `<run>`, the run number of `deploy.yaml` that also versions the npm package.

## Development build

`vp -C apps/stash run start` serves Metro on localhost only and writes the tailnet URL into its manifest; `sudo tailscale serve --bg --https=8081 http://localhost:8081` lets the iPhone's stash dev reach it. Use `localhost`, not `127.0.0.1`: Metro listens on `::1`.

## Checks without a Mac

```bash
vp -C apps/stash exec expo config --type public
vp -C apps/stash exec expo prebuild --platform ios --no-install --clean && rm -rf apps/stash/ios
vp -C apps/stash exec expo export --platform ios --output-dir /tmp/stash-export
```

The first EAS build is the first Swift compile.

<details>
<summary>For agents</summary>

| Owner            | Decision                                                                                                                                                                                                                                                                 |
| ---------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Package          | Published as `@deslop/stash` with the `stash` bin; app dependencies are `devDependencies`, bundled by `vp pack` or by Metro. Only ONNX Runtime, sharp and the Expo, React and React Native packages that `expo prebuild` requires in `dependencies` install with the CLI |
| `services/media` | `yt-dlp` stays an external binary because no maintained JavaScript extractor covers its sites. The iOS client never imports it: Metro must not reach Transformers.js, ONNX or child processes                                                                            |
| Transcription    | Transformers.js with q8 Whisper, bundled because it imports `onnxruntime-common` without declaring it and `pnpm dlx` (pnpm 11) cannot resolve that. Update Transformers.js `4.3.0`, `onnxruntime-common`, `onnxruntime-node` and sharp together                          |
| Publishing       | Follows [tools/AGENTS.md](../../tools/AGENTS.md); the package replaced `@deslop/media`                                                                                                                                                                                   |

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
| A separate `tools/media` package             | Stash reads the same links; one package keeps one extractor, and notes get the transcripts             |

</details>
