# Stash

A personal inbox for links, written notes, photos and videos on one iPhone, and a CLI that saves to it. One package holds the Effect server for `dev`, the Expo iOS client with a Swift share extension, and the `stash` command.

## CLI

Runs on Linux or macOS (x64 or arm64) with Node 26+ on the tailnet.

```bash
vpx @deslop/stash@latest save '<link or text>' [--server <url>]
```

The CLI is a client of the server: it saves the entry as a note through the RPC, waits until the server has read and tagged it, and prints the note as Markdown on stdout: title, author, link, tags, summary, the AI's notes, topics, words in the images, the source it read and the `[mm:ss]` transcript. Progress goes to stderr. API keys, `yt-dlp` and Whisper stay on the server. The server defaults to `STASH_SERVER`, then `https://dev.tailnet-8c4c.ts.net:8443`.

## Server

- **Run.** `vp -C apps/stash run preview` builds `dist/server.js` and serves it on `127.0.0.1:5017`; `sudo tailscale serve --bg --https=8443 http://127.0.0.1:5017` publishes it as `https://dev.tailnet-8c4c.ts.net:8443`. The tailnet is the only sign-in, so never bind it to `0.0.0.0` on `dev`, which has a public address.
- **Environment.** `ANTHROPIC_API_KEY` or `OPENROUTER_API_KEY` in `~/.deslop/stash.env` turns tagging on; the Anthropic key wins. `STASH_AI_MODEL` defaults to `claude-haiku-5-5` at high effort with the Anthropic key and to `openai/gpt-6-luna` with OpenRouter. `STASH_AI_BUDGET_USD` defaults to 50 a month with the Anthropic key and 5 without. `STASH_DATA_DIR` defaults to `~/.deslop/stash`.
- **Media.** The first link with a video downloads the standalone `yt-dlp`, and the first transcription the Whisper model, into `$XDG_CACHE_HOME/deslop/media` (`~/.cache` by default). Published captions win; Whisper `small.en` takes about a quarter of the audio's length (a 38-minute talk took 9 minutes), and speech that is not English uses the multilingual model. YouTube refuses most datacenter addresses, so a YouTube note often has only the oEmbed title and channel. `STASH_MEDIA_PROXY` lists proxies, separated by commas; `yt-dlp` starts with the one that last got through and moves to the next when a site blocks it or a proxy cannot connect. On `dev` it lists the five Mullvad proxies that the environment skill's maintenance reference describes.
- **Storage.** Notes live in SQLite at `stash.db` in `STASH_DATA_DIR`, one row each, so a change writes only the notes it touched. A server from before the database imports `notes.json` once and renames it `notes.json.imported`. With 3,000 synthetic notes (25 MB of text), the server starts in 0.7 seconds, saves a capture in 30 ms and searches in 20 ms.
- **Sync.** `notes.watch` sends every note's list fields once (1.4 MB for those 3,000 notes), then only the notes that changed, at most every 400 ms. The note page loads the long texts with `notes.get`, and `notes.search` searches transcripts and pages on the server.
- **Routes.** The app uses the JSON WebSocket RPC at `/api/rpc` and downloads previews from `/api/images/<id>`; the Swift extension posts `{id, text}` to `/api/capture`, because it cannot speak the RPC protocol. Both post a photo or video as the raw body of `/api/files/<id>`, typed `image/jpeg`, `image/png`, `video/mp4` or `video/quicktime`.
- **Organizer.** The model, with medium reasoning, writes the title, summary, tags, topics and a body of every useful fact as direct notes, not narration about the author, and copies the words in the images into `screenText`. Every image goes at full detail, with up to 150,000 characters each of the source and the transcript. Claude gets the same images as base64 and a schema without length limits, which it rejects.
- **Revisions.** `revision` in `organization.ts` names the instructions. On start, the server tags every ready note from an older revision again, so raise it with each change to the instructions or the inputs.
- **Files.** A video file gets the six stills and a Whisper transcript, and its first still becomes the preview.
- **Previews.** The server keeps each link's preview image on disk, because TikTok's image links expire within days.
- **Video stills.** Six stills sampled across a TikTok, X or YouTube video go to the tagging model at low detail, so the title, summary and tags cover what the video only shows; a TikTok cost $0.0004 to tag this way.
- **Transcripts.** A TikTok, X or YouTube note keeps what its video says, so tags and search cover it. Without captions, Whisper transcribes audio up to two hours long, one video at a time. The video's details (date, length, description, chapters) replace a TikTok or YouTube caption as the note's source.

## iOS client

