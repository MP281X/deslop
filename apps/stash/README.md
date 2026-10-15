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
- **Environment.** `~/.deslop/stash.env` holds the variables in [.env.example](.env.example). `ANTHROPIC_API_KEY` turns tagging on; without it a note fails with the reason. Tagging uses `claude-haiku-5-5` at high effort through `@effect/ai-anthropic`. `STASH_DATA_DIR` defaults to `~/.deslop/stash`.
- **Media.** The server runs the `yt-dlp` on `PATH` and downloads the Whisper model into `$XDG_CACHE_HOME/deslop/media` on first use. Published captions win; Whisper `small.en` takes about a quarter of the audio's length, up to two hours of audio. TikTok, X, YouTube and Instagram links go through `yt-dlp`, also when their page could not be read.
- **Proxy.** When `STASH_PROXY` holds an `http://` proxy URL, every request for a source exits through it: `yt-dlp`, pages, APIs, preview images and the reader. Without it, the server reads with its own address. `{session}` in the URL becomes a new random value for each `yt-dlp` run and each request, so a rotating residential proxy keeps one exit address while a run downloads. A request that a site blocks, or that the exit drops, retries twice from new exit addresses. On `dev` it is the owner's [DataImpulse](https://app.dataimpulse.com) residential plan "stash": pay-as-you-go traffic that never expires, with `__sessid.{session}` after the login.
- **Sources.** Web pages become Markdown with their headings, lists and link targets. GitHub repositories give their README, issues and pull requests their comments, X posts their long-form articles, and TikTok photo posts every slide. A page that holds no text, such as a JavaScript app or a PDF, goes to the [Jina Reader](https://jina.ai/reader/), which also takes blocked pages; its bot-check pages count as failures.
- **Storage.** SQLite at `stash.db` in `STASH_DATA_DIR`, one row per note, without migrations: a change to its shape can drop it. Previews and uploaded files sit beside it in `images/` and `files/`.
- **Sync.** `notes.watch` sends every note's list fields once, then only the notes that changed, at most every 400 ms. `notes.get` loads the long texts and `notes.search` searches transcripts and pages on the server.
- **Routes.** The app uses the JSON WebSocket RPC at `/api/rpc` and loads previews from `/api/images/<id>`. The share extension posts `{id, text}` to `/api/capture`. Photos and videos arrive as the raw body of `/api/files/<id>`.
- **Organizer.** Claude reads each entry as a developer would and writes the notes the owner reads instead of the source: a plain title of at most 32 characters, a one-sentence summary, one to three tags, search topics, short Markdown notes of at most 10 lines (facts, steps, bold names and links, with headings only for long sources), and the words in the images. The preview, the photo post's slides and 12 evenly spaced video stills, up to 768 pixels wide, go with it. A short link resolves before saving, so another share of the same post finds the saved note.

## iOS client

- **Capture.** Links, text, photos and videos arrive from the share sheet, which uploads in a background session and closes at once. When the app opens with a new link or image copied, a sheet asks whether to save it; the clipboard is read only after Save, so iOS shows its paste banner only then. The sheet closes as soon as either button is pressed. The pencil writes a note.
- **List.** The layout follows iOS Mail: tag chips filter apart from search, and the bottom bar holds the kind filter, the search field and write. A row shows the title, two lines of summary, the author and the date; a note being read shows its title, a redacted summary and the byline. A long press opens the note in its app, regenerates or deletes it; swipe deletes. Search keeps the last results on screen while the next ones load.
- **Note page.** A reading page like Mail's message: preview, title, author, app and date, the summary, then the AI's notes in the system body font, with headings, bold names and tappable links. Tags follow; the transcript, the source text and the words in the images stay on the server for search and the CLI. The app's logo opens the link; the menu shares, regenerates or deletes. A note the server could not read shows why and a Try Again button.
- **Native module.** `modules/native` checks the clipboard without reading it and adds the bottom-bar search field through `@expo/ui`'s modifier API. The logos come from `@deslop/components-mobile`, which renders svgl's SVGs natively and cuts out their white parts for menu icons.
- **Share extension.** `@bacons/apple-targets` adds `targets/share` at prebuild. It finds the server in the app's `StashServer` Info.plist key and uploads from the App Group `group.<app bundle id>`. A failed background upload is not reported, because the sheet has already closed.
- **Variants.** `APP_VARIANT` from `eas.json` picks `development` for the simulator build, as `stash dev` with the bundle identifier `xyz.mp281x.stash.dev`, or `production`. `APPLE_TEAM_ID` comes from the EAS environment.

## Releases

On main, `deploy.yaml` compares `apps/stash`, `packages` and the lockfile with the commit of the last EAS Update. When they changed, a known native fingerprint ships the JavaScript as a new update; a new one first builds on GitHub's `xcode-27` runner with `eas build --local` and submits to TestFlight. A newer merge cancels the older run, and the next one ships both. Each release is version `0.1.<run>` with build number `<run>`.

## Simulator

CI builds the app for the iOS Simulator once per native fingerprint, as the artifact `stash-simulator-<fingerprint>` of the branch's CI run. The app holds the JavaScript of the commit that built it, so replace its bundle with the branch's own before you install it. `device_open` returns the `agent-device` command and its flags.

```bash
gh run download <run id> --name stash-simulator-<fingerprint> --dir /tmp/stash-sim && tar -xzf /tmp/stash-sim/simulator.tar.gz -C /tmp/stash-sim
APP_VARIANT=development vp -C apps/stash exec expo export:embed --platform ios --dev false --bundle-output /tmp/stash-sim/stashdev.app/main.jsbundle --assets-dest /tmp/stash-sim/stashdev.app
<agent-device> install xyz.mp281x.stash.dev /tmp/stash-sim/stashdev.app <flags>
<agent-device> open xyz.mp281x.stash.dev <flags>
```

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
| Transcription | Update Transformers.js, `onnxruntime-common`, `onnxruntime-node` and sharp together                                                                                                        |
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
| Mozilla Readability for web pages       | It needs a DOM library; the cheerio Markdown walker keeps headings and links without one      |
| Reddit and Hacker News readers          | The owner saves neither                                                                       |
| `yt-dlp --impersonate chrome`           | It changed no result on the 21 probe links                                                    |

</details>
