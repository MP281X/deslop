# Browser proof

Prove that the supplied inputs produce the expected outcomes on the host you were given, using saved sign-in state; do not survey or restart the setup. Return the journeys and captures you observed after design's visual inspection, the actual errors, and the states you could not prove.

## Captures

- Sign in once, `agent-browser --session <name> state save <scratch>/auth.json`, then reuse `--state <scratch>/auth.json`.
- Before capturing, `set media dark` sets the real color preference (a dark class alone does not) and `set viewport <width> <height>` sets the size. Wait for the relevant content and fonts, never a fixed delay.
- Static proof: `screenshot <path.png>`. Behavior: `record start <path.mp4> --contact-sheet` on the open page before the first meaningful input, then `record stop`, and inspect the contact sheet. Passing a URL to `record start` navigates; do it only to prove navigation.
- Reuse locators, refresh `snapshot -i -c` when targets change, batch independent reads in one `eval`, and wait with a selector or `wait --fn '<condition>'`. DOM assertions are not visual proof.

## Previews

A requested preview binds `127.0.0.1` on a free port (`ss -ltn`), then `sudo tailscale serve --bg --https=<port> http://127.0.0.1:<port>`; share `https://<host>:<port>` with `<host>` from `tailscale status --json | jq -r '.Self.DNSName | rtrimstr(".")'`. Restart it in place after a rebuild. When it is no longer needed, `sudo tailscale serve --https=<port> off` and stop its process group. Stop only processes you started; a listener on a port is not yours to stop.

## Debugging

- **React state or rerenders.** Enable the hook before page JavaScript: `open --enable react-devtools <url>`, then `react tree`, `react renders start`, reproduce once, `react renders stop --json`, `react inspect <fiber-id>`. Normal-build commit counts are not CPU timings.
- **Slow input or main-thread work.** `profiler start` before the input and `profiler stop <scratch>/trace.json` after, then analyze the events.
- **Tracing.** Use the repository's environment reference for endpoints. Correlate one real action's client and server spans, errors and durations, and compare the same action after the fix. Missing spans do not prove coverage or speed.
