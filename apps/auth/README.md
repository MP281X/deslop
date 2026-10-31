# Deslop Auth

The shared sign-in server: an OAuth 2.1 authorization server for every Deslop app and MCP server, with GitHub and code sign-ins.

## Sign-ins

Every sign-in is one waiting code, approved from a signed-in browser, a phone or an agent's `answer_request`, and delivered once at `/auth/continue` to the browser or command holding its cookie.

| Signs in                        | Gets                             | Approved by                        |
| ------------------------------- | -------------------------------- | ---------------------------------- |
| App or harness                  | OAuth code at its callback       | Browser, phone or `answer_request` |
| **Sign in with a code** browser | 30-day session, back to its page | A signed-in browser only           |
| GitHub                          | One-year session                 | GitHub                             |

- **Waiting page** shows a QR code and the code; leave it open in the client's browser, which completes the localhost callback, never on the phone.
- **Lifetime**: 10 minutes, in memory; a restart ends the waiting ones. Workers' harness steps: environment skill, Maintenance.
- **Clients**: the id is the encoded registration, so registering stores nothing. The signed-in list shows `Client · Device`: a worker preview's host, a known worker, the User-Agent's platform, or the address.
- **Storage**: signed-in apps and browsers in `~/.deslop/auth/`; authorization codes in memory.
- **Rate limit**: registration, authorization, token, revocation, GitHub and code sign-in requests have a per-minute budget per address (IPv6 /64), 429 past it.

## MCP

- **Discovery**: each Deslop MCP server's `/.well-known/oauth-protected-resource/mcp` names Auth; no credentials → 401 challenge; rejected bearer → `error="invalid_token"`; Auth down → 503 with `Retry-After`.
- **Stored credentials prove nothing**: check the client's MCP status and tool discovery. `OAuth authorization required` at startup, or after an auth-store reset: sign the client in to the gateway again.
- **`answer_request`**: `https://auth.mp281x.xyz/mcp`'s one tool, reached through the [gateway](../gateway/README.md) as `auth__answer_request`.
