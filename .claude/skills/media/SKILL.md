---
name: media
description: Extract transcripts, captions, post text and metadata from video and social links (YouTube, X, TikTok and other yt-dlp sites). Use when the user shares a video or post to analyze.
---

# Media

Analyze what the speaker actually said, not a summary of it. Get the primary content first, then read the sources the speaker cites.

## Extract

```bash
vpx @deslop/media@latest '<url>' node_modules/.cache/deslop/media/<name>
```

The CLI writes `info.md` with the title, author, date, description, chapters and the text of an X post and of the post it quotes, and `transcript.txt` with `[mm:ss]` timestamps. It uses published captions when they exist and otherwise transcribes the audio locally with Whisper; add `--language <code>` for speech that is not English. Run a long transcription in the background. The package README in `tools/media` of the deslop repository has the details.

## When YouTube blocks this host

YouTube asks this server's datacenter address to sign in, so YouTube downloads and captions fail here; X, TikTok and most other sites work. The CLI still saves the title and channel from oEmbed. Then look for the same content elsewhere, in this order:

1. The speaker's own post of the same talk on X, a conference recording or a podcast feed, which the CLI can transcribe.
2. A published transcript or a detailed write-up with timestamps. Search for the title and the guest's name.
3. The repositories, documents and posts the speaker discusses.

Say which parts came from a secondary source and whether it was translated or summarized. Ask the user for a cookies file only when no other source exists, and mention that YouTube may ban the account that exported it.

## Analyze

- Keep three kinds of statement apart: what the speaker said, with a timestamp; what the primary sources show; and your own inference.
- Read the repositories and documents the speaker names. They hold the precise version of a spoken idea.
- When the goal is improving the workflow, turn each idea into a specific change to a named file, then test whether the change alters agent behavior before adopting it.
