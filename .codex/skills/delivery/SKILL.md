---
name: delivery
description: Use before the first commit or push, before creating, editing or readying a PR or MR, before writing a PR body, before a screenshot, recording, device session or video, and on every PR notice.
---

# Delivery

## Branches

The user reviews every PR of a thread at the end and squash-merges them one at a time.

- **Split.** One PR by default. A second PR only for a feature the user would accept or reject on its own; independent features start from the default branch, and a layer stacks only on a real dependency. Never split one feature across layers, and no layer rewrites what another adds. Instruction and configuration changes of one thread are one PR; generated files stay with their source. Decide the split before the first commit.
- **Chain.** A stack keeps one commit per PR on `<thread branch>-chain`, dependencies first. A follow-up to a feature is `git commit --fixup=<commit> -- <paths>` into its layer, naming its paths so nothing else staged rides along.
- **Publish.** Rebuild each layer with `git switch -C <branch> <base> && git cherry-pick <commit>`, push with `--force-with-lease`, one push per command, then return to the chain. Open drafts; on GitHub link stacks with `gh stack link <numbers, bottom first>`, never `--open`. Reuse open PRs and branch names; `gh stack unstack` before reordering.
- **Current.** The last Verify before a push follows `git fetch` and `git rebase --autosquash origin/<default branch>`, and a wake about a conflict gets the same rebase: a PR is never behind or conflicting.
- **After merges.** Rebase the chain, republish changed layers, remove each merged PR from the stack and from the thread with `unlink_pull_request`, and retarget the next GitLab merge request.

## Publish

