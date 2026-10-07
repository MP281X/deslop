# Captures

Prove that the supplied inputs produce the expected outcomes on the host you were given. Do not survey or restart the setup. Any service you start for proof is temporary and listens on loopback. After design's visual inspection, return the journeys and captures you observed. Also return the actual errors and the states you did not prove.

## Tools

T3's browser runs on the worker that runs the thread, so it reaches the worker's loopback ports and tailnet URLs. Drive it with the `preview_*` tools; the user can watch the tab and take it over.

- **Tab.** Open your own tab with `preview_open` and `reuseExistingTab: false`, and pass its `tabId` to every call. Use `open: false` for background proof. Close the tab with `t3_preview_close` when the proof is done.
- **Sign-in.** Each agent session has its own isolated browser storage, so sign in once per session through the app's sign-in page.
- **Setup.** `preview_set_appearance` sets the real color preference; a dark class alone does not. `preview_resize` sets the viewport. Wait with `preview_wait_for` on text, a locator or a URL, never a fixed delay.
- **Screenshots.** `preview_snapshot` with `save: true` writes a PNG and returns its path; its accessibility tree supplies `aria-ref` locators.
- **Video.** `preview_recording_start` before the first meaningful input, then `preview_recording_stop`, which returns an H.264 MP4 at device scale 2. Build a contact sheet with `ffmpeg -i <video> -vf fps=1,scale=640:-1,tile=4x4 <sheet.png>` and inspect it.
- **Locators.** Prefer `aria-ref` and role locators from the latest snapshot. Batch independent reads in one `preview_evaluate`. DOM assertions are not visual proof.

## Rules

Apply testing's Visual proof rule; these add the tools and the pull request specifics.

- **Claim first.** Open each video with a title card that states the claim, such as "a signed Jira delivery starts a run", and caption each chapter. Hold the outcome for two seconds.
- **Start ready.** Record on the host that already runs, never a build made only for the video. Seed data through the API or a seed command. A spinner, skeleton or placeholder on camera restarts the take, unless loading is the claim.
- **Legible.** Use a 1280×800 viewport. Crop a screenshot to the element with `ffmpeg -vf crop`, and outline the target with `preview_evaluate` before a click that matters. Use at most eight screenshots per body.
- **Chapters.** Script each chapter as one sequence of `preview_*` calls. Dry-run it, record chapters separately, and replace only a chapter whose code or outcome changed. Cut the pauses between tool calls, and watch the edited video at playback speed.
- **Current.** Capture after the final code, and name each file by its claim, such as `jira-rule-starts-run.mp4`. Remove every stale capture, because a newer video does not replace it. Compare each capture with the head's UI text before publishing.
- **Real events.** Trigger the provider for real when an account exists, or send a signed request with `curl` when it does not. Ask the user for the provider-side step, with an exact guide, when you cannot do it.

## Debugging

- **React state or rerenders.** Count renders with the React Profiler API or a temporary `console.count` in the component, read through `preview_evaluate`. Remove the probe before the push.
- **Timings.** Commit counts from a normal build are not CPU timings; detailed timings need a profiling build.
- **Slow input.** Measure with `performance.mark` and `PerformanceObserver` for `longtask` and `event` entries through `preview_evaluate`.
- **Tracing.** Use the [Deslop](../../environment/references/deslop.md#application-tracing) or [Dual](../../environment/references/dual.md) reference for endpoints. Correlate one real action's client and server spans, hierarchy, errors and durations. Compare the same action after the fix.
- **Limits.** Missing spans do not prove coverage or speed. Add storage or dashboards only for a concrete question.
