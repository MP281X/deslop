# Captures

Use testing for evidence validity. This reference owns capture tools and presentation.

## Presentation

- **Screenshot or video.** Use inspected screenshots for layout and short videos for behavior, at consistent sizes in the user's theme.
- **Readability.** Crop to the relevant area without hiding context. Frame text at a scale that reads on a phone. Seed realistic data first; show loading only when loading is the claim.
- **Phone proof.** If desktop footage still makes the relevant text too small, record the journey at phone width or use a closer crop. Do not use a readable caption to excuse unreadable application evidence.
- **Video.** Keep input, action and outcome in sequence. Remove idle time and unnecessary introductions before increasing playback speed. Keep the meaningful action at real speed by default and each outcome readable for at least two seconds. Label accelerated footage; never use it as a performance measurement. Record chapters separately and replace only a changed chapter.
- **Style.** Match the app's font, surface, foreground, primary color and radius. Open on the real action, not an animated title. Add a caption only for meaning the recording does not already show, under twelve words. Add no unrelated decoration or repeated summary.
- **Camera.** Keep the whole target visible. Composed desktop recordings use a 1.2 to 1.8 zoom and tap rings. Native captures keep their real framing.
- **Inspect.** Replay the captured files and rendered video, including intermediate frames. Check legibility at phone width before you add a capture to a body.

## Browser

- **Tab.** The thread has one browser tab, shared with the user. Find it with `preview_status`: the user's tab on the preview while no human controls it, else your earlier tab. Open one only when neither exists, with `preview_open`, a saved profile, `open: true` and the preview URL. Pass its `tabId` to every call and navigate it to change pages. Never set `reuseExistingTab: false` or open a second tab on the preview. While the user controls the tab, do other work and drive it after he releases control. Use the actual built preview for final browser proof when available; a development watcher is iteration evidence only. Sign in only when the profile lacks a session. Leave the tab open on the changed screen at the end of each turn; never close it.
- **Appearance.** Set the real theme with `preview_set_appearance`, not a dark class; set size with `preview_resize`. Wait on text, a locator or URL through `preview_wait_for`, never a fixed delay.
- **Calls.** Batch independent reads in `preview_evaluate`; keep calls and walk-step timeouts under 15 seconds unless a measured slow action needs longer. After a host error, inspect `preview_status` and reopen your tab. After an action fails, inspect the screen, console and failed requests before retrying.
- **Recording.** Use `preview_recording_start` before meaningful input and `preview_recording_stop` after the outcome. Desktop chapters use a 1280×800 viewport. Inspect contact sheets with `ffmpeg -i <video> -vf fps=1,scale=640:-1,tile=4x4 <sheet-%03d.png>`. Crop screenshots with `ffmpeg -vf crop`.
- **Seeking.** Resolve sparse-keyframe warnings before composition; they can freeze a source during frame capture. Re-encode that source with a keyframe interval of at most one second, preserve its timing, then inspect the encoded source and final video. Do not confuse a seeking repair with faster application behavior.
- **Targets.** For composed video, read each target's center and time immediately after recording starts and before a meaningful input or outcome. The first reading anchors time; later readings set composition `at` to the chapter's `data-start` minus `data-media-start` plus elapsed seconds. Retiming requires remapping these moments and checking the final encoded video, not merely changing a duration or nominal frame rate.

```js
;(() => {
	const r = document.querySelector('<selector>').getBoundingClientRect()
	return {t: Date.now(), fx: (r.left + r.width / 2) / innerWidth, fy: (r.top + r.height / 2) / innerHeight}
})()
```

## Native apps

Use environment's device-host procedure to boot a simulator on `macbook-pro`. Read the app's simulator commands, then use T3's device tools.

- **Session.** Keep the exact launcher and flags from `device_open` on every call. Run `open <bundle id>` before `snapshot -i`, `screenshot` or recording; snapshots supply interaction refs.
- **Files.** Use `screenshot <path> --pixel-density 3`, `record start <path>` and `record stop` for native-resolution captures.

## Compose

Copy [proof-video.html](proof-video.html) into a scratch project with chapter recordings and the app font in `assets/`. Edit its marked tokens, chapters and necessary captions. Dry-run the journey before recording. Use brief camera movements that arrive before the input; crossfade chapters without a blank frame. Replay actual timing and inspect slowed intermediate frames, loop seams and encoded output. Stills, frame counts and template validation do not prove smooth playback.

```bash
export HYPERFRAMES_NO_TELEMETRY=1 HYPERFRAMES_BROWSER_PATH=$(ls -d ~/.t3/tools/chrome-headless-shell/linux64/*/chrome-headless-shell | tail -1)
vpx hyperframes@0.8.141 check
vpx hyperframes@0.8.141 render --quality delivery --output <claim>.mp4
```

Never run HyperFrames feedback, publish or cloud commands; they send project data out.
