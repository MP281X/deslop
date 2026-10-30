# Deslop Auth

The shared sign-in server and combined MCP gateway at `https://auth.mp281x.xyz/mcp`.

## MCP gateway

Register just this URL in each harness. Authorize that harness with Deslop Auth once; its own OAuth client manages the resulting credentials. Do not copy tokens between machines.

```toml
[mcp_servers.auth]
url = "https://auth.mp281x.xyz/mcp"
```

Open [Auth → MCP](https://auth.mp281x.xyz/mcp-servers) to add a public HTTPS MCP URL. The list starts empty: there is no built-in provider catalog, including for Deslop apps. Each server gets a stable namespace derived from its hostname; collisions get a suffix. Auth's approval and account-management tools keep their names.

Adding an OAuth server opens its sign-in in your browser. Auth discovers its authorization server, scopes and registration endpoint from standard metadata; it supports public-client Dynamic Client Registration and Client ID Metadata Documents. There are no manually pasted tokens. Servers requiring a pre-registered client are not supported. Public servers need no sign-in. Known Deslop MCP resources use short-lived, resource-specific delegated credentials belonging to the calling harness's token family and are revoked with it.

Only admins manage servers. Every allowed Deslop account, machine and harness shares the upstream OAuth grants, like the apps' other shared data. The row's `…` menu connects, reconnects, disconnects or removes a server. Disconnect deletes local provider tokens and hides its tools while keeping the URL; Remove deletes the definition too. Neither revokes the grant at the provider. Reconnect once here after a revoked grant or provider account change, not on each machine. The list updates live; tool counts arrive when a harness discovers tools. Refresh the harness's MCP tool list after changing connections.

`list_mcp_connections` also reports discovery errors. `connect_mcp` returns the same browser authorization link and `disconnect_mcp` disconnects by the server id returned in the list.

The gateway accepts stateless MCP `2026-07-28` and session-based `2025-11-25`/`2025-06-18`. Each upstream negotiates independently through the official MCP client SDK. Each discovery or call owns its upstream session and closes it afterwards. JSON/SSE responses, images, structured content, annotations and tool-reported errors cross the bridge without conversion to text. Discovery waits at most two seconds before returning the available registry; a slow provider finishes in the server's scope and sends tool-list change notifications. Concurrent refreshes coalesce instead of queuing. Cached tools and Auth's local tools remain available during an upstream outage.

This gateway exposes tools over Streamable HTTP, not upstream prompts, resources, sampling, elicitation, task execution, stdio or the older separate SSE transport. Arbitrary upstream URLs, OAuth metadata and token endpoints use HTTPS only, refuse redirects and private/reserved IPs, and validate DNS answers at socket creation to prevent DNS rebinding into the worker's private network. Metadata issuer checks and browser-bound, one-use PKCE callbacks protect authorization-server binding. Very long namespaced tool names are shortened with a deterministic hash.

Provider credentials and one-use, browser-bound PKCE flows live in `~/.deslop/auth/mcp/`, with private directory/file permissions and atomic writes. Rotating refresh tokens are saved centrally, not returned to callers. Keep this directory with Auth's existing persistent volume.

## Switching existing clients

The pinned Effect patch adds `McpServer.removeTool`, removing both the descriptor and executable registration and notifying clients. Gateway discovery uses it to release removed servers and vanished tools; the unpatched API only adds or replaces registrations.

Deploy Auth before installing the combined-only harness configuration. Add the desired servers in Auth → MCP, including your Deslop URLs, and authorize Mobbin and Dual once there. Refresh the tool list, then remove each harness's direct provider entries. In Claude Code, register the Auth URL as a remote HTTP MCP and remove the old direct entries; a separate Claude Mobbin connector is no longer needed for gateway calls. Existing upstream authorizations in harness credential stores are not imported.

The repository's Codex configuration uses only Auth and enables stateless MCP. Reverting that configuration restores direct connections; it does not undo provider grants made through the gateway.
