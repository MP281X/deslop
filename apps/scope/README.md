# Scope

A debugger for Effect apps: it receives their traces and logs, and agents query them.

```bash
npm install --global @deslop/scope
scope service install --url https://scope.mp281x.xyz --auth https://auth.mp281x.xyz
```

- **Send** telemetry by starting other apps with `--traces https://scope.mp281x.xyz`; it accepts OTLP/HTTP JSON from anywhere and keeps three days.
- **MCP** at `/mcp`: `list_services`, `find`, `read_trace`, `measure_latency`.

Common flags and service commands: [Deslop app runtime](https://github.com/MP281X/deslop/blob/main/packages/runtime/README.md).
