# Browser proof

Prove that the supplied inputs produce the expected outcomes on the host you were given. Use the saved sign-in state, and do not survey or restart the setup. Any service you start for proof is temporary and listens on loopback. After design's visual inspection, return the journeys and captures you observed. Also return the actual errors and the states you did not prove.

## Captures

- **Sign-in.** Sign in once and run `agent-browser --session <name> state save <scratch>/auth.json`. Then reuse it with `--state <scratch>/auth.json`.
- **Setup.** `set media dark` sets the real color preference; a dark class alone does not. `set viewport <width> <height>` sets the size. Wait for the content and fonts, never a fixed delay.
- **Screenshots.** Take static proof with `screenshot <path.png>`.
- **Video.** In one session, run `record start <path.mp4> --contact-sheet` on the open page before the first meaningful input, then `record stop`. Inspect the contact sheet. The default 30 fps H.264 plays on a phone.
- **Navigation.** Passing a URL to `record start` navigates, so pass one only to prove navigation.
- **Locators.** Reuse locators and refresh `snapshot -i -c` when targets change. Batch independent reads in one `eval`. Wait with a selector or `wait --fn '<condition>'`. DOM assertions are not visual proof.

## Fast recording

- **Host.** Record on the host that is already running; do not start a production build only for a video.
- **Setup.** Create the data the journey needs through the API or a seed command, not through the UI on camera.
- **Script.** Write the journey as one batch of agent-browser commands and record it in a single take. When the UI changes, rerun the batch instead of driving it again by hand.
- **Scope.** Record behavior only; use screenshots for static states. Record once at the end, and re-record only when the shown UI changed.

## PR captures

A capture proves one claim, and a reviewer must read it at the body's width.

- **Claim first.** Open each video with a title card that states the claim, such as "a signed Jira delivery starts a run". Caption each chapter.
- **End on the outcome.** Hold the result for two seconds: the run, the file, the rejection or the filled table. A form left empty or a dialog opened is not proof.
- **Start ready.** Seed the data before recording, and wait until loading ends before each chapter. A spinner, skeleton or placeholder on camera means the take restarts, unless loading is the claim.
- **Legible.** Use a 1280×800 viewport at a device scale of 2. Screenshot the element with `screenshot <selector> <path>`, not the window. Record with `--cursor`, and use `highlight <selector>` before a click that matters.
- **Short.** Keep each video under 90 seconds and one journey long. Cut waits, or speed them up with a caption that says so. Use at most eight screenshots per body.
- **Current.** Capture after the final code, and name each file by its claim, such as `jira-rule-starts-run.mp4`. Compare each capture with the head's UI text before publishing.
- **Real events.** Trigger the provider for real when an account exists, or send a signed request with `curl` when it does not. Ask the user for the provider-side step, with an exact guide, when you cannot do it.

## Previews

Bind a requested preview to `127.0.0.1` on a free port (`ss -ltn`). Expose it with `sudo tailscale serve --bg --https=<port> http://127.0.0.1:<port>`. Get the host from `tailscale status --json | jq -r '.Self.DNSName | rtrimstr(".")'`. The first request waits for a certificate. Verify sign-in, assets and API calls through `https://<host>:<port>` before you share it.

Record the process and session identities of what you start. Restart a preview in place after a rebuild. When nobody needs it, run `sudo tailscale serve --https=<port> off` and stop its process group. A listener on a port is not yours to stop unless you started it.

## Debugging

- **React state or rerenders.** Enable the hook before the page's JavaScript runs, because enabling it later relaunches the session. Run `open --enable react-devtools <url>`, then `react tree` and `react renders start`. Reproduce once, then run `react renders stop --json` and `react inspect <fiber-id>`.
- **Timings.** Commit counts from a normal build are not CPU timings; detailed timings need a profiling build.
- **Slow input.** Run `profiler start` before the input and `profiler stop <scratch>/trace.json` after it, then analyze the events. Chrome profiles are not OTLP traces.
- **Tracing.** Use the [Deslop](../../environment/references/deslop.md#application-tracing) or [Dual](../../environment/references/dual.md) reference for endpoints. Correlate one real action's client and server spans, hierarchy, errors and durations. Compare the same action after the fix.
- **Limits.** Missing spans do not prove coverage or speed. Add storage or dashboards only for a concrete question.
