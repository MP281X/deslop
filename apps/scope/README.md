# Scope

Query the always-on Effect development debugger at https://scope.mp281x.xyz.

```bash
npx @deslop/scope@latest login '<API key from https://auth.mp281x.xyz>'
npx @deslop/scope@latest services
npx @deslop/scope@latest traces --service @deslop/portfolio-server
npx @deslop/scope@latest trace <trace-id>
npx @deslop/scope@latest watch --service @deslop/portfolio-server
```

`login` saves the API key with owner-only permissions in `~/.deslop/scope/api-key`. The web app uses the same auth app's session cookie. `SCOPE_SERVER` or `--server` overrides the server URL.

Every query writes JSON to stdout and diagnostics to stderr. `watch` emits newline-delimited JSON when matching traces change. `trace` returns the full parent-ordered span tree, frontend/backend runtimes, offsets and logs attached to their spans. `traces`, `spans`, `logs` and `stats` accept `--service`, `--operation`, `--trace`, `--text`, `--errors`, `--since '10 minutes'`, `--limit` and `--offset`. `stats` covers the entire window rather than the first page.

Only the current application runs are visible. Deslop's runtime sets `scope.runtime`, `service.instance.id` and `scope.run.started_unix_nano` resource attributes. When a participating service exports a newer run, the whole previous trace is hidden, including its spans from other services. Uncorrelated OTLP logs remain queryable through the CLI, not a separate web log feed.

For a local server started with `NODE_ENV=development`, the shared auth package uses a mock developer. Run a local CLI with the same environment and `--server http://localhost:5000`; no OAuth or API key is needed. Production requires real authentication. OTLP/HTTP JSON ingestion at `/v1/traces` and `/v1/logs` is unauthenticated.
