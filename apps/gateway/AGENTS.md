# Gateway intent

- AI calls pass through unchanged with the caller's signed access token and only that person's provider key; usage and cost belong to that person and are never shared with admins. The token's client label identifies the app in usage.

- One page, two views chosen by a `Servers | AI` control in the bar; the URL holds the view, period, measure and narrowing. Both sit in a reading column centred on the page, as Auth's sign-ins are, with no detail pane.
- Servers: each row identifies the server, its host, available tools and connection state; Deslop servers take the caller's own token without a Connect step. Only third-party OAuth servers are connected and hold tokens in Gateway. Remove sits in the row's context menu. The same leading slot keeps its width.
- AI: the period's spend, tokens and calls, then bars per hour or day stacked by app in its identity hue, measuring cost or tokens; the period (`24h | 7d | 30d`) and measure sit in the bar on a desktop and in a row under it on a phone. By app and By model rows give each one's share, tokens and cost; tapping a bar or row narrows them, a chip undoes it. Keys lists each provider by its last four, the period's cost and a light that turns red once the provider refuses the key; its context menu replaces or removes it, and a provider without a key adds one. Without calls the chart and lists give way to one line; Keys stay.
- The bar holds no actions. Its palette lists the servers that need the user, every server, Copy MCP URL, Add server and Add key; choosing a server brings its row into view. Searching is how the page moves.

## Journeys

- Add a Deslop server and use its tools immediately; discovery and calls forward the browser's or agent's own access token.
- Connect a third-party server, use its tools and reconnect after its authorization expires.
- Add a provider key, make AI calls from an app and narrow usage by the signed client label; removing the key stops that person's calls.
