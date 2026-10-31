# Scope

An Effect development debugger: a private OTLP/HTTP JSON receiver on port 4318, queried by agents through an OAuth-protected MCP endpoint on port 5000, reached through the [gateway](../gateway/README.md).

- **Runs** on dev from `tools/compose.yaml`; data in `~/.deslop/scope`, entries under `entries/` for three days by exporter time.
- **Trusted exporters**: `http://127.0.0.1:4318/v1/traces` and `/v1/logs`, `content-type: application/json`. Never publish 4318 to the internet.
- **Public port**: MCP and authenticated ingestion, through Deslop [Auth](../auth/README.md); no API keys. `HOST` sets the bind address, `PORT` the public port.

| Tool              | Returns                                                                                                    |
| ----------------- | ---------------------------------------------------------------------------------------------------------- |
| `list_services`   | Every stored service's latest run, runtime, last event time and entry count, plus rejected-export counters |
| `find`            | Matching traces, spans with their OTLP fields, or logs, newest or slowest first, with the total count      |
| `measure_latency` | Span count, errors and p50, p95 and max latency over the whole window                                      |
| `read_trace`      | One stored trace whole, including earlier runs, with parent order, offsets and logs                        |

## Ingestion health

Start with `list_services`.

- **Times**: `lastEventAt` and `runStartedAt` are exporter-clock Unix nanoseconds; a zero run marker means no valid run start was exported.
- **`entries`** counts the latest run only; a missing service has no retained telemetry, which proves nothing about its health.
- **Rejections** per ingestion port, route, status and credential header (`authorization`, `cookie`, `none`); they can't name the app, and anonymous visitors cause 401s too. No credentials or bodies kept. `since` and `lastAt` are receiver-clock Unix milliseconds; counters reset on restart.
- **No self-export**: Scope's own diagnostic traffic stays out of it.
