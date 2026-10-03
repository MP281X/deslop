# Browser and runtime proof

Prove the assigned inputs → outcomes at the supplied URL using saved state. Apply repository design to rendered output; this reference owns capture, interaction and profiling commands. Use the supplied host/state, not a new environment survey. Return observed pass/fail, meaningful media and console errors; stop only owned services.

**Result.** Verdict first; Input | Observed outcome | Evidence table. Link meaningful screenshots/MP4 by absolute path and report actual console errors or untested states. Distinguish visual inspection from DOM assertions; no repeated journey narration.

## Proof and previews

Proof services are temporary loopback services; persistent exposed previews are opt-in. Static proof uses `screenshot <path.png>`; record behavior, and use before/after only for a meaningful comparison.

Stop only owned services, by process group; use another port rather than stop someone else's listener:

```bash
P=$(ss -ltnpH 'sport = :<port>' | grep -oP 'pid=\K[0-9]+' | head -1)
kill -- -$(ps -o pgid= -p $P | tr -d ' ')
```

- Requested preview: choose a free port (`ss -ltn`), bind `127.0.0.1`, then `sudo tailscale serve --bg --https=<port> http://127.0.0.1:<port>`. Share `https://<host>:<port>`, with `<host>` from `tailscale status --json | jq -r '.Self.DNSName | rtrimstr(".")'`; the first request waits for a certificate. Keep it running until asked to stop, then `sudo tailscale serve --https=<port> off` and stop its process group. Other threads' previews remain untouched.
- In one agent-browser session, `record start <path.mp4> --contact-sheet` on the open page before meaningful input, then `record stop`. A URL triggers navigation; supply one only to prove navigation. Default 30 fps/H.264 plays on the phone; inspect the contact sheet. Sign in once, `state save <scratch>/auth.json`, then reuse `--state <scratch>/auth.json`.
- Before capture, `agent-browser --session <name> set media dark` sets the actual color preference; `set viewport <width> <height>` sets the comparison viewport. Wait for the relevant content and loaded fonts, not an arbitrary delay. A dark class alone does not activate a media-query theme.

### Browser debugging

Reuse known locators; refresh `snapshot -i -c` when targets change, batch independent values in one `eval`, and wait for a selector or `wait --fn '<condition>'`, not blind sleeps. Capture screenshots, video and profiles on the same meaningful journey; DOM assertions do not replace image inspection.

For a suspected React state/rerender issue, enable the hook before page JavaScript (enabling it later relaunches the session):

```bash
agent-browser --session <name> open --enable react-devtools <url>
agent-browser --session <name> react tree
agent-browser --session <name> react renders start
# Reproduce the relevant input once, then collect its commits
agent-browser --session <name> react renders stop --json
agent-browser --session <name> react inspect <fiber-id>
```

For slow input/scroll/main-thread work, `profiler start` before input and `profiler stop <scratch>/browser-trace.json` after; analyze the events. This is Chrome profiling, not OTLP. `react renders` requires the DevTools hook; detailed timing requires a profiling build, so normal-build commit counts are not CPU timings.

### Application tracing

Collector HTTP is `http://127.0.0.1:4318`; Jaeger is `http://127.0.0.1:16686`. CORS allows the production portfolio origin and any loopback dev port. Browser defaults target localhost on the browser machine: VPS agents can use it; remote previews need reachable `VITE_OTEL_URL` and their actual origin allowed. Allowed preflight is not emitted spans. Deslop's Vite source host supplies RPC/platform layers, not `ServerRuntime.layer` telemetry: client export does not prove a correlated dev-server span. Backend tracing needs the instrumented production entrypoint or scoped runtime instrumentation.

```bash
curl -fsS http://127.0.0.1:16686/api/services
curl -fsSG http://127.0.0.1:16686/api/traces --data-urlencode 'service=@deslop/portfolio-server' --data-urlencode 'lookback=10m' --data-urlencode 'limit=20' | jq '.data[] | {traceID, spans: [.spans[] | {operationName, duration, startTime}]}'
```

Inspect the affected service around one real action: hierarchy, errors, durations and client/server trace IDs; compare that action after a fix. Missing spans mean unknown coverage/export, not speed. Logs use collector debug output (`docker compose --project-name deslop --file tools/compose.yaml logs --since 10m collector`), not a queryable store; no metrics pipeline. Dual SaaS optionally exports to PostHog, not Jaeger; inspect its Observability configuration. Extra storage/dashboard containers need a concrete question.
