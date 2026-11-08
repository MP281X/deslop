# Gateway intent

- AI calls pass through unchanged using only the triggering person's provider key; app grants, usage and cost belong to that person and are never shared with admins.

- One page, two views chosen by a `Servers | AI` control in the bar; the URL holds the view, period, measure and narrowing. Both sit in a reading column centred on the page, as Auth's sign-ins are, with no detail pane.
- Servers: each row identifies the server, its host, available tools and connection state; Connect or Reconnect appears when needed. Remove sits in the row's context menu. The same leading slot keeps its width.
- AI: the period's spend, tokens and calls, then bars per hour or day stacked by app in its identity hue, measuring cost or tokens; the period (`24h | 7d | 30d`) and measure sit in the bar on a desktop and in a row under it on a phone. By app and By model rows give each one's share, tokens and cost; tapping a bar or row narrows them, a chip undoes it. A granted app shows even without calls, and its context menu revokes the grant. Keys lists each provider by its last four, the period's cost and a light that turns red once the provider refuses the key; its context menu replaces or removes it, and a provider without a key adds one. Without calls the chart and lists give way to one line; granted apps and Keys stay.
- The bar holds no actions. Its palette lists the servers that need the user, every server, Copy MCP URL, Add server and Add key; choosing a server brings its row into view. Searching is how the page moves.
- An agent on another machine gets its own token by running Auth's agent script and approving it on the phone; the token is made there, never here.
