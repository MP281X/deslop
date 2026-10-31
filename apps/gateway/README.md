# Deslop Gateway

One MCP endpoint, `https://gateway.mp281x.xyz/mcp`, for every MCP server the user connects; callers sign in through [Auth](../auth/README.md). Register only this URL in each harness and authorize it once:

```toml
[mcp_servers.gateway]
url = "https://gateway.mp281x.xyz/mcp"
```

## Servers

- **Add** a public HTTPS MCP URL on [the gateway's page](https://gateway.mp281x.xyz); an OAuth server opens its sign-in in the browser.
- **Names**: a stable namespace from the hostname, a suffix on collision; tools are `<server>__<tool>`.
- **Who**: only `GITHUB_ADMINS` (Auth's setting) manage servers; every allowed account, machine and harness shares the upstream grants.
- **Disconnect** deletes local provider tokens, keeps the URL; **Remove** deletes the definition too; neither revokes the provider's grant.
- **Tools** menu: uncheck tools agents should neither see nor call.
- **Failures**: a row shows why its last connection or discovery failed, as `list_mcp_connections` does.

## OAuth

- **Discovery** from the server's standard metadata.
- **Registration**: public-client Dynamic Client Registration with the server's own callback, `/oauth/callback/<id>`, on each connection; otherwise its Client ID Metadata Document, only with a provider naming itself in its answers (RFC 9207 `iss`). Any other provider is refused; never pre-registered clients.
- **Deslop servers**, Auth's own included, connect the same way with Auth as provider; the gateway's sign-ins show among the admin's signed-in apps.
- **Credentials** in `~/.deslop/gateway/`.

## MCP

- **Own tool**: `list_mcp_connections`; `({server})` returns that server's instructions whole. The gateway's instructions, read at its start, name each server by its instructions' first sentence. Upstream tools are listed without output schemas.
- **Protocols**: stateless `2026-07-28` and session-based `2025-11-25`/`2025-06-18`. Each upstream negotiates through the official MCP client SDK, one session per discovery or call. Streamable HTTP only.
- **Removed servers**: Effect's `McpServer` can't remove tools, so theirs stay registered and a visibility check keeps them out of lists and calls.
- **Network**: upstream URLs, metadata and token endpoints use HTTPS, refuse redirects and private addresses, validate DNS answers at socket creation.