- **Capture.** Links, text, photos and videos arrive from the share sheet. When the app opens with a new link or image copied, a small sheet asks whether to save it. `modules/pasteboard`, a local native module, checks the clipboard's change count and kind without reading it, so iOS shows its paste banner only after Save; Not Now holds for that copy until the app restarts. The pencil in the bottom bar writes a note, which the AI rewrites as short lines.
- **List.** The layout follows iOS Mail. Tag chips on top filter apart from search. The bottom bar holds the kind filter, the search field and write, parted by fixed spacers. A long press opens the system menu, and swipe deletes. The long-press menu opens the note in its app, regenerates it from its source, or deletes it; menus show the apps' logo shapes in the text color.
- **Note page.** The note's title sits in the bar, and the app's logo at the top right opens the link. Below come the preview, the tags and one summary: the AI's notes, or the one-line summary. Pulling the page down regenerates the note from its source.
- **Theme.** Colors, square corners and JetBrains Mono follow the deslop shadcn theme in `packages/components/src/theme.css`, applied to `@expo/ui` SwiftUI views through `@deslop/components/mobile/theme`. Brand logos come from svgl through `@deslop/components/mobile/brand`.
- **Outbox.** The app and the share extension both write `pending/<id>.json` to the App Group container before sending, with a photo or video beside it as `pending/<id>.<ext>`. The client picks the id, so a resend never makes a second note.
- **Share extension.** `@bacons/apple-targets` adds `targets/share` at prebuild. It finds the server in the containing app's `StashServer` Info.plist key and the App Group as `group.<app bundle id>`; the fonts live there once for both targets.
- **Variants.** `APP_VARIANT` from `eas.json` picks the bundle id, App Group and name, so the three builds install side by side. `APPLE_TEAM_ID` comes from the project's EAS environment variables; `app.config.ts` names the EAS project.
- **Updates.** JavaScript-only changes reach the installed build with `APP_VARIANT=production vpx eas-cli update --channel production --environment production --message '<what changed>'` from `apps/stash`, in about a minute. The runtime version is a fingerprint of the native project, `targets/share` and the repository's `patches`, so a native change needs a new build first; the variant and the EAS environment must match the build's, or the fingerprint differs. The app checks for an update at each launch and each return to the foreground, and restarts into it at once.
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

| Owner            | Decision                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| ---------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Package          | Published as `@deslop/stash` with the `stash` bin; app dependencies are `devDependencies`, bundled by `vp pack` or by Metro. `dependencies` hold what `vp pack` must leave external, ONNX Runtime and sharp for the server, and the Expo, React and React Native packages that `expo prebuild` requires. The CLI imports only the RPC contracts                                                                                                                              |
| `services/media` | `yt-dlp` stays an external binary because no maintained JavaScript extractor covers its sites. The iOS client never imports it: Metro must not reach Transformers.js, ONNX or child processes                                                                                                                                                                                                                                                                                |
| Transcription    | Transformers.js with q8 Whisper runs on the server; `dist/server.js` loads ONNX Runtime and sharp as external packages, because bundling sharp breaks its native binding. Update Transformers.js `4.3.0`, `onnxruntime-common`, `onnxruntime-node` and sharp together                                                                                                                                                                                                        |
| Publishing       | Follows [tools/AGENTS.md](../../tools/AGENTS.md); the package replaced `@deslop/media`                                                                                                                                                                                                                                                                                                                                                                                       |
| `@expo/ui` patch | `patches/@expo__ui@58.0.15.patch` adds `kind="search"`, `kind="spacer"` and `kind="fixed-spacer"` to `ToolbarItem`, keeps toolbar items in written order, and gives `List` a writable edit mode through `editing` and `onEditingChange`, and loads an image named `@3x` at that scale and one named `.template` in the text color. `expo.autolinking.ios.buildFromSource` in `package.json` builds `ExpoUI` from source, because the precompiled framework ignores the patch |

| Rejected                                     | Reason                                                                                                     |
| -------------------------------------------- | ---------------------------------------------------------------------------------------------------------- |
| `expo-sharing` and `expo-share-intent`       | Both open the main app to save; sharing from TikTok must not leave TikTok                                  |
| `expo-share-extension` (React Native inside) | 6.0.0 is a beta with open crashes on SDK 57, and React Native in an extension costs most of its memory     |
| React Navigation and `react-native-screens`  | `@expo/ui` gives SwiftUI's own stack, search and swipe actions                                             |
| A GitHub macOS runner without EAS            | Signing on fresh runners and App Group registration need manual Apple setup and stayed unproven            |
| EAS cloud builds from the workflow           | The free plan allows 15 iOS builds a month; macOS runners are free for this public repository              |
| Binary RPC serialization                     | The earlier web version failed to reopen a cancelled watch with it                                         |
| A PWA                                        | iOS gives a web app no share sheet entry                                                                   |
| A separate `tools/media` package             | Stash reads the same links; one package keeps one extractor, and notes get the transcripts                 |
| `yt-dlp` and Whisper inside the CLI          | The CLI saves through the server, so API keys and models live in one place and every analysis stays a note |

</details>
