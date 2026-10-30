# Deslop Auth

The shared sign-in server and combined MCP gateway at `https://auth.mp281x.xyz/mcp`.

## Sign-ins

Every sign-in is one waiting code. It is approved from a signed-in browser, a phone or an agent's `answer_request`, and delivered once at `/auth/continue` to the browser or command holding its cookie. An app or harness gets an OAuth code at its callback. A browser that chose **Sign in with a code** gets a 30-day session and returns to its page; only a signed-in browser can approve one, never an agent's token. A GitHub sign-in's session lasts a year. A sign-in lives 10 minutes, in memory: a restart ends the waiting ones. Workers' harness sign-in steps are in the environment skill's Maintenance reference.

Client ids are the registration itself, encoded, so registering stores nothing. The signed-in list names each sign-in `Client · Device`: the device is a worker preview's host, a known worker, the platform its User-Agent names, or its address. Signed-in apps and browsers live in `~/.deslop/auth/`; authorization codes and the gateway's delegated tokens stay in memory. Registration, authorization, token, GitHub and code sign-in requests have a per-minute budget per address (an IPv6 /64) and overall, and answer 429 past it.

## MCP gateway

Register just this URL in each harness and authorize the harness once.

```toml
[mcp_servers.auth]
url = "https://auth.mp281x.xyz/mcp"
```

Open [Auth → MCP](https://auth.mp281x.xyz/mcp-servers) to add a public HTTPS MCP URL. Each server gets a stable namespace derived from its hostname; collisions get a suffix. Adding an OAuth server opens its sign-in in the browser. Auth discovers its authorization server from standard metadata. It registers through public-client Dynamic Client Registration with that server's own callback, `/auth/mcp/callback/<id>`. Otherwise it uses its Client ID Metadata Document, but only with a provider that names itself in its answers (RFC 9207 `iss`). It refuses any other provider and never uses pre-registered clients. Deslop MCP resources use short-lived delegated credentials of the calling harness's sign-in.

Only admins manage servers, and every allowed account, machine and harness shares the upstream grants. Disconnect deletes local provider tokens and keeps the URL. Remove deletes the definition too. Neither revokes the grant at the provider. A server's **Tools** menu unchecks tools agents should neither see nor call. A row shows why its last connection or discovery failed, as `list_mcp_connections` does.

Auth's own tools are `list_mcp_connections` and `answer_request`. Its instructions, read when Auth starts, name each connected server by the first sentence of that server's own instructions; `list_mcp_connections({server})` returns them whole. Upstream tools are listed without their output schemas.

The gateway accepts stateless MCP `2026-07-28` and session-based `2025-11-25`/`2025-06-18`. Each upstream negotiates independently through the official MCP client SDK, one session per discovery or call. It exposes tools over Streamable HTTP only; the pinned Effect patch adds `McpServer.removeTool`, which releases the tools of removed servers. Upstream URLs, metadata and token endpoints use HTTPS, refuse redirects and private addresses, and validate DNS answers at socket creation. Provider credentials live in `~/.deslop/auth/mcp/`.
