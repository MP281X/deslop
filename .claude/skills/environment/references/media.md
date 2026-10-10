# Media

Analyze what the speaker said, not a summary of it, then read the sources the speaker cites.

## Extract

```bash
vpx @deslop/stash@latest media '<url>' /tmp/media/<name>
```

The command writes `info.md` and a timestamped `transcript.txt`. Pass `--language <code>` when the video does not declare its spoken language, such as a non-English X video. Run long transcriptions in the background. A video without an audio track fails transcription; then read the post text in `info.md` and look at the video frames.

## When YouTube blocks this host

Use a Mullvad exit node for this extraction only, because it routes the whole host. Try nodes from `tailscale exit-node list | grep mullvad` until yt-dlp stops asking to confirm you are not a bot. `it-mil-wg-001` worked on 2026-10-05. The trap clears the exit node when the shell exits, because the host normally has none:

```bash
trap 'sudo tailscale set --exit-node=' EXIT
sudo tailscale set --exit-node=<node>.mullvad.ts.net --exit-node-allow-lan-access=true
vpx @deslop/stash@latest media '<url>' /tmp/media/<name>
```

If every node fails, use the speaker's own post of the talk, a published transcript or the repositories discussed. Label each source by where it comes from, and mark a third-party transcript as secondary.

## Analyze

- Keep apart what the speaker said (with a timestamp), what primary sources show and your own inference.
- Map each idea to a proposed change in a named file. Implement and test it only when the task asks for changes.
