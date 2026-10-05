# Deslop

**Root commands.** Vite+ tracks task inputs; cache checks, not source-mutating fixes. Use --no-cache when proving a fresh execution. Fix the branch's files with `vp check --fix <files>`; the root fix is for a repository-wide fix the user asked for.

```bash
vp run --workspace-root --cache check
vp run --workspace-root --no-cache fix
vp run --workspace-root --cache test
```

**App.** Source host for iteration; built preview for release behavior. Choose a free port; requested remote exposure follows Browser.

```bash
HOST=127.0.0.1 vp -C apps/portfolio dev --host 127.0.0.1 --port <port> --strictPort
HOST=127.0.0.1 PORT=<port> vp run --filter @deslop/portfolio preview
```

**Components.** `vp run --workspace-root shadcn list @shadcn`; inspect with `shadcn view/docs`, add with `vp run --workspace-root shadcn add <component>`. List existing shared components before adding one.

## Application tracing

Collector HTTP is `http://127.0.0.1:4318`; Jaeger is `http://127.0.0.1:16686`. CORS allows the production portfolio origin and any loopback dev port. Browser defaults target localhost on the browser machine: VPS agents can use it; remote previews need reachable `VITE_OTEL_URL` and their actual origin allowed. Allowed preflight is not emitted spans. Deslop's Vite source host supplies RPC/platform layers, not `ServerRuntime.layer` telemetry: client export does not prove a correlated dev-server span. Backend tracing needs the instrumented production entrypoint or scoped runtime instrumentation.

```bash
curl -fsS http://127.0.0.1:16686/api/services
curl -fsSG http://127.0.0.1:16686/api/traces --data-urlencode 'service=@deslop/portfolio-server' --data-urlencode 'lookback=10m' --data-urlencode 'limit=20' | jq '.data[] | {traceID, spans: [.spans[] | {operationName, duration, startTime}]}'
```

Inspect the affected service around one real action: hierarchy, errors, durations and client/server trace IDs; compare that action after a fix. Missing spans mean unknown coverage/export, not speed. Logs use collector debug output (`docker compose --project-name deslop --file tools/compose.yaml logs --since 10m collector`), not a queryable store; no metrics pipeline. Extra storage/dashboard containers need a concrete question.

## Install personal configuration

Apply only changed, named owned targets; never reset native roots or delete public/unrelated skills to refresh personal guidance.

- Sources: `.codex/config.toml`, `.claude/settings.json`, `.claude/agents/pair.md`, and `.claude/skills/{workflow,environment,maintenance,media}/`.
- Targets: `${CODEX_HOME:-$HOME/.codex}` and `${CLAUDE_CONFIG_DIR:-$HOME/.claude}`. Keep personal skills as real directories under the Claude target; Codex's matching skill names and `instructions.md` alias those directories and `agents/pair.md`.
- Before writing, compare each installed target/alias with its recorded managed preimage or the repository baseline. If it differs, inspect/reconcile the newer change instead of overwriting it. Capture unchanged auth/config/unrelated targets for verification.
- Replace only the approved named files atomically; preserve permissions and valid aliases. Create missing targets for an authorized first install. Delete retired aliases only after ownership is established.
- Verify installed bytes/alias destinations and unrelated-target preservation. Fresh sessions load personal changes; no provider restart. Public engineering/design/testing remain repository-only and refresh through the declared CLI.
