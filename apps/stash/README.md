# Stash

A personal inbox for links and notes: the server reads each link, transcribes its video and tags it; agents use it through the [gateway](../gateway/README.md), the iOS app saves to it.

- **Runs** from `tools/compose.yaml`; the image carries ffmpeg, yt-dlp and the Whisper runtime.
- **API and MCP** need a Deslop sign-in, as in Scope's [connection diagnostics](../scope/README.md#connection-diagnostics).
- **`STASH_PROXY`** routes video downloads through a proxy.

| Tool           | Does                                                                                      |
| -------------- | ----------------------------------------------------------------------------------------- |
| `search_notes` | Notes holding every word of the query, a `#word` being a tag; without a query, the newest |
| `read_note`    | One note whole, with its source text and its transcript in `[mm:ss]` sections             |
| `save_note`    | Saves a link or text, or retries one that failed; done once its status is `ready`         |
