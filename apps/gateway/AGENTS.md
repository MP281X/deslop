# Gateway intent

- AI calls pass through unchanged with the caller's signed access token and only that person's provider key; usage and cost belong to that person and are never shared with admins. The token's client label identifies the app in usage.

- One page, two views chosen by `Servers | AI` tabs in the bar; the URL holds the view, period, measure and narrowing. Both sit in a 40rem column centred on the page, with no detail pane.
- Servers: one Card of 32px rows (44 on phones), each its mark, name and host on one line, then its tool count with a wrench or Connect/Reconnect when it needs the user; a row that needs the user connects on activation, and a connected one is not a button. A Deslop server takes the caller's own token without a Connect step. Only third-party OAuth servers are connected and hold tokens in Gateway. Remove sits in the row's context menu; the row waits eight seconds with Undo, and a failed removal keeps the row and its reason. The same leading slot keeps its width. An expired or failed server keeps its destructive dot and its Reconnect action in the row.
- AI: the Keys Card comes first, then the usage Card. Keys lists each provider by its SVGL mark and last four, the period's cost and a red dot once the provider refuses the key; its context menu replaces or removes it at once, and a provider without a key adds one. The usage Card holds one 32px summary line, the period's cost, tokens and calls with the Cost|Tokens measure at its right; then bars per hour or day stacked by app in its identity hue; then Apps and Models groups under their quiet 32px headings, each app row leading with the app's own 16px icon, each model row with its vendor's SVGL mark, both ending in tight tokens and cost columns with no share column. The period (`24h | 7d | 30d`) sits in the bar at every width. Tapping a bar or row narrows them, a chip undoes it. Without calls the usage card gives way to one symbol; Keys stays.
- Staleness shows once per page, in the bar's Problem: the oldest stale reader of the view and one retry that refreshes them all. Rows and panes stay unmarked.
- The bar holds the page's controls: on Servers, Add server and Copy MCP URL (the copy shows a check for a moment); on AI, the period. Add key stays on its provider row and Remove <server> in the server's context menu; a removal waits eight seconds with Undo.

## Journeys

- Add a Deslop server and use its tools immediately; discovery and calls forward the browser's or agent's own access token.
- Connect a third-party server, use its tools and reconnect after its authorization expires.
- Add a provider key, make AI calls from an app and narrow usage by the signed client label; removing the key stops that person's calls.
