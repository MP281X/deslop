# Deslop

**Commands.** Vite+ caches checks by task inputs; fixes are never cached. Use `--no-cache` to prove a fresh run. Fix the branch's files with `vp check --fix <files>`; the root fix is only for a repository-wide fix the user asked for.

```bash
flock "$HOME/.deslop/heavy.lock" nice -n 10 vp run --workspace-root --cache check
vp run --workspace-root --no-cache fix
flock "$HOME/.deslop/heavy.lock" nice -n 10 vp run --workspace-root --cache test
```

**App.** Use the source host for iteration and the built preview for release behavior, each on a free port.

```bash
HOST=127.0.0.1 vp -C apps/portfolio dev --host 127.0.0.1 --port <port> --strictPort
HOST=127.0.0.1 PORT=<port> vp run --filter @deslop/portfolio preview
```

**Components.** List existing shared components first, then `vp run --workspace-root shadcn list @shadcn`, inspect with `shadcn view` and `shadcn docs`, and add with `vp run --workspace-root shadcn add <component>`.

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

## Install personal configuration

- **Sources:** `.codex/config.toml`, `.claude/settings.json`, `.claude/agents/pair.md` and `.claude/skills/{workflow,environment}/`.
- **Targets:** `${CODEX_HOME:-$HOME/.codex}` and `${CLAUDE_CONFIG_DIR:-$HOME/.claude}`. Personal skills are real directories under the Claude target.
- **Codex links.** Codex's `instructions.md` links to the Claude target's `agents/pair.md`. Each Codex personal skill links to the matching Claude skill directory.
- **Before writing.** Compare each target with the recorded managed preimage or the repository's previous version. If it differs, reconcile the newer local change instead of overwriting it.
- **Local settings.** Codex's installed `config.toml` carries local settings such as the service tier and trusted projects. Edit only the changed keys.
- **Write.** Write only the changed files, atomically, and keep permissions and links. Create missing targets on an authorized first install. Remove a retired file or link only when this repository owned it.
- **Never.** Never reset a native root, and never delete public or unrelated skills.
- **Verify.** Check the installed bytes, the link targets, and that authentication, configuration and unrelated targets did not change. New sessions load the change without a restart.
- **Public skills.** Engineering, design and testing stay repository copies that the coding-standards CLI refreshes.
