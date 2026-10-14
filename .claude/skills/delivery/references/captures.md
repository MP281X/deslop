# Captures

Use testing for evidence validity. This reference owns capture tools and presentation.

## Presentation

- **Screenshot or video.** Use inspected screenshots for layout and short videos for behavior, at consistent sizes in the user's theme.
- **Readability.** Crop to the relevant area without hiding context. Frame text at a scale that reads on a phone. Seed realistic data first; show loading only when loading is the claim.
- **Video.** Keep input, action and outcome in sequence. Trim idle time, not meaningful steps; hold each outcome for at least two seconds. Record chapters separately and replace only a changed chapter.
- **Style.** Match the app's font, surface, foreground, primary color and radius. Add no unrelated decoration. State the claim in two or three short lines; give each chapter one numbered caption under twelve words.
- **Camera.** Keep the whole target visible. Composed desktop recordings use a 1.2 to 1.8 zoom and tap rings. Native captures keep their real framing.
- **Inspect.** Replay the captured files and rendered video, including intermediate frames. Check legibility at phone width before publishing.

## Browser

- **Tab.** Check `preview_status`, then use `preview_open` with `reuseExistingTab: false`, a saved profile and `open: false` for background proof. Pass the `tabId` to every call. Sign in only when that profile lacks a session. Close the owned tab with `t3_preview_close` when done.
- **Appearance.** Set the real theme with `preview_set_appearance`, not a dark class; set size with `preview_resize`. Wait on text, a locator or URL through `preview_wait_for`, never a fixed delay.
- **Calls.** Batch independent reads in `preview_evaluate`; keep calls and walk-step timeouts under 15 seconds unless a measured slow action needs longer. After a host error, inspect `preview_status` and reopen your tab. After an action fails, inspect the screen, console and failed requests before retrying.
- **Recording.** Use `preview_recording_start` before meaningful input and `preview_recording_stop` after the outcome. Desktop chapters use a 1280×800 viewport. Inspect contact sheets with `ffmpeg -i <video> -vf fps=1,scale=640:-1,tile=4x4 <sheet-%03d.png>`. Crop screenshots with `ffmpeg -vf crop`.
- **Targets.** For composed video, read each target's center and time immediately after recording starts and before a meaningful input or outcome. The first reading anchors time; later readings set composition `at` to the chapter's `data-start` minus `data-media-start` plus elapsed seconds.

```js
;(() => {
	const r = document.querySelector('<selector>').getBoundingClientRect()
	return {t: Date.now(), fx: (r.left + r.width / 2) / innerWidth, fy: (r.top + r.height / 2) / innerHeight}
})()
```

## Native apps

Boot a simulator on `macbook-pro` per [device host](../../environment/references/maintenance.md#device-host). Read the app's build and Metro commands, then use T3's device tools.

- **Session.** Keep the exact launcher and flags from `device_open` on every call. Run `open <bundle id>` before `snapshot -i`, `screenshot` or recording; snapshots supply interaction refs.
- **Files.** Use `screenshot <path> --pixel-density 3`, `record start <path>` and `record stop` for native-resolution captures.

## Compose

Copy [proof-video.html](proof-video.html) into a scratch project with chapter recordings and the app font in `assets/`. Edit its marked tokens, claim, chapters and captions. Dry-run the journey before recording; inspect rendered frames after rendering.

```bash
export HYPERFRAMES_NO_TELEMETRY=1 HYPERFRAMES_BROWSER_PATH=$(ls -d ~/.t3/tools/chrome-headless-shell/linux64/*/chrome-headless-shell | tail -1)
vpx hyperframes@0.8.141 check
vpx hyperframes@0.8.141 render --quality delivery --output <claim>.mp4
```

Never run HyperFrames feedback, publish or cloud commands; they send project data out.
