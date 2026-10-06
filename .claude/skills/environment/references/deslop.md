# Deslop

**Commands.** Vite+ caches checks by task inputs; fixes are never cached. Use `--no-cache` to prove a fresh run. Fix the branch's files with `vp check --fix <files>`; the root fix is only for a repository-wide fix the user asked for.

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

**Components.** List existing shared components first, then `vp run --workspace-root shadcn list @shadcn`, inspect with `shadcn view` and `shadcn docs`, and add with `vp run --workspace-root shadcn add <component>`.

## Application tracing

The collector listens on `http://127.0.0.1:4318` and Jaeger on `http://127.0.0.1:16686`. CORS allows the production portfolio origin and any loopback port. A remote preview needs a reachable `VITE_OTEL_URL` and its origin allowed. The Vite source host does not run `ServerRuntime.layer` telemetry, so backend spans need the instrumented production entrypoint.

```bash
curl -fsS http://127.0.0.1:16686/api/services
curl -fsSG http://127.0.0.1:16686/api/traces --data-urlencode 'service=@deslop/portfolio-server' --data-urlencode 'lookback=10m' --data-urlencode 'limit=20' | jq '.data[] | {traceID, spans: [.spans[] | {operationName, duration, startTime}]}'
```

Logs are the collector's debug output (`docker compose --project-name deslop --file tools/compose.yaml logs --since 10m collector`); there is no log store or metrics pipeline.

## Install personal configuration

- **Sources:** `.codex/config.toml`, `.claude/settings.json`, `.claude/agents/pair.md` and `.claude/skills/{workflow,environment,maintenance,media}/`.
- **Targets:** `${CODEX_HOME:-$HOME/.codex}` and `${CLAUDE_CONFIG_DIR:-$HOME/.claude}`. Personal skills are real directories under the Claude target; Codex's `instructions.md` and matching skill names are symlinks to them.
- **Before writing,** compare each target with the repository's previous version. If it differs, reconcile the newer local change instead of overwriting it. Codex's installed `config.toml` carries local settings (service tier, trusted projects): edit only the changed keys.
- **Write** only the changed files, atomically, keeping permissions and symlinks. Remove a retired file only when this repository owned it. Never reset a native root or delete public or unrelated skills.
- **Verify** installed bytes and symlink targets. New sessions load the change; no restart is needed. Engineering, design and testing stay repository copies refreshed through the coding-standards CLI.