1. **Push** only heads that passed engineering's Verify after their last rebase; in a stack, Verify each layer's head in order (`git switch --detach <layer head>`, then back). Every fix of a round rides one commit and one push: each push starts a pipeline and cancels the last, and the pipeline only confirms what passed locally.
2. **Describe** the head as it is now, per [Body](#body): write the title, body and commit message at the first push and rewrite them after every push that changes what they say. They never narrate how the PR got there: no "now also", "updated", "fixed review" or superseded captures.
3. **Watch** each PR with `watch_pull_request`.
4. **Monitor.** A wake about the current head (a failure, someone else's review comment, a conflict) gets a fix, Verify and one push; any other wake is read and recorded without a message, per the Replies section of your instructions.
5. **Ready** when the final head passes required jobs, the review loop has no open P1 or P2, the captures are in the body and [Critique](#critique) finds nothing: `gh pr ready <n>` or `glab mr update <n> --ready`. A new commit on a ready layer returns it to draft in the same step (`gh pr ready <n> --undo`, `glab mr update <n> --draft`).
6. **Handoff** once every PR is ready and current with the default branch: write the final reply in that same turn.

## Body

The body follows pair's Replies with captures and real output as exhibits: an opening line with the central change in the user's terms, then one `###` per change a user or caller notices, central change first. Minor wording and generated copies stay out of the sections.

- **Risk.** Up to three bullets right after the opening: a migration, a changed contract, removed behavior. Omit when nothing can break.
- **Contracts.** A changed endpoint, schema, key, migration or exported API gets a before and after table and the caller migration.
- **Evidence.** Each capture under the entry it proves: one video per journey, at most eight screenshots, a changed screen as a before (target branch) and after table with the same data.
- **Also.** Minor changes as one-line bullets under `### Also`; the last names generated files and the command that reproduces them.
- **Never** test counts, check tables, process notes, a proof section, diffs, code links or the repository's template.

## Captures

What a capture shows and how it looks follow design; this section is how to make one.

- **Browser.** One tab on the preview, shared with the user: reuse it, never a second. While the user controls it, do other work. Leave it open on the changed screen.
- **Drive.** Theme with `preview_set_appearance`, size with `preview_resize`, wait with `preview_wait_for`, never a fixed delay. Batch reads in `preview_evaluate`. After a failed action, read the screen, console and failed requests before you retry.
- **Record** each storyboard chapter with `preview_recording_start` before its first meaningful input and `preview_recording_stop` after its outcome, the tab resized with `preview_resize` to the `iphone-12-pro` preset (390×844); a layout that exists only on desktop at 1440×900 (freeform). Contact sheet: `ffmpeg -i <video> -vf fps=1,scale=640:-1,tile=4x4 <sheet-%03d.png>`.
- **Native apps.** Boot a simulator on `macbook-pro` per environment's device host, then use T3's device tools with the exact launcher and flags from `device_open`. Run `open <bundle id>` before `snapshot -i`, `screenshot <path> --pixel-density 3` or `record start <path>`.
- **Camera targets.** Read each input's target and the outcome's box right after recording starts and before each input:

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

- **Compose** the video in a scratch HyperFrames project, portrait for a phone recording and landscape only for a layout that exists only on desktop, with the recordings re-encoded below (a side that is not a multiple of 16 renders a black strip) and the app's font in `assets/`; `vpx hyperframes@0.8.141 docs <topic>` holds the composition contract. Never run HyperFrames feedback, publish or cloud commands. Every video keeps this look, in the app's font, primary and radius:
  - **Layout.** On the app's foreground hue darkened to near black, top to bottom: the progress, the caption, then the recording in a frame with the app's radius; margins of 6 % and a caption of 5 % of the short side. Nothing covers the recording but the touch marker and the reveal: no scrim, no caption over it.
  - **Progress.** One 6 px segment per chapter, filling with the primary over its chapter.
  - **Captions.** Weight 650; words rise into focus one after another (blur 12 px to 0, 0.45 s, 0.035 s stagger) and leave before the next caption.
  - **Camera.** Portrait fills the frame's width, shows about four fifths of the screen's height and only pans to each input, since a push crops rows; landscape pushes every frame meant to be read in to at most 500 CSS px of the app's width. Expo easing; each move takes 0.25–0.65 s and settles 0.2 s before its input, so the viewer watches it land.
  - **Touch.** A white marker 38 app CSS px wide, scaled with the recording, at 55 % opacity with a 3 px white border and a primary ring, enters in 0.22 s, presses to 0.78 in 0.08 s while a 0.55 s primary ripple beneath it grows to 2.6×, and fades in 0.25 s.
  - **Chapters** start 0.6 s before the previous one ends and grow out of its last input as a circular clip; the previous view dims to brightness 0.55 at 0.96 scale.
  - **Reveal.** The camera zooms onto the verified outcome, at most 2.6×, inside a 4 px primary outline offset 6 px, everything else dimmed to 80 % backdrop, entering in 0.5 s and held to the end.
  - **Pitfalls.** A `fromTo` that starts later takes `immediateRender: false`, or its start state shows from frame one; a filter tween states its start, `brightness(1)`, or GSAP starts at zero and flashes black; select by id, since the bundler cannot parse a selector built from a template literal; the camera container taller than the stage takes `data-layout-allow-overflow`; a timed video sits in untimed wrappers, which `check` otherwise rejects as `video_nested_in_timed_element`.

  ```bash
  export HYPERFRAMES_NO_TELEMETRY=1 HYPERFRAMES_SKIP_SKILLS=1 HYPERFRAMES_BROWSER_PATH=$(ls -d ~/.t3/tools/chrome-headless-shell/linux64/*/chrome-headless-shell | tail -1)
  vpx hyperframes@0.8.141 init <claim> --example blank --resolution portrait --non-interactive && mkdir <claim>/assets
  ffmpeg -i <recording> -vf 'crop=trunc(iw/16)*16:trunc(ih/16)*16:0:0' -r 30 -force_key_frames 'expr:gte(t,n_forced)' -c:v libx264 -pix_fmt yuv420p <claim>/assets/chapter-<n>.mp4
  vpx hyperframes@0.8.141 check && vpx hyperframes@0.8.141 render --quality delivery --output <claim>.mp4 # inside <claim>/
  ffmpeg -ss <second> -i <claim>.mp4 -frames:v 1 -vf scale=390:-1 <frame>.png # read each chapter's frame at phone size
  ```

## Study

Before a new kind of video scene or a stack operation, read the row's source, in a checkout per explore's Study repositories.

| Shape                                                    | Read                                                                                                        |
| -------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------- |
| Timed scenes, captions and GSAP timelines in HyperFrames | [HyperFrames](https://github.com/heygen-com/hyperframes) `registry/examples/product-promo`                  |
| Stacked PRs with `gh stack`                              | [GitHub docs](https://github.com/github/docs) `content/pull-requests/reference/stacked-prs-cli-commands.md` |

## Critique

Read the published PR as the user will, from a phone, hours later, without the chat. Fix every "no" before ready:

1. Does the first screen of the body say what changed for the user?
2. Does each claim carry a capture or real output that proves it, and does each capture prove a claim?
3. Would the user accept each PR as one unit, or merge it with another?
4. Is everything in the diff something the request asked for?
5. Would the user watch the video to the end?

## Commands

```bash
gh pr edit <n> --title '<title>' --body-file - <<'EOF'            # the body inline through stdin, never a file; the quoted EOF keeps backticks and quotes literal
<body>
EOF
gh pr edit <n> --body-file - --attach './shot.png#<alt>' <<'EOF'  # run beside the capture: ![alt](./shot.png) in the body is rewritten to the upload
gh pr edit <n> --attach './proof.mp4'                             # a video takes no #alt; its URL is appended, so move it under its entry in the next edit
glab mr update <n> --description-file - --attach ./shot.png <<'EOF'   # the upload's reference is appended to the description
gh run view <run id> --log-failed
glab api "projects/<id>/pipelines/<pipeline>/jobs?scope[]=failed" | jq -r '.[] | "\(.id) \(.name)"'; glab ci trace <job id>
```

- **GitLab stacks** target each predecessor branch with `glab mr create` and `glab mr update --target-branch`; never `glab stack`, which shares state across worktrees.
- **Baseline.** To compare with the target branch in this checkout: commit, `git restore --source=origin/<target> -- <paths>`, measure, `git restore --source=HEAD -- <paths>`.
