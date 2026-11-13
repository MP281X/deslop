# Gateway intent

- **AI.** One OpenCode service-account key per person serves catalogue, Go and connected calls; those are routes, not separately stored providers. The connected Anthropic Console API URL is entered once beside the key. Claude calls outside that connection are refused, never charged to Zen's catalogue. Its SDK's `/v1/messages?beta=true` becomes `/messages?beta=true` under the connection URL; headers and body pass unchanged. Hourly figures keep OpenCode's billing sources apart: Zen balance charges and the Anthropic key's estimated spend are separate, with estimates marked `~`. Earlier combined figures are unattributed, not guessed.
- **MCP.** Connection and key removal tools are only for explicit user-requested maintenance or credential revocation, not routine page actions.
- **Upstreams.** One scoped session per server serves discovery and calls. Effect's client handles its supported protocol revisions; the SDK is retained for OAuth discovery/authorization and servers that negotiate a revision Effect cannot speak. During client selection, HTTP 4xx other than 401/403 can mean an older server rejected the modern revision, so they take the legacy path; authentication and authorization answers keep their meaning. A 404 session rejection or a 401 authorization rejection can re-establish a session; an ambiguous call failure never retries the action.
- **Callers.** Calls and discovery on one upstream session run concurrently. Each request carries its own caller's bearer; only session acquisition and invalidation share a lock.
- **Excluded.** Tabs, a detail pane, a charts card, an app breakdown, a summary line, an Add server button or dialog.
- **Paste.** The field under the bar is the page's one action: a valid Console connection URL or an `oc_sk_` OpenCode key opens the one credential dialog; another http(s) URL adds a server. The dialog validates the address and key independently; a mistyped address never becomes a replacement secret.

## Journeys

- **Server.** Paste its URL, then use its tools immediately; discovery and calls forward the browser's or agent's own access token.
- **Reconnect.** Connect a third-party server, use its tools and reconnect after authorization expires.
- **Key.** Paste a provider key, make AI calls from an app and see its cost and sparkline; removing the key stops that person's calls.
- **Usage.** Watch a server's MCP calls accumulate over the period, then remove it.
