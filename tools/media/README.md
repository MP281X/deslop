# Media

Extracts what a video or social post says, so an agent can analyze the source instead of a summary. Runs on Linux or macOS (x64 or arm64) with Node 26+ and `ffmpeg` on `PATH`.

```bash
vpx @deslop/media@latest '<url>' [output directory] [--language it]
```

| Output           | Content                                                                                                  |
| ---------------- | -------------------------------------------------------------------------------------------------------- |
| `info.md`        | Title, author, date, duration, description and chapters; the text of an X post and of the post it quotes |
| `transcript.txt` | One `[mm:ss] text` line per caption or speech segment                                                    |

The output directory defaults to `/tmp/media`. The CLI takes the spoken language from `--language`, the video's original caption track or its declared language, defaulting to English, and uses published captions in that language. Without them, it downloads the audio and transcribes it locally with Whisper `small.en`, in about a quarter of the audio's duration (a 38-minute talk took 9 minutes on an 8-core server). Speech that is not English uses the multilingual Whisper model.

The first run downloads the standalone `yt-dlp`, and the first transcription the Whisper model, into `$XDG_CACHE_HOME/deslop/media` (`~/.cache` by default); later runs update `yt-dlp` in place. When YouTube refuses the connection, as it does for most datacenter addresses, `info.md` holds only the oEmbed title and channel. A URL nothing can be read from fails.

<details>
<summary>For agents</summary>

| Owner         | Decision                                                                                                                                                                                                                                                                                  |
| ------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `src/cli.ts`  | One Effect CLI; `yt-dlp` stays an external binary because no maintained JavaScript extractor covers its sites                                                                                                                                                                             |
| Transcription | Transformers.js with q8 Whisper, bundled because it imports `onnxruntime-common` without declaring it and `pnpm dlx` (pnpm 11) cannot resolve that. Its runtime dependencies become ours at the versions Transformers.js `4.3.0` and `onnxruntime-node` declare; update all four together |
| Proof         | `src/transcript.test.ts` covers caption parsing; real runs cover a captioned post, an uncaptioned video and a blocked YouTube URL through the packed tarball                                                                                                                              |

Publishing follows [tools/AGENTS.md](../AGENTS.md).

</details>
