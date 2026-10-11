# Stash

A personal inbox for links, written notes, photos and videos on one iPhone, and a CLI that saves to it. One package holds the Effect server for `dev`, the Expo iOS client with a Swift share extension, and the `stash` command.

## CLI

Needs Node 26+ and the tailnet.

```bash
vpx @deslop/stash@latest save '<link or text>' [--server <url>]
```

The CLI saves the entry through the server's RPC, waits until the server has read and tagged it, and prints the note as Markdown on stdout: title, author, link, tags, summary, the AI's notes, topics, words in the images, the source it read and the `[mm:ss]` transcript. Progress goes to stderr. The server defaults to `STASH_SERVER`, then `https://dev.tailnet-8c4c.ts.net:8443`.

## Server

- **Run.** `vp -C apps/stash run preview` builds `dist/server.js` and serves it on `127.0.0.1:5017`; `sudo tailscale serve --bg --https=8443 http://127.0.0.1:5017` publishes it on the tailnet. The tailnet is the only sign-in, so never bind it to `0.0.0.0` on `dev`, which has a public address.
- **Environment.** `~/.deslop/stash.env` holds the variables in [.env.example](.env.example). `ANTHROPIC_API_KEY` turns tagging on; without it a note fails with the reason. `STASH_AI_MODEL` defaults to `claude-haiku-5-5`, at high effort. `STASH_DATA_DIR` defaults to `~/.deslop/stash`.
- **Media.** The server runs the `yt-dlp` on `PATH` and downloads the Whisper model into `$XDG_CACHE_HOME/deslop/media` on first use. Published captions win; Whisper `small.en` takes about a quarter of the audio's length, up to two hours of audio. `STASH_MEDIA_PROXY` lists proxies, separated by commas; `yt-dlp` starts with the one that last got through and moves on when a site blocks it. On `dev` it lists the five Mullvad proxies from the environment skill.
- **Storage.** SQLite at `stash.db` in `STASH_DATA_DIR`, one row per note, without migrations: a change to its shape can drop it. Previews and uploaded files sit beside it in `images/` and `files/`.
- **Sync.** `notes.watch` sends every note's list fields once, then only the notes that changed, at most every 400 ms. `notes.get` loads the long texts and `notes.search` searches transcripts and pages on the server.
- **Routes.** The app uses the JSON WebSocket RPC at `/api/rpc` and loads previews from `/api/images/<id>`. The share extension posts `{id, text}` to `/api/capture`. Photos and videos arrive as the raw body of `/api/files/<id>`.
- **Organizer.** Claude reads each entry as a developer would: a title of at most 32 characters, a one-line summary, one to three tags, search topics, two to six lines of notes, and the words in the images. The preview and six video stills go with it. A short link resolves before saving, so another share of the same post finds the saved note.

## iOS client

- **Capture.** Links, text, photos and videos arrive from the share sheet, which uploads in a background session and closes at once. When the app opens with a new link or image copied, a sheet asks whether to save it; the clipboard is read only after Save, so iOS shows its paste banner only then. The pencil writes a note.
- **List.** The layout follows iOS Mail: tag chips filter apart from search, and the bottom bar holds the kind filter, the search field and write. A long press opens the note in its app, regenerates or deletes it; swipe deletes. A note the server could not read shows why, and a tap retries it.
- **Note page.** The title sits in the bar and the app's logo opens the link. Below come the preview, the tags and the AI's notes. Pulling down regenerates the note.
- **Native module.** `modules/native` checks the clipboard without reading it and adds the bottom-bar search field through `@expo/ui`'s modifier API. The logos come from `@deslop/components-mobile`, which renders svgl's SVGs natively and cuts out their white parts for menu icons.
- **Share extension.** `@bacons/apple-targets` adds `targets/share` at prebuild. It finds the server in the app's `StashServer` Info.plist key and uploads from the App Group `group.<app bundle id>`. A failed background upload is not reported, because the sheet has already closed.
- **Variants.** `APP_VARIANT` from `eas.json` picks `development` or `production`; the development build installs beside the TestFlight one. `APPLE_TEAM_ID` comes from the EAS environment.

## Releases

On main, `deploy.yaml` compares `apps/stash`, `packages` and the lockfile with the commit of the last EAS Update. When they changed, a known native fingerprint ships the JavaScript as a new update; a new one first builds on GitHub's `xcode-27` runner with `eas build --local` and submits to TestFlight. A newer merge cancels the older run, and the next one ships both. Each release is version `0.1.<run>` with build number `<run>`.

## Development build

`vp -C apps/stash run dev` serves Metro on localhost and writes the tailnet URL into its manifest; `sudo tailscale serve --bg --https=8081 http://localhost:<Metro port>` lets stash dev reach it. Metro picks 8082 when that serve already holds 8081, so point it at the port Metro prints. Use `localhost`, not `127.0.0.1`: Metro listens on `::1`.

On the iOS Simulator, each branch push leaves the build as the artifact `stash-simulator-<fingerprint>`:

```bash
gh run download <run id> --name stash-simulator-<fingerprint> --dir /tmp/stash-sim && tar -xzf /tmp/stash-sim/simulator.tar.gz -C /tmp/stash-sim
<agent-device> install xyz.mp281x.stash.dev /tmp/stash-sim/stashdev.app <flags>
<agent-device> open xyz.mp281x.stash.dev 'stash-dev://expo-development-client/?url=https%3A%2F%2F<worker>.tailnet-8c4c.ts.net%3A8081' <flags>
<agent-device> alert accept <flags>
```

`device_open` returns the `agent-device` command and its flags. The first open asks to open the link in stash dev, and the first launch shows the developer menu.

## Checks before a build

```bash
vp -C apps/stash exec expo config --type public
vp -C apps/stash exec expo prebuild --platform ios --no-install --clean && rm -rf apps/stash/ios
vp -C apps/stash exec expo export --platform ios --output-dir /tmp/stash-export
```

A Swift change compiles first in the simulator build on CI.

<details>
<summary>For agents</summary>

| Owner         | Decision                                                                                                                                                                                   |
| ------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Package       | Published as `@deslop/stash`; app dependencies are `devDependencies`. ONNX Runtime and sharp stay external through `deps.neverBundle`, because only the server loads them                  |
| Media         | `yt-dlp` stays an external binary because no maintained JavaScript extractor covers its sites. The iOS client never imports `services/media`                                               |
| Transcription | Update Transformers.js `4.3.0`, `onnxruntime-common`, `onnxruntime-node` and sharp together                                                                                                |
| Fingerprint   | `fingerprint.config.js` adds `targets/share`, whose Swift the Expo fingerprint does not read                                                                                               |
| Toolbar order | `@expo/ui` shows the outermost toolbar's items first, so the list nests one `Toolbar` for write inside the one for the filter, with the search modifier between them; unproven until build |

| Rejected                                | Reason                                                                                        |
| --------------------------------------- | --------------------------------------------------------------------------------------------- |
| `expo-sharing` and `expo-share-intent`  | Both open the main app to save; sharing from TikTok must not leave TikTok                     |
| React Native inside the share extension | It costs most of the extension's memory                                                       |
| A patch of `@expo/ui`                   | A patch breaks with each upgrade; the local module uses the public extension API              |
| EAS cloud builds from the workflow      | The free plan allows 15 iOS builds a month; macOS runners are free for this public repository |
| Binary RPC serialization                | It failed to reopen a cancelled watch                                                         |
| An app outbox                           | The extension uploads in a background session, and the app saves through the RPC directly     |
| `yt-dlp` and Whisper inside the CLI     | API keys and models live on the server, and every analysis stays a note                       |

</details>
