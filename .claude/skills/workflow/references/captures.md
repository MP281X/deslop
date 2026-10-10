# Captures

The primary proves each ticket journey in T3's browser on the running preview, then composes proof videos. Do not survey or restart the setup. After design's visual inspection, keep the observed journeys and captures, the actual errors and the states you did not prove.

## Tools

- **Tab.** Check `preview_status`, then open your own tab with `preview_open`, `reuseExistingTab: false` and a saved browser profile, which reuses its logins. Pass its `tabId` to every call, and use `open: false` for background proof. Sign in through the app only when the profile has no session. Close the tab with `t3_preview_close` when the proof is done.
- **Setup.** `preview_set_appearance` sets the real color preference; a dark class alone does not. `preview_resize` sets the viewport. Wait with `preview_wait_for` on text, a locator or a URL, never a fixed delay.
- **Video.** Record each chapter as its own file, from `preview_recording_start` before the first meaningful input to `preview_recording_stop` after its outcome. Build a contact sheet with `ffmpeg -i <video> -vf fps=1,scale=640:-1,tile=4x4 <sheet-%03d.png>` and inspect every sheet.
- **Targets.** Right after `preview_recording_start`, and before each input that matters, read the target's center and the time in one `preview_evaluate`. Subtract the first reading's time to place each target in the recording.
- **Compose.** Copy [proof-video.html](proof-video.html) to `index.html` in a scratch project, with the recordings and the app's font file in `assets/`. Edit only its marked parts. Never run HyperFrames' `feedback`, `publish` or cloud commands, because they send project data out.

```js
;(() => {
	const r = document.querySelector('<selector>').getBoundingClientRect()
	return {t: Date.now(), fx: (r.left + r.width / 2) / innerWidth, fy: (r.top + r.height / 2) / innerHeight}
})()
```

```bash
export HYPERFRAMES_NO_TELEMETRY=1 HYPERFRAMES_BROWSER_PATH=$(ls -d ~/.t3/tools/chrome-headless-shell/linux64/*/chrome-headless-shell | tail -1)
vpx hyperframes@0.8.141 check
vpx hyperframes@0.8.141 render --quality delivery --output <claim>.mp4
```

- **Locators.** Batch independent reads in one `preview_evaluate`. DOM assertions are not visual proof.
- **Timeouts.** Give each step of a walk a timeout of 15 seconds or less, and longer only for a measured slow step such as an AI run. On the first failure, read the screen, console and failed requests, and fix the cause before the next run.
- **Host recovery.** Keep each `preview_evaluate` under 15 seconds, because a longer one drops T3's browser host. After a host error, check `preview_status`, reopen your tab, and follow T3's fallback rules.

## Rules

Apply testing's Visual proof rule; these add the tools and the pull request specifics.

- **Match the app.** Take the font file, page surface, foreground, primary color and radius from the app's own tokens. Add no other color, font or decoration.
- **Claim first.** The claim card names the app and the area, then states the claim in two or three short lines, such as "a signed Jira delivery starts a run".
- **Camera.** Push in on each chapter's target at 1.2 to 1.8 times, so its text reads at phone width. Keep the target whole in the frame.
- **Captions.** Give each chapter one numbered caption under the recording, under twelve words, stating what the viewer sees. Crossfade between chapters and hold the outcome for at least two seconds.
- **Start ready.** Record on the running preview, never a build made only for the video.
- **Legible.** Use a 1280×800 viewport. Crop a screenshot to the element with `ffmpeg -vf crop`.
- **Chapters.** Script each chapter as one sequence of `preview_*` calls. Dry-run it, record chapters separately, and replace only a chapter whose code or outcome changed. Trim idle pauses with `data-media-start` and `data-duration`, and keep every meaningful action and outcome. Inspect frames from the render, then watch it at playback speed.
- **Current.** Name each capture by its claim, such as `jira-rule-starts-run.mp4`. Delete stale captures, and compare each kept capture with the head's UI text before publishing.
- **Real events.** Trigger the provider for real when an account exists, or send a signed request with `curl` when it does not. Ask the user for the provider-side step, with an exact guide, when you cannot do it.

## Debugging

- **React state or rerenders.** Count renders with the React Profiler API or a temporary `console.count` in the component, read through `preview_evaluate`. Remove the probe before the push.
- **Timings.** Commit counts from a normal build are not CPU timings; detailed timings need a profiling build.
- **Slow input.** Measure with `performance.mark` and `PerformanceObserver` for `longtask` and `event` entries through `preview_evaluate`.
- **Tracing.** Use the [Deslop](../../environment/references/deslop.md#application-tracing) or [Dual](../../environment/references/dual.md) reference for endpoints. Correlate one real action's client and server spans, hierarchy, errors and durations. Compare the same action after the fix.
- **Limits.** Missing spans do not prove coverage or speed. Add storage or dashboards only for a concrete question.
