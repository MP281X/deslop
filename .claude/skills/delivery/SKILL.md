---
name: delivery
description: Use before the first commit or push, before writing a PR body, before monitoring a PR, before taking a screenshot or recording or composing a video, and on every PR notice.
---

# Delivery

## Branches

The user reviews and squash-merges one PR at a time.

- **Split.** One PR is one feature the user accepts as a unit. Independent features start from the default branch; a layer stacks only on a real dependency. Instruction and configuration changes of one thread ship as one PR. Generated files stay with their source. Decide the split yourself before the first commit.
- **Chain.** Keep one commit per PR on `<thread branch>-chain`, dependencies first. A follow-up to a feature is `git commit --fixup=<commit> -- <paths>` into its layer, naming its paths so nothing else staged rides along; a new layer only for a new feature.
- **Publish.** Rebuild each layer with `git switch -C <branch> <base> && git cherry-pick <commit>`, push with `--force-with-lease`, one push per command, then return to the chain. Open drafts; on GitHub link stacks with `gh stack link <numbers, bottom first>`, never `--open`. Reuse open PRs and branch names; `gh stack unstack` before reordering.
- **Rebase** before every push: `git fetch` and `git rebase --autosquash origin/<default branch>`. A conflict gets the same rebase. A PR is never behind or conflicting at handoff.
- **After merges.** Rebase the chain, republish changed layers and unlink merged PRs; retarget the next GitLab merge request.

## Publish

1. **Gate** at the root on every layer's head before every push, with the repository's local gate per environment: `git switch --detach <layer head> && <gate> && git switch -`, one layer after another. The pipeline is slow and only confirms what passed locally. Push every working step.
2. **Describe** the head as it is now, per [Body](#body): write the title, body and commit message at the first push and rewrite them after every push that changes what they say. They never narrate how the PR got there: no "now also", "updated", "fixed review" or superseded captures.
3. Link each PR with `link_pull_request`, watch it with `watch_pull_request` and start its review guide with `write_pull_request_guides`.
4. **Monitor** only through the `watch_pull_request` wakes: after a push, end the turn with one line naming the head it waits for. A wake about the current head (a failure, a review comment by someone else, a conflict) gets a fix and a push; a wake about an older head, a running job or a repeat needs no action.
5. **Ready** when the final head passes required jobs, the review loop has no open P1 or P2, the captures are in the body and [Critique](#critique) finds nothing: `gh pr ready <n>` or `glab mr update <n> --ready`. A new commit on a ready layer returns it to draft in the same step (`gh pr ready <n> --undo`, `glab mr update <n> --draft`). Restart a stale review guide.
6. **Handoff** once every PR is ready and current with the default branch: `unwatch_pull_request` each PR, stop owned services, then write the one final reply. The preview and its tab stay.

## Body

The body reads like a reply per pair's Replies rules: an opening line with the central change in the user's terms, then one `###` per change a user or caller notices, each with its exhibit, central change first.

- **Risk.** Up to three bullets right after the opening: a migration, a changed contract, removed behavior. Omit when nothing can break.
- **Contracts.** A changed endpoint, schema, key, migration or exported API gets a before and after table and the caller migration.
- **Evidence.** Each capture under the entry it proves: one video per journey, at most eight screenshots, a changed screen as a before and after table with the same data, the target branch left.
- **Also.** Minor changes as one-line bullets under `### Also`; the last names generated files and the command that reproduces them.
- **Never** test counts, check tables, process notes, a proof section, code links (T3's review guide tours the code) or the repository's template.

## Captures

What a capture shows and how it looks follow design; this section is how to make one.

- **Browser.** One tab, shared with the user. Find it with `preview_status`; open one only when none exists, with `preview_open`, `open: true` and the preview URL. Pass its `tabId` to every call; never a second tab on the preview. While the user controls it, do other work. Leave it open on the changed screen.
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
2. Does it describe only the current head, with nothing superseded?
3. Does each claim carry a capture or real output that proves it, and does each capture prove a claim?
4. Would the user accept each PR as one unit, or split or merge it?
5. Is everything in the diff something the request asked for?
6. Would the user watch the video to the end?

## Commands

```bash
gh pr edit <n> --body-file <file> --attach './shot.png#<alt>'   # run beside the file: body ![alt](./shot.png) is rewritten to the upload; any other path appends it
gh pr edit <n> --body-file <file> --attach './proof.mp4'        # a video takes no #alt; its bare URL is appended, so move that line under its entry
token=$(glab config get token --host git.datapizza.tech) && curl -fsS -H "PRIVATE-TOKEN: $token" -F file=@<file> https://git.datapizza.tech/api/v4/projects/<id>/uploads | jq -r .markdown
glab mr update <n> --description-file <file>
gh run view <run id> --log-failed
glab api "projects/<id>/pipelines/<pipeline>/jobs?scope[]=failed" | jq -r '.[] | "\(.id) \(.name)"'; glab ci trace <job id>
```

- **GitLab stacks** target each predecessor branch with `glab mr create` and `glab mr update --target-branch`; never `glab stack`, which shares state across worktrees.
- **Baseline.** To compare with the target branch in this checkout: commit, `git restore --source=origin/<target> -- <paths>`, measure, `git restore --source=HEAD -- <paths>`.
