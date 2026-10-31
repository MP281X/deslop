# Stash

A personal inbox for links and notes: the server reads each link, transcribes its video and tags it; agents use it through the MCP gateway at https://gateway.mp281x.xyz/mcp, and the iOS app saves to it.

The server runs from `tools/compose.yaml`; its image carries ffmpeg, yt-dlp and the Whisper runtime. The API and MCP require a Deslop sign-in through `auth.mp281x.xyz`, as in Scope's [connection diagnostics](../scope/README.md#connection-diagnostics). `STASH_PROXY` sends video downloads through a proxy.

| Tool           | Does                                                                                      |
| -------------- | ----------------------------------------------------------------------------------------- |
| `search_notes` | Notes holding every word of the query, a `#word` being a tag; without a query, the newest |
| `read_note`    | One note whole, with its source text and its transcript in `[mm:ss]` sections             |
| `save_note`    | Saves a link or text, or retries one that failed; done once its status is `ready`         |
