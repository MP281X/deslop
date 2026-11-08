# Stash

A reading list: it reads each saved link, transcribes its video and tags it. The iOS app and agents save to it.

```bash
npm install --global @deslop/stash
stash service install --url https://stash.mp281x.xyz --auth https://auth.mp281x.xyz --gateway https://gateway.mp281x.xyz
```

- **Secrets** in `~/.deslop/stash.env`: optional `STASH_PROXY` for video downloads; AI keys live in Gateway.
- **Bundled**: ffmpeg, ffprobe and yt-dlp, with their licenses in `bin/`.
- **MCP** at `/mcp`: `search_notes`, `read_note`, `save_note`.

Common flags and service commands: [Deslop app runtime](https://github.com/MP281X/deslop/blob/main/packages/runtime/README.md).
