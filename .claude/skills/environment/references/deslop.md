# Deslop

The user's own repository: no issue tracker, so the request is the whole task. Local data is disposable; production data follows `CODING_STANDARDS.md`.

## Commands

Fix always runs at the root; check and test run on the package while you work, and at the root as the local gate before every push, one after another: rule tests create fixtures that a concurrent type scan reads. Vite+ caches checks by task inputs and never caches fixes; `--no-cache` proves a fresh run.

```bash
vp run --workspace-root --no-cache fix                                         # always at the root
vp check <package dir> && vp test run <package dir>                            # while you work
vp run --workspace-root --cache check && vp run --workspace-root --cache test  # the local gate, before every push
```

- **App.** The deslop `preview` project script runs the portfolio build for iteration, browser tests and captures. The stash server has no worktree preview: its port 5017 and real notes in `~/.deslop/stash` belong to the running stash on dev.
- **Components.** `vp run --workspace-root shadcn list @shadcn`, `shadcn view <component>`, `shadcn docs <component>`.
- **Agent configuration.** `.claude/agents/pair.md` and `.codex/instructions.md` are identical from `# Work` down. Shared skills live in `tools/coding-standards/skills/`; refresh the repository copies with `node tools/coding-standards/src/install.ts`. `.claude/skills/retrospective`, linked from `.codex/skills`, is repository-only and never installed on the workers.

## Tracing

On dev only: collector `http://127.0.0.1:4318`, Jaeger `http://127.0.0.1:16686`, CORS for the production portfolio origin and loopback. A remote preview needs a reachable `VITE_OTEL_URL`. An allowed preflight does not prove spans.

```bash
curl -fsSG http://127.0.0.1:16686/api/traces --data-urlencode 'service=@deslop/portfolio-server' --data-urlencode 'lookback=10m' --data-urlencode 'limit=20' | jq '.data[] | {traceID, spans: [.spans[] | {operationName, duration}]}'
docker compose --project-name deslop --file tools/compose.yaml logs --since 10m collector
```
