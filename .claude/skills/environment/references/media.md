# Media

Analyze what the speaker said, not a summary of it, then read the sources the speaker cites.

## Extract

```bash
vpx @deslop/stash@latest save '<url>' /tmp/stash/<name>
```

The command saves the link as a stash note on the server on `dev`, waits until the server has read and tagged it, and writes `note.md` and a timestamped `transcript.txt`. `note.md` holds the title, the AI's notes, the words in the images and the source text the server read. The server transcribes audio up to two hours long, one video at a time, so run long talks in the background. A video without an audio track has no transcript; then read the post text in `note.md` and look at the video frames.

## When YouTube blocks this host

Use a Mullvad exit node for this extraction only, because it routes the whole host, including the stash server. Try nodes from `tailscale exit-node list | grep mullvad` until yt-dlp stops asking to confirm you are not a bot. `it-mil-wg-001` worked on 2026-10-05. The trap clears the exit node when the shell exits, because the host normally has none:

```bash
trap 'sudo tailscale set --exit-node=' EXIT
sudo tailscale set --exit-node=<node>.mullvad.ts.net --exit-node-allow-lan-access=true
vpx @deslop/stash@latest save '<url>' /tmp/stash/<name>
```

If every node fails, use the speaker's own post of the talk, a published transcript or the repositories discussed. Label each source by where it comes from, and mark a third-party transcript as secondary.

## Analyze

- Keep apart what the speaker said (with a timestamp), what primary sources show and your own inference.
- Map each idea to a proposed change in a named file. Implement and test it only when the task asks for changes.
