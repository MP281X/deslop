# Gateway intent

- **AI.** OpenCode Go and OpenCode Zen are the only keyed providers. Calls pass through unchanged with the caller's signed access token and provider key. The key figures read that person's hourly ledger.
- **MCP.** Connection and key removal tools are only for explicit user-requested maintenance or credential revocation, not routine page actions.
- **Upstreams.** One scoped session per server serves discovery and calls. Effect's client handles its supported protocol revisions; the SDK is retained for OAuth discovery/authorization and servers that negotiate a revision Effect cannot speak. During client selection, HTTP 4xx other than 401/403 can mean an older server rejected the modern revision, so they take the legacy path; authentication and authorization answers keep their meaning. A 404 session rejection or a 401 authorization rejection can re-establish a session; an ambiguous call failure never retries the action.
- **Callers.** Calls and discovery on one upstream session run concurrently. Each request carries its own caller's bearer; only session acquisition and invalidation share a lock.
- **Excluded.** Tabs, a detail pane, a charts card, an app breakdown, a summary line, an Add server button or dialog.
- **Paste.** The field under the bar is the page's one action: an http(s) URL adds a server, an `sk-` key opens the key dialog.

## Journeys

- **Server.** Paste its URL, then use its tools immediately; discovery and calls forward the browser's or agent's own access token.
- **Reconnect.** Connect a third-party server, use its tools and reconnect after authorization expires.
- **Key.** Paste a provider key, make AI calls from an app and see its cost and sparkline; removing the key stops that person's calls.
- **Usage.** Watch a server's MCP calls accumulate over the period, then remove it.
