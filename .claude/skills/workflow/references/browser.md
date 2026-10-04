# Browser and runtime proof

**Scope.** Prove supplied inputs → outcomes/URL with saved state. Apply design; reuse the supplied host, not a setup survey. This procedure owns capture, profiling and requested exposure; stop only owned services.

**Return.** Return observed journeys/captures and actual errors or unproved states. Apply design's visual inspection; DOM checks alone are not visual proof.

## Proof and previews

Proof services are temporary loopback services; persistent exposed previews are opt-in. Static proof uses `screenshot <path.png>`; record behavior, and use before/after only for a meaningful comparison.

Record owned process/session identities when starting proof services. Stop those identities only after confirming ownership; a listener found by port is not disposal permission. Use a free port instead of stopping another owner's listener.

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

Use the affected repository's environment reference for endpoints and known instrumentation: [Deslop](../../environment/references/deslop.md#application-tracing) or [Dual](../../environment/references/dual.md). Correlate one real action's client/server spans, errors and durations, then compare after the fix. Missing spans or allowed preflight do not prove tracing coverage or speed. Use existing observability; extra storage/dashboards need a concrete question.
