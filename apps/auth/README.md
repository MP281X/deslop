# Deslop Auth

The shared sign-in server and combined MCP gateway at `https://auth.mp281x.xyz/mcp`.

## Sign-ins

Every sign-in is one waiting code, approved from a signed-in browser, a phone or an agent's `answer_request`, and delivered once at `/auth/continue` to the browser or command holding its cookie. An app or harness gets an OAuth code at its callback; a browser that chose **Sign in with a code** gets the shared session and returns to its page. A sign-in lives 10 minutes, in memory: a restart ends the waiting ones. Workers' harness sign-in steps are in the environment skill's Maintenance reference.

## MCP gateway

Register just this URL in each harness and authorize the harness once.

```toml
[mcp_servers.auth]
url = "https://auth.mp281x.xyz/mcp"
```

Open [Auth → MCP](https://auth.mp281x.xyz/mcp-servers) to add a public HTTPS MCP URL. Each server gets a stable namespace derived from its hostname; collisions get a suffix. Adding an OAuth server opens its sign-in in the browser; Auth discovers its authorization server from standard metadata and supports public-client Dynamic Client Registration and Client ID Metadata Documents, not pre-registered clients. Deslop MCP resources use short-lived delegated credentials of the calling harness's token family.

Only admins manage servers, and every allowed account, machine and harness shares the upstream grants. Disconnect deletes local provider tokens and keeps the URL; Remove deletes the definition too; neither revokes the grant at the provider. A row shows why its last connection or discovery failed, as `list_mcp_connections` does.

The gateway accepts stateless MCP `2026-07-28` and session-based `2025-11-25`/`2025-06-18`; each upstream negotiates independently through the official MCP client SDK, one session per discovery or call. It exposes tools over Streamable HTTP only. Upstream URLs, metadata and token endpoints use HTTPS, refuse redirects and private addresses, and validate DNS answers at socket creation. Provider credentials live in `~/.deslop/auth/mcp/`.
