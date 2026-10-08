# Deslop

**Issues.** Deslop is personal software without an issue tracker. GitHub holds only its pull requests, so the request is the whole task.

**Commands.** Vite+ caches checks by task inputs; fixes are never cached. Use `--no-cache` to prove a fresh run.

```bash
vp run --workspace-root --cache check
vp run --workspace-root --no-cache fix
vp run --workspace-root --cache test
```

**App.** Use the source host for iteration and the built preview for release behavior, each on a free port.

```bash
HOST=127.0.0.1 vp -C apps/portfolio dev --host 127.0.0.1 --port <port> --strictPort
HOST=127.0.0.1 PORT=<port> vp run --filter @deslop/portfolio preview
```

**Components.** List existing shared components first, then `vp run --workspace-root shadcn list @shadcn`, inspect with `vp run --workspace-root shadcn view <component>` and `shadcn docs <component>`, and add with `vp run --workspace-root shadcn add <component>`.

## Application tracing

On dev only, the collector listens on `http://127.0.0.1:4318` and Jaeger on `http://127.0.0.1:16686`. CORS allows the production portfolio origin and any loopback port.

- **Browser defaults.** The browser exports to localhost on the browser's own machine. A remote preview needs a reachable `VITE_OTEL_URL` and its origin allowed.
- **Source host.** The Vite source host supplies RPC and platform layers, not `ServerRuntime.layer` telemetry. Backend spans need the instrumented production entrypoint or scoped runtime instrumentation.
- **Proof.** An allowed preflight does not prove that the app emits spans.

```bash
curl -fsS http://127.0.0.1:16686/api/services
curl -fsSG http://127.0.0.1:16686/api/traces --data-urlencode 'service=@deslop/portfolio-server' --data-urlencode 'lookback=10m' --data-urlencode 'limit=20' | jq '.data[] | {traceID, spans: [.spans[] | {operationName, duration, startTime}]}'
```

Logs are the collector's debug output (`docker compose --project-name deslop --file tools/compose.yaml logs --since 10m collector`); there is no log store or metrics pipeline.

## Coding standards

Deslop owns the `@deslop/coding-standards` package in `tools/coding-standards`: the oxlint preset and the engineering, design and testing skills.

- **Lint.** The root `vite.config.ts` extends the preset for the whole repository.
- **Skills.** Edit the package's `skills/` sources, then refresh the copies in `.claude/skills` and `.codex/skills` with `node tools/coding-standards/src/install.ts`.
