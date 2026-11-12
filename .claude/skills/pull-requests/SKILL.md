---
name: pull-requests
description: 'Load before the first commit of a task, before the first edit when a before/after is claimed, before editing a branch that has a PR or MR, and before creating, describing, pushing or restacking one.'
---

# Pull requests

## Branches

- **Review units.** Each PR is coherent and runnable on its target, with generated files beside their source.
- **One PR per thing.** An unmerged PR is edited in place: more work on the same thing goes into the PR that owns it, never a new PR on top. Split only what is independent, or a different layer of the same thing.
- **Stacks** ease review, not stepwise merging. PRs that depend on each other or merge together form one stack: one branch per layer on the layer below, each readable alone. Unrelated PRs branch from the default branch. Restack with the host's stack commands, never by retargeting by hand.
- **Reshape.** Remove a rejected approach from every unmerged layer rather than introducing it below and undoing it above.
- **Integration.** Batch corrections into their owning layers, then restack onto the latest default branch before the final Verify and proof.
- **Before.** When a before/after is claimed, capture the Before state on base before the first edit.

## Publish

1. **Push** as a draft. A round of fixes is one push per affected PR, since each push cancels the previous pipeline.
2. **Describe** with the repository's PR or MR template. The reader decides merge or iterate from the body alone and never opens the diff; code quality belongs to the linter and the judge. The body holds these, in this order, and nothing else:
   - **Picture.** When the change moves what talks to what, what sits on what or where something lives, open with one Mermaid block: Before above After, each lane one path read left to right, in the words a product owner uses, never file, table, type or flag names. Otherwise draw nothing and open with the result.

     ````markdown
     ```mermaid
     flowchart TB
       subgraph Before
         direction LR
         g1[Gateway] --- m1["a copy<br/>in memory"]:::gone --- f1["files<br/>servers, calls,<br/>keys, usage"]
       end
       subgraph After["After · ② ⑤ not shown working"]
         direction LR
         g2[Gateway] -- "⑥ reads, writes<br/>directly" --- d2["database<br/>① MCP servers<br/>② server sign-ins<br/>③ MCP calls, hourly<br/>④ AI keys<br/>⑤ AI usage, hourly"]
       end
       Before ~~~ After
       class Before,After lane
       classDef lane fill:none
       classDef gone fill:none,stroke-dasharray:4 4
     ```
     ````

     Mark each changed thing in After with ①, ②…, the numbers the lines below use; put `:::gone` on what goes away, in Before; title After `After · ② not shown working` when a changed thing has no proof below; mark nothing healthy. Give a connection its words as an edge label, with plain lines and no arrows. Write several things that changed the same way as lines of one part, and give two parts that changed the same way the same label. Use only the constructs above: no `%%{init}%%`, colours or HTML beyond `<br/>`.

   - **Working.** One recording per app the change reaches: the real journey on the final head. Cut every stretch where nothing moves down to a second, then name each step inside the frame while it happens, opening with its number from the picture; no caption under the recording:

     ```bash
     ffmpeg -i <recording> -vf "mpdecimate=hi=1:lo=1:frac=0,setpts='if(eq(N,0),0,PREV_OUTPTS+min(PTS-PREV_INPTS,1/TB))',fps=60,scale=out_range=tv,format=yuv420p" -c:v libx264 -pix_fmt yuv420p -color_range tv -movflags +faststart -an <trimmed>.mp4
     # One drawtext per step, comma-separated.
     ffmpeg -i <trimmed>.mp4 -vf "drawtext=fontfile=/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf:text='<n>  <step>':fontsize=32:fontcolor=white:x=32:y=h-80:box=1:boxcolor=black@0.85:boxborderw=12:enable='between(t,<from>,<to>)'" -c:v libx264 -pix_fmt yuv420p -color_range tv -movflags +faststart -an <labelled>.mp4
     ```

     No screenshot of anything a recording shows; a screenshot only for a state in which nothing moves.

   - **Result**, only where the result is the change: the command or version before → after, the snippet the check now rejects with its real diagnostic, or the number that moved.
   - **Not proven.** One line per changed thing that nothing above shows working, by its number when there is a picture, and why.
   - **Merge danger**, almost never: only when merging does what a revert cannot take back (data deleted or moved, a release published, an external system or a secret changed by hand). A WARNING alert: what cannot be undone, then the manual steps, numbered.

   No file path, line count, test name, list of checks or restated diff.

3. **Read back** the rendered body: the picture draws, and every image and video loads under its claim.
4. **Watch** the final head's pipeline; a failure, a review comment or a conflict gets a fix, Verify and fresh captures where they changed.
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
