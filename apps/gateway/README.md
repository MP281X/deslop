# Gateway

```bash
npm install --global @deslop/gateway
gateway service install --domain mp281x.xyz
```

Register only `https://<gateway>/mcp` in each harness. Auth names callers by tailnet identity or its shared browser cookie. Admins add servers; HTTPS subdomains of Gateway's parent domain need no OAuth connection and receive the caller's identity, while third-party OAuth connections remain separate. Everyone signed in shares servers. AI keys and usage belong to each person, as described in this app's `AGENTS.md`.

## MCP results

Deslop tools declare object success schemas and return schema-encoded `structuredContent` once, with empty `content`. Mutations return the acted-on identity after completion; errors are plain text, and an unvalidated upstream response means the action may already have committed: inspect its state before retrying.

Gateway retains upstream output schemas and validates calls against the discovered descriptor. Third-party text, images, resources and input-required results pass through unchanged; text is never guessed to be JSON. Use `list_mcp_connections` for missing or failing tools, or name a server for its instructions, not as a routine preflight.

Collection cursors resume live, key-ordered lists with the same filters; new rows before the cursor do not shift the page. Telemetry can still change while a trace is running or disappear after retention, so finish comparisons on settled traces. Note section offsets address characters, not tokens; transcript chunks end on a line boundary when possible. Resource summaries report sample coverage, and only an explicitly requested series preserves timing and null gaps.

## AI proxy

App servers start with `--domain mp281x.xyz`; Gateway's origin is derived from that domain. Auth's account answer supplies admin access; Gateway has no separate admin setting.

Use `AiGateway` from `@deslop/runtime/server/ai`: `yield* gateway.apiUrl` and pass `yield* gateway.authorize(userId)` as the provider client's **construction-time** `transformClient`. Append the model's API-family path from [OpenCode's model catalog](https://opencode.ai/docs/console/models/); Go paths start with `/go`. `AiGateway.languageModel(userId, options)` uses the connected Claude account, never the catalogue balance. Gateway maps the SDK's `/connection/v1/messages?beta=true` to the saved Console API URL plus `/messages?beta=true` and forwards its headers and body.

In Console, enable `claude-haiku-5-5` on the connected Anthropic provider and copy its **Console API URL**, not its upstream Base URL or Provider ID. On Gateway, paste that address in the field under the bar and save it beside the OpenCode service-account key; an empty key input keeps the existing key. Callers receive neither key nor connection address. Missing setup fails with an instruction to enter it.

Common flags and service commands: [Deslop app runtime](https://github.com/MP281X/deslop/blob/main/packages/runtime/README.md).
