# Captures

Prove that the supplied inputs produce the expected outcomes on the host you were given. Use the saved sign-in state, and do not survey or restart the setup. Any service you start for proof is temporary and listens on loopback. After design's visual inspection, return the journeys and captures you observed. Also return the actual errors and the states you did not prove.

## Tools

- **Sign-in.** Sign in once and run `agent-browser --session <name> state save <scratch>/auth.json`. Then reuse it with `--state <scratch>/auth.json`.
- **Setup.** `set media dark` sets the real color preference; a dark class alone does not. `set viewport <width> <height>` sets the size. Wait for the content and fonts, never a fixed delay.
- **Screenshots.** Take static proof with `screenshot <path.png>`.
- **Video.** In one session, run `record start <path.mp4> --contact-sheet` on the open page before the first meaningful input, then `record stop`. Inspect the contact sheet. The default 30 fps H.264 plays on a phone.
- **Navigation.** Passing a URL to `record start` navigates, so pass one only to prove navigation.
- **Locators.** Reuse locators and refresh `snapshot -i -c` when targets change. Batch independent reads in one `eval`. Wait with a selector or `wait --fn '<condition>'`. DOM assertions are not visual proof.

## Rules

Apply testing's Visual proof rule; these add the tools and the pull request specifics.

- **Claim first.** Open each video with a title card that states the claim, such as "a signed Jira delivery starts a run", and caption each chapter. Hold the outcome for two seconds.
- **Start ready.** Record on the host that already runs, never a build made only for the video. Seed data through the API or a seed command. A spinner, skeleton or placeholder on camera restarts the take, unless loading is the claim.
- **Legible.** Use a 1280×800 viewport at a device scale of 2. Screenshot the element with `screenshot <selector> <path>`, record with `--cursor`, and run `highlight <selector>` before a click that matters. Use at most eight screenshots per body.
- **Chapters.** Script each chapter as one batch of agent-browser commands. Dry-run it, record chapters separately, and replace only a chapter whose code or outcome changed. Remove browser-command overhead, and watch the edited video at playback speed.
- **Current.** Capture after the final code, and name each file by its claim, such as `jira-rule-starts-run.mp4`. Remove every stale capture, because a newer video does not replace it. Compare each capture with the head's UI text before publishing.
- **Real events.** Trigger the provider for real when an account exists, or send a signed request with `curl` when it does not. Ask the user for the provider-side step, with an exact guide, when you cannot do it.

## Debugging

- **React state or rerenders.** Enable the hook before the page's JavaScript runs, because enabling it later relaunches the session. Run `open --enable react-devtools <url>`, then `react tree` and `react renders start`. Reproduce once, then run `react renders stop --json` and `react inspect <fiber-id>`.
- **Timings.** Commit counts from a normal build are not CPU timings; detailed timings need a profiling build.
- **Slow input.** Run `profiler start` before the input and `profiler stop <scratch>/trace.json` after it, then analyze the events. Chrome profiles are not OTLP traces.
- **Tracing.** Use the [Deslop](../../environment/references/deslop.md#application-tracing) or [Dual](../../environment/references/dual.md) reference for endpoints. Correlate one real action's client and server spans, hierarchy, errors and durations. Compare the same action after the fix.
- **Limits.** Missing spans do not prove coverage or speed. Add storage or dashboards only for a concrete question.
