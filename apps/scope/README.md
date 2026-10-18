# @deslop/scope

An Effect development debugger: an OTLP/HTTP JSON receiver on port 4318 whose traces and logs agents query through MCP.

```bash
npx @deslop/scope@latest                                    # http://127.0.0.1:4318, data in ~/.deslop/scope
claude mcp add --transport http scope http://127.0.0.1:4318/mcp
codex mcp add scope --url http://127.0.0.1:4318/mcp
```

Apps export to `http://127.0.0.1:4318/v1/traces` and `/v1/logs` with `content-type: application/json`. `HOST` and `PORT` change the address; the MCP endpoint has no authentication, so expose it only on a private network.

| Tool       | Returns                                                                  |
| ---------- | ------------------------------------------------------------------------ |
| `services` | Services with a current run and their runtime: web, mobile or server     |
| `traces`   | Matching traces, newest or slowest first, with the total match count     |
| `spans`    | Matching spans with their original OTLP fields                           |
| `logs`     | Matching logs, standalone or attached to a span                          |
| `stats`    | Span count, errors and p50, p95 and max latency over the whole window    |
| `trace`    | One trace whole: spans in parent order with depth, offset and their logs |

`traces`, `spans`, `logs` and `stats` take `service`, `operation`, `traceId`, `text`, `errors` and `since` (`"10 minutes"` by default); `traces`, `spans` and `logs` add `limit` and `offset`; `traces` and `spans` add `sort`. Only the current run of each service is visible: when a service exports a newer run, every trace it took part in before is hidden.
