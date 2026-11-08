# Gateway

One MCP endpoint for every MCP server you connect; add servers on its page.

```bash
npm install --global @deslop/gateway
gateway service install --url https://gateway.mp281x.xyz --auth https://auth.mp281x.xyz --admins <github-id>
```

- **Register** only `https://<gateway>/mcp` in each harness; tools are named `<server>__<tool>`.
- **Admins** (`--admins`) add and connect servers; everyone signed in shares them.
- **Own tool**: `list_mcp_connections` explains a missing or failing server.

## AI proxy

Each person manages their own Anthropic, OpenRouter, OpenCode Zen and OpenCode Go keys. Keys stay in Gateway's owner-only data files; only their last four characters and last upstream status leave the server.

App servers start with `--gateway https://gateway.mp281x.xyz`. The runtime enrolls each authenticated person with a grant for that app's `--url`; enrollment forwards the session cookie or app-audience bearer to `POST /ai/grants`. A new grant replaces the previous grant for that person and app. Revoking it immediately stops new proxy calls. Without `--auth`, calls use the local developer and need no grant.

Use `AiGateway` from `@deslop/runtime/ai`: `yield* gateway.apiUrl(provider)` and pass `gateway.authorize(userId)` as the provider client's **construction-time** `transformClient`. OpenRouter's scoped `withClientTransform` does not cover streaming chat completions. OpenRouter's base includes `/v1`; its Decisions client derives `/alpha/decisions` correctly. OpenCode bases expose protocol-family paths such as `/openai/v1/chat/completions` and `/anthropic/v1/messages` without translating them.

`/ai/<provider>/<rest>` forwards method, query, body, upstream status and response bytes. Caller credentials and hop-by-hop headers are removed before inserting the person's provider key. Missing keys return HTTP 402 with instructions to add a key in Gateway. JSON and SSE usage is metered asynchronously; provider-reported cost wins, then daily-cached models.dev prices, otherwise cost remains unknown. Usage is stored per person and UTC month.

Person-scoped RPCs: `ai.keys`, `ai.setKey`, `ai.removeKey`, `ai.grants`, `ai.revokeGrant`, `ai.usage`. Usage queries take epoch-millisecond `from` (inclusive), `to` (exclusive), and `bucket` (`hour` or `day`); `AiUsageReport` returns token/cost totals, UTC buckets split by app and model, and breakdowns by app, model and provider. `unknownCostCalls` distinguishes unknown cost from zero cost.

Common flags and service commands: [Deslop app runtime](https://github.com/MP281X/deslop/blob/main/packages/runtime/README.md).
