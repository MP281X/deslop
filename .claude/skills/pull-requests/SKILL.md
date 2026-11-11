---
name: pull-requests
description: 'Load before the first commit of a task, before the first edit when a before/after is claimed, before editing a branch that has a PR or MR, and before creating, describing, pushing or restacking one.'
---

# Pull requests

## Branches

- **Review units.** Each PR is coherent and runnable on its target, with generated files beside their source.
- **Stacks.** PRs that depend on each other, change the same thing or merge together form one stack: one branch per layer on the layer below, each readable alone. Only unrelated PRs branch from the default branch. Restack with the host's stack commands, never by retargeting by hand.
- **Reshape.** Remove a rejected approach from every unmerged layer; reuse the surviving PRs rather than introducing it below and undoing it above.
- **Integration.** Batch corrections into their owning layers, then restack onto the latest default branch before the final proof and Verify. Publish that integrated state; revalidate if it changes.
- **Before.** When a before/after is claimed, capture the Before state on base before the first edit.

## Publish

1. **Push** a draft once Verify passes. A round of fixes is one push per affected PR, since each push cancels the previous pipeline.
2. **Describe** with the repository's PR or MR template: the template is the structure; the body carries the evidence.
   - **Figures** stand in for an `html_render` page, which a PR cannot hold: lay the page out for 480 px (stacked, two columns at most) with `zoom: 2` on its `html`, pass it to `html_preview` at width 960 in dark, clear its background, and read it before attaching:

     ```bash
     magick <figure>.png -fuzz 1% -transparent "$(magick <figure>.png -format '%[pixel:p{0,0}]' info:)" <figure>.png
     ```

   - **Videos:** record the real journey; use the hyperframes skill for the edit.
3. **Read back** the rendered body: every image and video loads under its claim, captured on the pushed head (verification, **Final head**).
4. **Watch** the final head's pipeline; a failure, a review comment or a conflict gets a fix, Verify, fresh captures where they changed, and one push.
5. **Hand back** once the required jobs pass and no P1 or P2 finding is open.
6. **Ready** only when the user asks; mark a ready PR draft again before editing its layer.

## Commands

Captures upload with `--attach`, never through the host's upload API.

```bash
gh pr edit <n> --title '<title>' --body-file - --attach './shot.png#<alt>' <<'EOF'  # ![alt](./shot.png) becomes the upload
<body>
EOF
gh pr edit <n> --attach './proof.mp4'    # appends the video URL: move it under its claim, alone in its paragraph
gh api repos/<owner>/<repo>/pulls/<n> -H 'Accept: application/vnd.github.html+json' --jq .body_html
```

**Stacks** act on the checked-out branch's stack; GitHub rebases the next layer when the one below merges.

```bash
gh stack init <bottom> [<next> …]    # start, or adopt existing branches bottom first
gh stack add <branch>                # a new layer on top, checked out before its first commit
gh stack rebase [--upstack]          # before a push, or above an amended layer; --continue or --abort on a conflict
gh stack submit --auto               # first push: opens each PR as a draft on its parent
gh stack push                        # later rounds
gh stack sync --prune                # after a merge below
gh stack unstack --local             # drop tracking of a stack that was never submitted
```
