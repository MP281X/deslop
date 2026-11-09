# Gateway intent

- AI calls pass through unchanged with the caller's signed access token and only that person's provider key; usage and cost belong to that person and are never shared with admins. The token's client label identifies the app in usage.

- One page, two views chosen by `Servers | AI` tabs in the bar; the URL holds the view, period, measure and narrowing. Both sit in a 40rem column centred on the page, with no detail pane.
- Servers: one Card of 48px rows, each its mark, name over host, then its tool count with a wrench or Connect/Reconnect when it needs the user; a row that needs the user connects on activation, and a connected one is not a button. A Deslop server takes the caller's own token without a Connect step. Only third-party OAuth servers are connected and hold tokens in Gateway. Remove sits in the row's context menu; the row waits eight seconds with Undo, and a failed removal keeps the row and its reason. The same leading slot keeps its width. An expired or failed server keeps its destructive dot and its Reconnect action in the row.
- AI: one Card holding the period's spend, tokens and calls; bars per hour or day stacked by app in its identity hue, measuring cost or tokens; then Apps and Models groups under their quiet headings (share, tokens, cost), model rows carrying no swatch. The period (`24h | 7d | 30d`) sits in the bar at every width; the measure is Tabs on the card's summary line. Tapping a bar or row narrows them, a chip undoes it. A separate Keys Card lists each provider by its last four, the period's cost and a red dot once the provider refuses the key; its context menu replaces or removes it at once, and a provider without a key adds one. Without calls the usage card gives way to one symbol; Keys stays.
- Staleness shows once per page, in the bar's Problem: the oldest stale reader of the view and one retry that refreshes them all. Rows and panes stay unmarked.
- The bar holds the page's controls: on Servers, Add server and Copy MCP URL (the copy shows a check for a moment); on AI, the period. Add key stays on its provider row and Remove <server> in the server's context menu; a removal waits eight seconds with Undo.

## Journeys

- Add a Deslop server and use its tools immediately; discovery and calls forward the browser's or agent's own access token.
- Connect a third-party server, use its tools and reconnect after its authorization expires.
- Add a provider key, make AI calls from an app and narrow usage by the signed client label; removing the key stops that person's calls.
