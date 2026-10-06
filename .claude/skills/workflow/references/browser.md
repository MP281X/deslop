# Browser proof

Prove that the supplied inputs produce the expected outcomes on the host you were given. Use the saved sign-in state, and do not survey or restart the setup. Return the journeys and captures you observed after design's visual inspection. Also return the actual errors and the states you did not prove.

## Captures

- **Sign-in.** Sign in once and run `agent-browser --session <name> state save <scratch>/auth.json`. Then reuse it with `--state <scratch>/auth.json`.
- **Setup.** `set media dark` sets the real color preference; a dark class alone does not. `set viewport <width> <height>` sets the size. Wait for the content and fonts, never a fixed delay.
- **Screenshots.** Take static proof with `screenshot <path.png>`.
- **Video.** In one session, run `record start <path.mp4> --contact-sheet` on the open page before the first meaningful input, then `record stop`. Inspect the contact sheet. The default 30 fps H.264 plays on a phone.
- **Navigation.** Passing a URL to `record start` navigates, so pass one only to prove navigation.
- **Locators.** Reuse locators and refresh `snapshot -i -c` when targets change. Batch independent reads in one `eval`. Wait with a selector or `wait --fn '<condition>'`. DOM assertions are not visual proof.

## Previews

Bind a requested preview to `127.0.0.1` on a free port (`ss -ltn`). Expose it with `sudo tailscale serve --bg --https=<port> http://127.0.0.1:<port>`. Get the host from `tailscale status --json | jq -r '.Self.DNSName | rtrimstr(".")'`. The first request waits for a certificate. Verify sign-in, assets and API calls through `https://<host>:<port>` before you share it.

Record the process and session identities of what you start. Restart a preview in place after a rebuild. When nobody needs it, run `sudo tailscale serve --https=<port> off` and stop its process group. A listener on a port is not yours to stop unless you started it.

## Debugging

- **React state or rerenders.** Enable the hook before the page's JavaScript runs, because enabling it later relaunches the session. Run `open --enable react-devtools <url>`, then `react tree` and `react renders start`. Reproduce once, then run `react renders stop --json` and `react inspect <fiber-id>`.
- **Timings.** Commit counts from a normal build are not CPU timings; detailed timings need a profiling build.
- **Slow input.** Run `profiler start` before the input and `profiler stop <scratch>/trace.json` after it, then analyze the events. Chrome profiles are not OTLP traces.
- **Tracing.** Use the [Deslop](../../environment/references/deslop.md#application-tracing) or [Dual](../../environment/references/dual.md) reference for endpoints. Correlate one real action's client and server spans, hierarchy, errors and durations. Compare the same action after the fix.
- **Limits.** Missing spans do not prove coverage or speed. Add storage or dashboards only for a concrete question.
