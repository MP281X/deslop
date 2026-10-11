# Captures

The primary proves each ticket journey in T3's browser, then composes proof videos.

## Tools

- **Tab.** Check `preview_status`, then open your own tab with `preview_open`, `reuseExistingTab: false` and a saved browser profile, which keeps its logins. Pass the `tabId` to every call, and use `open: false` for background proof. Sign in through the app only when the profile has no session. Close the tab with `t3_preview_close` when done.
- **Setup.** `preview_set_appearance` sets the real color preference; a dark class does not. `preview_resize` sets the viewport. Wait with `preview_wait_for` on text, a locator or a URL, never a fixed delay.
- **Reads.** Batch independent reads in one `preview_evaluate`, and keep each call under 15 seconds, because a longer call drops T3's browser host. After a host error, check `preview_status` and reopen your tab.
- **Timeouts.** Give each step of a walk a timeout of 15 seconds or less, longer only for a measured slow step such as an AI run. On the first failure, read the screen, console and failed requests, and fix the cause before the next run.
- **Video.** Record each chapter as its own file, from `preview_recording_start` before the first meaningful input to `preview_recording_stop` after its outcome. Inspect every contact sheet from `ffmpeg -i <video> -vf fps=1,scale=640:-1,tile=4x4 <sheet-%03d.png>`.
- **Targets.** Right after `preview_recording_start`, and before each input that matters, read the target's center and the time in one `preview_evaluate`. Subtract the first reading's time to place each target in the recording.
- **Compose.** Copy [proof-video.html](proof-video.html) to `index.html` in a scratch project, with the recordings and the app's font file in `assets/`, and edit only its marked parts. Never run HyperFrames' `feedback`, `publish` or cloud commands, because they send project data out.

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

## Native apps

Native screens prove on the iOS Simulator of `macbook-pro` through T3's device tools; the app's README names its build and Metro commands.

- **Device.** `device_list` shows only simulators that ran once; boot a new one with `ssh matteopaludgnach@macbook-pro 'xcrun simctl boot <udid>'`. `device_open` returns an `agent-device` command: append its flags to every call.
- **Session.** Run `open <bundle id>` first, because `screenshot` and `snapshot` fail with `SESSION_NOT_FOUND` before it. `snapshot -i` lists refs such as `@e3` for `click` and `fill`.
- **Captures.** `screenshot <path> --pixel-density 3` saves a PNG at the device's resolution. `record start <path>` and `record stop` record a chapter. The rules below apply, except Start ready, Legible and Chapters.

## Rules

Apply testing's Visual proof rule, and add these:

- **Match the app.** Take the font file, page surface, foreground, primary color and radius from the app's tokens. Add no other color, font or decoration.
- **Claim first.** The claim card names the app and the area, then states the claim in two or three short lines, such as "a signed Jira delivery starts a run".
- **Camera.** Push in on each chapter's target at 1.2 to 1.8 times, so its text reads at phone width, with the target whole in the frame.
- **Captions.** Give each chapter one numbered caption under the recording, under twelve words, that states what the viewer sees. Crossfade between chapters, and hold the outcome for at least two seconds.
- **Start ready.** Record on the running preview, never on a build made only for the video.
- **Legible.** Use a 1280×800 viewport. Crop a screenshot to the element with `ffmpeg -vf crop`.
- **Chapters.** Script each chapter as one sequence of `preview_*` calls, and dry-run it. Record chapters separately, and replace only a chapter whose code or outcome changed. Trim idle pauses with `data-media-start` and `data-duration`, and keep every meaningful action and outcome. Inspect frames from the render, then watch it at playback speed.
- **Current.** Name each capture by its claim, such as `jira-rule-starts-run.mp4`. Delete stale captures, and compare each kept capture with the head's UI text before publishing.
- **Real events.** Trigger the provider for real when an account exists; otherwise send a signed request with `curl`. When you cannot do the provider-side step, give the user a guide.

## Debugging

- **Rerenders.** Count renders with the React Profiler API or a temporary `console.count`, read through `preview_evaluate`. Remove the probe before the push. Commit counts from a normal build are not CPU timings; detailed timings need a profiling build.
- **Slow input.** Measure with `performance.mark` and a `PerformanceObserver` for `longtask` and `event` entries through `preview_evaluate`.
- **Tracing.** Take the endpoints from the [Deslop](../../environment/references/deslop.md#application-tracing) or [Dual](../../environment/references/dual.md) reference. Correlate one real action's client and server spans, hierarchy, errors and durations, and compare the same action after the fix. Missing spans do not prove coverage or speed.
