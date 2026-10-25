# @deslop/scope

An Effect development debugger: a private OTLP/HTTP JSON receiver on port 4318 whose traces and logs agents query through an OAuth-protected MCP endpoint on port 5000.

```bash
npx @deslop/scope@latest                                    # http://127.0.0.1:4318, data in ~/.deslop/scope
claude mcp add --transport http scope https://scope.mp281x.xyz/mcp
claude mcp login scope --no-browser
codex mcp add scope --url https://scope.mp281x.xyz/mcp
codex mcp login --no-browser scope
```

Trusted local exporters use `http://127.0.0.1:4318/v1/traces` and `/v1/logs` with `content-type: application/json`; never publish port 4318 to the internet. The public port serves MCP and authenticated ingestion. `HOST` changes the bind address; `PORT` changes the public port. Authorization uses Deslop Auth; no pasted API keys.

## Connection diagnostics

Stored OAuth credentials do not prove the MCP connection works. Check the client's MCP status and tool discovery: Scope exposes the six tools below. If startup reports `OAuth authorization required`, sign in again with that client's login command above. An auth-store reset invalidates previously saved credentials.

Open the printed authorization URL in a browser on the same worker as the client. Leave it waiting; sign in at https://auth.mp281x.xyz in your own browser and approve the matching request. The worker's browser completes its localhost callback. Do not move the callback to the phone.

The public `/.well-known/oauth-protected-resource/mcp` document names the authorization server. A request without credentials gets a 401 discovery challenge; a rejected bearer adds `error="invalid_token"` and requires sign-in again. An unavailable authorization server returns 503 with `Retry-After`, not a false invalid-token challenge.

| Tool              | Returns                                                                                                    |
| ----------------- | ---------------------------------------------------------------------------------------------------------- |
| `list_services`   | Every stored service's latest run, runtime, last event time and entry count, plus rejected-export counters |
| `find_traces`     | Matching traces, newest or slowest first, with the total match count                                       |
| `find_spans`      | Matching spans with their original OTLP fields                                                             |
| `find_logs`       | Matching logs, standalone or attached to a span                                                            |
| `measure_latency` | Span count, errors and p50, p95 and max latency over the whole window                                      |
| `read_trace`      | One stored trace whole, including earlier runs, with parent order, offsets and logs                        |

`find_traces`, `find_spans`, `find_logs` and `measure_latency` take `service`, `operation`, `traceId`, `text`, `errors`, `since` (`"10 minutes"` by default) and `runs`. Paged tools add `limit` and `offset`; trace/span searches add `sort`.

Searches default to `runs: "current"`: the latest process, page load or app launch per service. When a service exports a newer run, default searches hide every older trace it took part in. Use `{"runs":"all","since":"1 hour"}` to investigate across restarts or deployments. `read_trace` opens the complete retained trace by ID regardless of run. Entries persist under `~/.deslop/scope/entries/`; this change adds no migration or reset.

## Ingestion health

Start with `list_services`. `lastEventAt` and `runStartedAt` are Unix nanoseconds from the exporter clock, not receiver arrival times; a zero run marker means the exporter supplied no valid run start. `entries` counts records from that service's latest run. A missing service has no retained telemetry, not proof that it is healthy.

Rejected requests are counted on both ingestion ports by route, HTTP status and credential-header presence (`authorization`, `cookie` or `none`). These counts cannot identify the exporting app, and anonymous public visitors also produce 401s. No credentials or request bodies are kept. `since` and each rejection's `lastAt` are receiver-clock Unix milliseconds; counters reset when Scope restarts. Scope does not export its own diagnostic traffic back into itself.
