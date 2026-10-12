# Media

Analyze what the speaker said, not a summary of it, then read the sources the speaker cites.

## Extract

```bash
vpx @deslop/stash@latest save '<url>' > /tmp/stash-<name>.md
```

The command saves the link as a stash note on dev's server, waits until the server read and tagged it, and prints the note as Markdown: the title, the AI notes, the text in the images, the source text and a timestamped transcript. The server transcribes audio up to two hours long, one video at a time, so run long talks in the background. A video without audio has no transcript: read the post text and look at the frames.

## Blocked sites

The stash server sends every `yt-dlp` request through the Mullvad proxies on dev and moves to the next proxy when a site blocks one. For your own fetches, use a proxy on ports 1080 to 1084, never a Mullvad exit node, which routes the whole machine:

```bash
yt-dlp --proxy socks5://dev:1080 '<url>'
curl --proxy socks5h://dev:1080 '<url>'
```

When YouTube asks for a bot check, try the next port; to replace a relay, follow [Maintenance](maintenance.md#machines). When every proxy fails, use the speaker's own post, a published transcript or the repositories discussed. Label each source by its origin, and mark a third-party transcript as secondary.

## Analyze

- Keep apart what the speaker said, with a timestamp, what primary sources show, and your own inference.
- Map each idea to a proposed change in a named file. Implement it only when the task asks for changes.
