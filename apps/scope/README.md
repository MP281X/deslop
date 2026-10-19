# @deslop/scope

An Effect development debugger: a private OTLP/HTTP JSON receiver on port 4318 whose traces and logs agents query through an OAuth-protected MCP endpoint on port 5000.

```bash
npx @deslop/scope@latest                                    # http://127.0.0.1:4318, data in ~/.deslop/scope
claude mcp add --transport http scope https://scope.mp281x.xyz/mcp
claude mcp login scope --no-browser
codex mcp add scope --url https://scope.mp281x.xyz/mcp
codex mcp login scope
```

Trusted local exporters use `http://127.0.0.1:4318/v1/traces` and `/v1/logs` with `content-type: application/json`; never publish port 4318 to the internet. The public port serves MCP and authenticated ingestion. `HOST` changes the bind address; `PORT` changes the public port. Authorization uses Deslop Auth; no pasted API keys. Remote Codex clients need an HTTPS OAuth callback forwarded to their listener. Claude Code's headless login accepts the full callback URL when the phone cannot reach its localhost redirect.

| Tool       | Returns                                                                  |
| ---------- | ------------------------------------------------------------------------ |
| `services` | Services with a current run and their runtime: web, mobile or server     |
| `traces`   | Matching traces, newest or slowest first, with the total match count     |
| `spans`    | Matching spans with their original OTLP fields                           |
| `logs`     | Matching logs, standalone or attached to a span                          |
| `stats`    | Span count, errors and p50, p95 and max latency over the whole window    |
| `trace`    | One trace whole: spans in parent order with depth, offset and their logs |

`traces`, `spans`, `logs` and `stats` take `service`, `operation`, `traceId`, `text`, `errors` and `since` (`"10 minutes"` by default); `traces`, `spans` and `logs` add `limit` and `offset`; `traces` and `spans` add `sort`. Only the current run of each service is visible: when a service exports a newer run, every trace it took part in before is hidden.
