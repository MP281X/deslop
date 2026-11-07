---
name: pull-requests
description: 'Load before the first commit of a task, before the first edit when a before/after is claimed, before editing a branch that has a PR or MR, and before creating, describing, pushing or restacking one.'
---

# Pull requests

The user merges on the PR body alone: it must prove the change works without anyone reading the code.

## Branches

- **Review units.** Each PR is coherent and runnable on its target, with generated files beside their source.
- **Stacks.** PRs that depend on each other, change the same thing or merge together form one stack: one branch per layer on the layer below, each readable alone. Only unrelated PRs branch from the default branch. Restack with the host's stack commands, never by retargeting by hand.
- **Reshape.** Remove a rejected approach from every unmerged layer; reuse the surviving PRs rather than introducing it below and undoing it above.
- **Integration.** Batch corrections into their owning layers, then restack onto the latest default branch before the final proof and Verify. Publish that integrated state; revalidate if it changes.
- **Before.** When a before/after is claimed, capture the Before state on base before the first edit.

## Publish

1. **Push** a draft once Verify passes. A round of fixes is one push per affected PR, since each push cancels the previous pipeline.
2. **Describe** with the repository's template (`.github/pull_request_template.md`, `.gitlab/merge_request_templates/Default.md`); its comments say what each section holds.
   - **Every claim has its capture** from the final head, taken after the last edit it depends on; only a labelled Before comes from base: a `| Before | After |` image table for a visible change, a video for a sequence, the screen that shows a backend change plus its Scope trace where the app exports traces. Command output supports a capture, never replaces it; a mock is never proof. T3 Code shows each image at most 480 px wide, so a desktop capture is cropped to the region its claim is about, in dark, unless the claim is the whole layout.
   - **Forms** as the Replies rules choose them, GFM first: diff or code block for a shape, table for comparisons and numbers, Mermaid for a flow or an architecture, `<details>` for long output, at most one `> [!IMPORTANT]` alert (the marker alone on its line, each following line prefixed `> `), an unchecked task-list item under its claim for what stays unverified.
   - **Figures** stand in for an `html_render` page, which a PR cannot hold: the user reads PRs in T3 Code's dark theme, which shows an image at most 480 px wide. Lay the page out for 480 px (stacked, two columns at most) with `zoom: 2` on its `html`, pass it to `html_preview` at width 960 in dark, clear its background, and read it before attaching:

     ```bash
     magick <figure>.png -fuzz 1% -transparent "$(magick <figure>.png -format '%[pixel:p{0,0}]' info:)" <figure>.png
     ```

   - **Each fact once.** A diagram, table or capture carries its point alone: no sentence before or after it restates it, and no section repeats another. A fact the visual cannot show gets one fragment beside it.
   - **Bullets are fragments**, only what a reviewer must know: `**No double lint**: vp check --fix fails on leftovers`.
   - **Cut** what the diff or the PR page already shows: history, inventory, walkthrough, test lists, check results. Captions say what changed, not how it was captured.
3. **Read back** the rendered body: every image and video loads under its claim.
4. **Watch** the final head's pipeline; a failure, a review comment or a conflict gets a fix, Verify, fresh captures where they changed, and one push.
5. **Hand back** once the required jobs pass and no P1 or P2 finding is open.
6. **Ready** only when the user asks; mark a ready PR draft again before editing its layer.

## Video

A short motion piece the user wants to watch, of real journeys recorded after the last edit; a raw recording only for a single action.

- **Storyboard first**: per chapter the claim, focal element, input and payoff; one chapter per claim, one dataset.
- **Open** on the real subject, its value visible in the first frames; **end** on the verified outcome, held until it reads.
- **Camera** lands on each input before it happens, still during the change; real speed for the meaningful action, accelerated footage labelled.
- **Captions**: one per chapter, its benefit in a few words; frames read at 390 px wide without zoom.
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

## Commands

Captures upload with `--attach`, never through the host's upload API.

```bash
gh pr edit <n> --title '<title>' --body-file - --attach './shot.png#<alt>' <<'EOF'  # ![alt](./shot.png) becomes the upload
<body>
EOF
gh pr edit <n> --attach './proof.mp4'    # appends the video URL: move it under its claim, alone in its paragraphgh api repos/<owner>/<repo>/pulls/<n> -H 'Accept: application/vnd.github.html+json' --jq .body_html
glab mr update <n> --description-file - --attach ./shot.png <<'EOF'   # appends the reference: move it under its claim
glab api "projects/:id/merge_requests/<n>?render_html=true" | jq -r .description_html
glab api "projects/:id/pipelines/<pipeline>/jobs?scope[]=failed" | jq -r '.[] | "\(.id) \(.name)"'; glab ci trace <job id>
```

**GitHub stacks** act on the checked-out branch's stack; GitHub rebases the next layer when the one below merges.

```bash
gh stack init <bottom> [<next> …]    # start, or adopt existing branches bottom first
gh stack add <branch>                # a new layer on top, checked out before its first commit
gh stack rebase [--upstack]          # before a push, or above an amended layer; --continue or --abort on a conflict
gh stack submit --auto               # first push: opens each PR as a draft on its parent
gh stack push                        # later rounds
gh stack sync --prune                # after a merge below
gh stack unstack --local             # drop tracking of a stack that was never submitted
```

**GitLab stacks** act on the stack selected in this worktree: one commit per diff on its own branch, whose first message line is the MR title (`Draft: ` opens a draft). Every MR of a stack comes from `sync`, which never edits an existing MR.

```bash
git commit -m 'Draft: <title>'
script -qec "GLAB_EDITOR='sh -c \"git rev-list --reverse origin/<default>..HEAD > \\\$1\" -' glab stack infer --name <stack> <default>..HEAD" /dev/null
git add -A && glab stack save -m 'Draft: <title>'    # a new layer; `amend` folds into the checked-out one
glab stack sync --skip-push                          # restack locally before Verify
glab stack sync --update-base                        # each push and after a merge below: rebase, drop merged diffs, force-push, open missing MRs
```

`infer` needs a TTY and an editor, and its range starts at `origin/<default>` since the local default branch can lag; `glab stack create` cannot run in a worktree. `glab stack reorder` takes the same `script` and editor shape, one branch per line, then `glab stack sync`.
