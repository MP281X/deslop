---
name: media
description: Extract transcripts, captions, post text and metadata from video and social links (YouTube, X, TikTok and other yt-dlp sites). Use when the user shares a video or post to analyze.
---

# Media

Analyze what the speaker said, not a summary of it, then read the sources the speaker cites.

## Extract

```bash
vpx @deslop/media@latest '<url>' node_modules/.cache/deslop/media/<name>
```

It writes `info.md` and a timestamped `transcript.txt`; `--language <code>` names the spoken language when the video does not declare it, such as an X video that is not in English. Run long transcriptions in the background.

## When YouTube blocks this host

Use a Mullvad exit node only for this extraction run, because it routes the whole host. Try nodes from `tailscale exit-node list | grep mullvad` while yt-dlp's stderr asks to confirm you are not a bot (`it-mil-wg-001` worked on 2026-10-05); the trap clears it when the shell exits, because the host normally has none:

```bash
trap 'sudo tailscale set --exit-node=' EXIT
sudo tailscale set --exit-node=<node>.mullvad.ts.net --exit-node-allow-lan-access=true
vpx @deslop/media@latest '<url>' node_modules/.cache/deslop/media/<name>
```

If every node fails, use the speaker's own post of the talk, a published transcript or the repositories discussed, and label secondary sources.

## Analyze

- Keep apart what the speaker said (with a timestamp), what primary sources show and your inference.
- Map each idea to a proposed change in a named file; implement and test it only when the task asks for changes.
