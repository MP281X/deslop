# Gateway intent

- AI calls pass through unchanged with the caller's signed access token and only that person's provider key; AI usage and cost belong to that person and are never shared with admins. The token's client label identifies the app in usage. MCP call usage belongs to the shared servers.

- One page in a 40rem column: servers and keys in a single list, no tabs and no detail pane. The bar holds Copy MCP URL and the period (`24h | 7d | 30d`) at every width.
- The paste field under the bar is the page's one action: an http(s) URL goes through the add-server flow, whose OAuth/connect step is unchanged; a pasted `sk-` key opens the key dialog with it filled and its provider taken from its prefix (Anthropic, OpenRouter, otherwise the flow's first). A rejected value leaves one destructive line under the field until edited. There is no Add server button, no Add server dialog and no context menu.
- Servers: a heading, then a 32px row each (44px on phones): mark, name, host muted, tool count or Connect/Reconnect, a 64×14 sparkline of its MCP calls over the period in the server's identity hue (zinc when it has no Deslop mark), then the period's call count. A row that needs the user connects with its button; a pending Connect keeps its label and is disabled. Agents remove a server through the `remove_mcp_server` MCP tool. An expired or failed server keeps its destructive dot and its Reconnect action in the row.
- Keys: a heading, then one row per provider with a key: SVGL mark, provider name, last four muted, a 64×14 sparkline of its cost in `--primary`, then the period's cost. Agents remove a key through the `remove_ai_key` MCP tool. A provider without a key has no row; the field adds it.
- MCP usage counts each proxied tool call into its server's hourly bucket in the app's Effect KeyValueStore under `ServerRuntime.dataDirectory`, kept for 30 days and summed into the bar's period. It starts empty: no backfill and no migration, so calls made before the page recorded them never appear. AI usage is each person's ledger, and the key figures read it.
- Staleness shows once per page, in the bar's Problem: the oldest stale reader of the four (servers, MCP usage, keys, AI usage) and one retry that refreshes them all. A refusal or a failed read with nothing retained is a lock or one destructive retry in its group; one group failing leaves the other's rows.
- No charts card, no app breakdown, no summary line. Skeletons keep the headings and match each row's marks, names, sparkline and figure columns.

## Journeys

- Add an MCP server by pasting its URL, then use its tools immediately; discovery and calls forward the browser's or agent's own access token.
- Connect a third-party server, use its tools and reconnect after its authorization expires.
- Add a provider key by pasting it, make AI calls from an app, and see its cost and sparkline in its key row; removing the key stops that person's calls.
- Watch a server's MCP calls accumulate in its row over the period; remove it through `remove_mcp_server`.
