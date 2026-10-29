# Video

A proof video is a short motion piece the user wants to watch; a raw recording only for a single action. Storyboard first: per chapter the claim, the focal element, the input and the payoff; one chapter per claim, one dataset. It opens on the real subject with its value visible in its first frames and ends on the verified outcome, held until it reads. The camera lands on each input before it happens and holds still while the change happens; real speed for the meaningful action, accelerated footage labelled. One caption per chapter naming its benefit in a few words; frames read at 390 px wide without zoom.

- **Camera targets.** Read each input's target and the outcome's box with `preview_evaluate` right after recording starts and before each input:

  ```js
  ;(() => {
  	const r = document.querySelector('<selector>').getBoundingClientRect()
  	// Fractions of the recording after its crop to multiples of 16.
  	const w = Math.floor(innerWidth / 16) * 16
  	const h = Math.floor(innerHeight / 16) * 16
  	const box = [r.left / w, r.top / h, r.width / w, r.height / h]
  	return {box, t: Date.now(), target: [box[0] + box[2] / 2, box[1] + box[3] / 2]}
  })()
  ```

- **Compose** in a scratch HyperFrames project in the app's primary orientation, landscape for a desktop web app such as Dual and portrait for a phone app, with the recordings re-encoded below (a side that is not a multiple of 16 renders a black strip) and the app's font in `assets/`; `$hf docs <topic>` holds the composition contract. Every video keeps this look, in the app's font, primary and radius:
  - **Layout.** On the app's foreground hue darkened to near black, top to bottom: the progress, the caption, then the recording in a frame with the app's radius; margins of 6 % and a caption of 5 % of the short side. Nothing covers the recording but the touch marker and the reveal: no scrim, no caption over it.
  - **Progress.** One 6 px segment per chapter, filling with the primary over its chapter.
  - **Captions.** Weight 650; words rise into focus one after another (blur 12 px to 0, 0.45 s, 0.035 s stagger) and leave before the next caption.
  - **Camera.** Portrait fills the frame's width, shows about four fifths of the screen's height and only pans to each input, since a push crops rows; landscape pushes every frame meant to be read in to at most 500 CSS px of the app's width. Expo easing; each move takes 0.25–0.65 s and settles 0.2 s before its input, so the viewer watches it land.
  - **Touch.** A white marker 38 app CSS px wide, scaled with the recording, at 55 % opacity with a 3 px white border and a primary ring, enters in 0.22 s, presses to 0.78 in 0.08 s while a 0.55 s primary ripple beneath it grows to 2.6×, and fades in 0.25 s.
  - **Chapters** start 0.6 s before the previous one ends and grow out of its last input as a circular clip; the previous view dims to brightness 0.55 at 0.96 scale.
  - **Reveal.** The camera zooms onto the verified outcome, at most 2.6×, inside a 4 px primary outline offset 6 px, everything else dimmed to 80 % backdrop, entering in 0.5 s and held to the end. Energy rises only around this one reveal.
  - **Pitfalls.** A `fromTo` that starts later takes `immediateRender: false`, or its start state shows from frame one; a filter tween states its start, `brightness(1)`, or GSAP starts at zero and flashes black; select by id, since the bundler cannot parse a selector built from a template literal; the camera container taller than the stage takes `data-layout-allow-overflow`; a timed video sits in untimed wrappers, which `check` otherwise rejects as `video_nested_in_timed_element`.

```bash
hf='vpx hyperframes@latest'
export HYPERFRAMES_NO_TELEMETRY=1 HYPERFRAMES_SKIP_SKILLS=1 HYPERFRAMES_BROWSER_PATH=$(ls -d ~/.t3/tools/chrome-headless-shell/linux64/*/chrome-headless-shell | awk 'END {print}')
$hf init <claim> --example blank --resolution <landscape|portrait> --non-interactive && mkdir <claim>/assets
ffmpeg -i <recording> -vf 'crop=trunc(iw/16)*16:trunc(ih/16)*16:0:0' -r 30 -force_key_frames 'expr:gte(t,n_forced)' -c:v libx264 -pix_fmt yuv420p <claim>/assets/chapter-<n>.mp4
$hf check && $hf render --quality delivery --output <claim>.mp4 # inside <claim>/
ffmpeg -ss <second> -i <claim>.mp4 -frames:v 1 -vf scale=390:-1 <frame>.png # read each chapter's frame at phone size
ffmpeg -i <video> -vf fps=1,scale=640:-1,tile=4x4 <sheet-%03d.png>         # contact sheet of a recording
```
