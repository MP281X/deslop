# @deslop/stash

A personal inbox for links and notes: the server reads each link, transcribes its video and tags it; agents use it through MCP and the iOS app saves to it.

```bash
mkdir -p ~/.deslop/stash # created by Docker, it would belong to root and the server could not write it
docker run -d --name stash -p 127.0.0.1:5000:5000 -e ANTHROPIC_API_KEY \
  -v ~/.deslop/stash:/home/node/.deslop/stash ghcr.io/mp281x/deslop-stash:latest
claude mcp add --transport http stash http://127.0.0.1:5000/mcp
codex mcp add stash --url http://127.0.0.1:5000/mcp
```

The image carries ffmpeg, yt-dlp and the Whisper runtime. The server has no authentication: it answers only loopback and tailnet (`*.ts.net`) host names, so reach it on `127.0.0.1` or through `tailscale serve`. `STASH_PROXY` sends video downloads through a proxy.

| Tool         | Does                                                                          |
| ------------ | ----------------------------------------------------------------------------- |
| `list`       | Notes newest first, without their long texts                                  |
| `search`     | Notes holding every word of the query; a `#word` must be a tag                |
| `get`        | One note whole, with its source text and its transcript in `[mm:ss]` sections |
| `save`       | Saves a link or text; the note is done once its status is `ready`             |
| `regenerate` | Reads and tags a note again                                                   |
| `remove`     | Deletes a note with its files                                                 |
