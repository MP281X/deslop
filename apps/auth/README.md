# Deslop Auth

The shared sign-in server: an OAuth 2.1 authorization server for every Deslop app and MCP server, with GitHub and code sign-ins.

## Sign-ins

Every sign-in is one waiting code. It is approved from a signed-in browser, a phone or an agent's `answer_request`, and delivered once at `/auth/continue` to the browser or command holding its cookie. An app or harness gets an OAuth code at its callback. A browser that chose **Sign in with a code** gets a 30-day session and returns to its page; only a signed-in browser can approve one, never an agent's token. A GitHub sign-in's session lasts a year. A sign-in lives 10 minutes, in memory: a restart ends the waiting ones. Workers' harness sign-in steps are in the environment skill's Maintenance reference.

Client ids are the registration itself, encoded, so registering stores nothing. The signed-in list names each sign-in `Client · Device`: the device is a worker preview's host, a known worker, the platform its User-Agent names, or its address. Signed-in apps and browsers live in `~/.deslop/auth/`; authorization codes stay in memory. Registration, authorization, token, revocation, GitHub and code sign-in requests have a per-minute budget per address (an IPv6 /64), and answer 429 past it.

## MCP

`https://auth.mp281x.xyz/mcp` has one tool, `answer_request`, which agents reach through the [gateway](../gateway/README.md) as `auth__answer_request`. The gateway connects to Auth's MCP and every other Deslop MCP server like any OAuth provider, at its callback `https://gateway.mp281x.xyz/oauth/callback/<id>`.
