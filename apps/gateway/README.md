# Deslop Gateway

One MCP endpoint, `https://gateway.mp281x.xyz/mcp`, for every MCP server the user connects. Callers sign in through Auth.

Register just this URL in each harness and authorize the harness once.

```toml
[mcp_servers.gateway]
url = "https://gateway.mp281x.xyz/mcp"
```

Open [the gateway](https://gateway.mp281x.xyz) to add a public HTTPS MCP URL. Each server gets a stable namespace derived from its hostname; collisions get a suffix, and its tools are named `<server>__<tool>`. Adding an OAuth server opens its sign-in in the browser. The gateway discovers its authorization server from standard metadata. It registers through public-client Dynamic Client Registration with that server's own callback, `/oauth/callback/<id>`, again on each connection. Otherwise it uses its Client ID Metadata Document, but only with a provider that names itself in its answers (RFC 9207 `iss`). It refuses any other provider and never uses pre-registered clients. Deslop MCP servers, Auth's own included, connect the same way, with Auth as their provider; the gateway's sign-ins appear among the admin's signed-in apps.

Only the admins in `GITHUB_ADMINS`, the setting Auth reads, manage servers, and every allowed account, machine and harness shares the upstream grants. Disconnect deletes local provider tokens and keeps the URL. Remove deletes the definition too. Neither revokes the grant at the provider. A server's **Tools** menu unchecks tools agents should neither see nor call. A row shows why its last connection or discovery failed, as `list_mcp_connections` does.

The gateway's own tool is `list_mcp_connections`. Its instructions, read when the gateway starts, name each connected server by the first sentence of that server's own instructions; `list_mcp_connections({server})` returns them whole. Upstream tools are listed without their output schemas.

The gateway accepts stateless MCP `2026-07-28` and session-based `2025-11-25`/`2025-06-18`. Each upstream negotiates independently through the official MCP client SDK, one session per discovery or call. It exposes tools over Streamable HTTP only; Effect's `McpServer` has no tool removal, so the tools of removed servers stay registered and its visibility check keeps them out of lists and calls. Upstream URLs, metadata and token endpoints use HTTPS, refuse redirects and private addresses, and validate DNS answers at socket creation. Provider credentials live in `~/.deslop/gateway/`.
