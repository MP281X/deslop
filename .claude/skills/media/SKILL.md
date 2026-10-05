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

It writes `info.md` and a timestamped `transcript.txt`; `--language <code>` handles speech that is not English. Run long transcriptions in the background.

## When YouTube blocks this host

Route only the download through a Mullvad exit node, trying nodes from `tailscale exit-node list | grep mullvad` until one returns the title (`it-mil-wg-001` worked on 2026-10-05), and always turn it off:

```bash
trap 'sudo tailscale set --exit-node=' EXIT
sudo tailscale set --exit-node=<node>.mullvad.ts.net --exit-node-allow-lan-access=true
vpx @deslop/media@latest '<url>' node_modules/.cache/deslop/media/<name>
sudo tailscale set --exit-node=
```

If every node fails, use the speaker's own post of the talk, a published transcript or the repositories discussed, and label secondary sources.

## Analyze

- Keep apart what the speaker said (with a timestamp), what primary sources show and your inference.
- Turn each idea into a change to a named file, and test that it changes agent behavior before adopting it.
