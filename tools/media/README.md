# Media

Extracts what a video or social post says, so an agent can analyze the source instead of a summary. Requires Node 26+ and `ffmpeg` on `PATH`.

```bash
vpx @deslop/media@latest '<url>' [output directory] [--language it]
```

| Output           | Content                                                                                                  |
| ---------------- | -------------------------------------------------------------------------------------------------------- |
| `info.md`        | Title, author, date, duration, description and chapters; the text of an X post and of the post it quotes |
| `transcript.txt` | One `[mm:ss] text` line per caption or speech segment                                                    |

The output directory defaults to `node_modules/.cache/deslop/media`. The CLI prefers published English captions. Without them, it downloads the audio and transcribes it locally with Whisper `small.en`, in about a quarter of the audio's duration (a 38-minute talk took 9 minutes on an 8-core server). `--language <code>` switches to the multilingual Whisper model for other spoken languages.

The first run downloads the standalone `yt-dlp` and the Whisper model into `~/.cache/deslop/media`; later runs update `yt-dlp` in place. YouTube asks datacenter addresses to sign in, so on a server only its oEmbed title and channel are available; X, TikTok and most other sites work.

<details>
<summary>For agents</summary>

| Owner         | Decision                                                                                                                                                                                                                                                                  |
| ------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `src/cli.ts`  | One Effect CLI; `yt-dlp` stays an external binary because no maintained JavaScript extractor covers its sites                                                                                                                                                             |
| Transcription | Transformers.js with q8 Whisper, bundled because it imports `onnxruntime-common` without declaring it and `pnpm dlx` (pnpm 11) cannot resolve that. Its runtime dependencies become ours at the exact versions Transformers.js `4.3.0` declares; update all four together |
| Proof         | Real runs against a captioned post, an uncaptioned video and a blocked YouTube URL through the packed tarball                                                                                                                                                             |

Publishing follows [tools/AGENTS.md](../AGENTS.md).

</details>
