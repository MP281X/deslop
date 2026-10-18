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
4. **Monitor.** A wake about the current head (a failure, someone else's review comment, a conflict) gets a fix, Verify and one push; any other wake ends with pair's waiting line.
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

- **Compose** the video: copy [proof-video.html](proof-video.html) into a scratch project with the chapter recordings and the app font in `assets/`, set its tokens from the app's theme, then its captions, chapters, moves and reveal from the storyboard. Its look stays in every video: a flat near-black backdrop, captions whose words rise into focus, a touch marker that presses, chapters that grow out of the last input, a spotlight reveal and expo easing. Re-encode each recording with a keyframe every second and both sides cropped to a multiple of 16, then check and render. Never run HyperFrames feedback, publish or cloud commands.

  ```bash
  ffmpeg -i <recording> -vf 'crop=trunc(iw/16)*16:trunc(ih/16)*16:0:0' -force_key_frames 'expr:gte(t,n_forced)' -c:v libx264 -pix_fmt yuv420p assets/chapter-<n>.mp4
  export HYPERFRAMES_NO_TELEMETRY=1 HYPERFRAMES_BROWSER_PATH=$(ls -d ~/.t3/tools/chrome-headless-shell/linux64/*/chrome-headless-shell | tail -1)
  vpx hyperframes@0.8.141 check && vpx hyperframes@0.8.141 render --quality delivery --output <claim>.mp4
  ffmpeg -ss <second> -i <claim>.mp4 -frames:v 1 -vf scale=390:-1 <frame>.png # read each chapter's frame at phone size
  ```

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
