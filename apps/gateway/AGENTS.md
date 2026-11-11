# Gateway intent

- **AI.** Calls pass through unchanged with the caller's signed access token and provider key. The token's client label identifies the app in usage; the key figures read that person's ledger.

- **Page.** Servers and keys in a single column list, no tabs or detail pane. The bar holds Copy MCP URL and the period (`24h | 7d | 30d`) at every width. No charts card, app breakdown or summary line.
- **Paste.** The field under the bar is the page's one action: an http(s) URL starts the add-server OAuth/connect flow; a pasted `sk-` key opens the key dialog, filled, with its provider from the prefix (Anthropic, OpenRouter, otherwise the flow's first). A rejected value leaves one destructive line under the field until edited. No Add server button or dialog.
- **Servers.** A heading, then each row's mark, name, muted host, tool count or Connect/Reconnect, a 64×14 MCP-call sparkline in the server's identity hue, then the period's call count. An expired or failed server keeps its destructive dot and Reconnect action. Agents remove it through `remove_mcp_server`.
- **Keys.** A heading, then each keyed provider's SVGL mark, name, muted last four, a 64×14 cost sparkline in `--primary`, then the period's cost. Agents remove it through `remove_ai_key`. A provider without a key has no row; the field adds it.
- **MCP usage.** Count each proxied tool call in its shared server's hourly bucket, retain 30 days and sum the bar's period. No backfill or migration.
- **Recovery.** Readers are servers, MCP usage, keys and AI usage. A group with no retained content shows its own denial or failed read; one group failing leaves the other's rows.
- **Skeletons.** Keep headings and match each row's marks, names, sparkline and figure columns.

## Journeys

- **Server.** Paste its URL, then use its tools immediately; discovery and calls forward the browser's or agent's own access token.
- **Reconnect.** Connect a third-party server, use its tools and reconnect after authorization expires.
- **Key.** Paste a provider key, make AI calls from an app and see its cost and sparkline; removing the key stops that person's calls.
- **Usage.** Watch a server's MCP calls accumulate over the period, then remove it.
