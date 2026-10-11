# Media

Analyze what the speaker said, not a summary of it, then read the sources the speaker cites.

## Extract

```bash
vpx @deslop/stash@latest save '<url>' > /tmp/stash-<name>.md
```

The command saves the link as a stash note on the server on `dev`, waits until the server has read and tagged it, and prints the note as Markdown: the title, the AI's notes, the words in the images, the source text the server read and a timestamped transcript. The server transcribes audio up to two hours long, one video at a time, so run long talks in the background. A video without an audio track has no transcript; then read the post text in the note and look at the video frames.

## When a site blocks this host

The stash server already sends every `yt-dlp` request through the Mullvad proxies on `dev` and moves to the next one when a site blocks it, so `save` reaches YouTube. For your own fetches from any tailnet machine, use a proxy on ports 1080 to 1084 instead of a Mullvad exit node, which would route the whole machine:

```bash
yt-dlp --proxy socks5://dev:1080 '<url>'
curl --proxy socks5h://dev:1080 '<url>'
```

`curl --proxy socks5h://dev:1080 https://am.i.mullvad.net/json` shows the exit server. When YouTube asks to confirm you are not a bot, try the next port; to replace a relay, follow [Maintenance](maintenance.md#machines). If every server fails, use the speaker's own post of the talk, a published transcript or the repositories discussed. Label each source by where it comes from, and mark a third-party transcript as secondary.

## Analyze

- Keep apart what the speaker said (with a timestamp), what primary sources show and your own inference.
- Map each idea to a proposed change in a named file. Implement and test it only when the task asks for changes.
