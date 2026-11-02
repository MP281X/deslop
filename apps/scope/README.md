# Scope

An Effect development debugger: a public OTLP/HTTP JSON receiver, queried by agents through an OAuth-protected MCP endpoint reached through the [gateway](../gateway/README.md), and read by people at `https://scope.mp281x.xyz`.

- **Runs** on dev as a service; entries under `entries/` in its data directory for three days by exporter time, at most 10 MB per export.
- **Exporters**: `https://scope.mp281x.xyz/v1/traces` and `/v1/logs`, `content-type: application/json`, from any origin without credentials; apps pass `--traces https://scope.mp281x.xyz`, phones export there directly.
- **MCP and the web page** need a Deslop sign-in through [Auth](../auth/README.md); no API keys.
- **Web page**: the traces of the last three days by service, each opened as a waterfall with its spans' attributes and logs; its RPCs (`scope.services`, `scope.traces`, `scope.trace`) answer what `list_services`, `find` and `read_trace` do.

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
- **Rejections** per route, status and credential header (`authorization`, `cookie`, `none`); they can't name the app. No credentials or bodies kept. `since` and `lastAt` are receiver-clock Unix milliseconds; counters reset on restart.
- **No self-export**: Scope's own diagnostic traffic stays out of it.
