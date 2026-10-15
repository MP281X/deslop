# Deslop

**Issues.** Deslop has no issue tracker; GitHub holds only its pull requests, so the request is the whole task.

**Agent configuration.** The Claude pair and Codex instructions differ only before "# Core": keep every edit below that heading identical.

**Commands.** Vite+ caches checks by task inputs and never caches fixes. Use `--no-cache` to prove a fresh run. Run root checks and rule tests sequentially: rule tests create temporary source fixtures that a concurrent type scan can read while they disappear.

```bash
vp run --workspace-root --cache check
vp run --workspace-root --no-cache fix
vp run --workspace-root --cache test
```

**App.** Run the portfolio preview for iteration, browser testing, captures and handoff; the script sets `HOST` and `PORT`. The stash server has no worktree preview: its preview command keeps port 5017 and the real notes in `~/.deslop/stash`, which the running stash on dev uses.

```bash
bash ~/.claude/skills/environment/scripts/preview.sh start vp run --filter @deslop/portfolio preview
```

**Components.** List the existing shared components first. Inspect with `vp run --workspace-root shadcn list @shadcn`, `vp run --workspace-root shadcn view <component>` and `vp run --workspace-root shadcn docs <component>`.

## Application tracing

On dev only, the collector listens on `http://127.0.0.1:4318` and Jaeger on `http://127.0.0.1:16686`. CORS allows the production portfolio origin and any loopback port.

- **Browser.** The browser exports to localhost on its own machine. A remote preview needs a reachable `VITE_OTEL_URL` with its origin allowed.
- **Proof.** An allowed preflight does not prove that the app emits spans.

```bash
curl -fsS http://127.0.0.1:16686/api/services
curl -fsSG http://127.0.0.1:16686/api/traces --data-urlencode 'service=@deslop/portfolio-server' --data-urlencode 'lookback=10m' --data-urlencode 'limit=20' | jq '.data[] | {traceID, spans: [.spans[] | {operationName, duration, startTime}]}'
```

Logs are the collector's debug output (`docker compose --project-name deslop --file tools/compose.yaml logs --since 10m collector`); there is no log store or metrics pipeline.

## Coding standards

`tools/coding-standards` holds the `@deslop/coding-standards` package: the oxlint preset, which the root `vite.config.ts` extends, and the shared skills. Edit the skills in the package's `skills/`, then refresh the copies in `.claude/skills` and `.codex/skills` with `node tools/coding-standards/src/install.ts`.
