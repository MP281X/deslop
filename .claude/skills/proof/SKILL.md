---
name: proof
description: 'Load before a preview or device tool call, a screenshot or recording, or writing a PR body.'
---

# Proof

- **Capture** representative data on the head, after waiting for the state's own text or element (never a timer), captioned with its short commit. A before/after needs its Before captured on the base before the first edit.
- **States.** Cold open, deep-link reload and a failed first request, the ones the change touches, at `AGENTS.md`'s target sizes.
- **Check** each capture for duplicates, clipping, overflow, false loading, empty and error states, and differences from the prototype. Audit web pages with `preview_evaluate` and [page-audit.js](references/page-audit.js).
- **Record** a flow in one turn: `preview_recording_start`, then `preview_evaluate` with [journey.js](references/journey.js)'s text plus `play(task, [...steps])`, then `preview_recording_stop`. A step is `'Name'` (a click on the visible element labelled Name, or a CSS selector), `{type, into}`, `{press}`, `{see}` (waits for text) or `{say}` (a caption alone); any takes a `label`. The first failed step ends the run. Trim from `play`'s `from` minus the recording's `startedAt`:

```bash
ffmpeg -ss <lead> -i <recording> -vf "mpdecimate=hi=1:lo=1:frac=0,setpts='if(eq(N,0),0,PREV_OUTPTS+min(PTS-PREV_INPTS,1/TB))',fps=60,scale=out_range=tv,format=yuv420p" -c:v libx264 -pix_fmt yuv420p -color_range tv -movflags +faststart -an <trimmed>.mp4
```

## PR body

Each push rewrites the body from `.github/pull_request_template.md` (GitLab: `.gitlab/merge_request_templates/Default.md`), never appends to it, then reads it back rendered and fixes what fails to render. It describes the change at the head: never rounds, rebases or other PRs. Uploads go through `--attach`, since host API writes are blocked.

```bash
gh pr edit <n> --title '<title>' --body-file - --attach './shot.png#<alt>' <<'EOF'  # ![alt](./shot.png) becomes the upload
<body>
EOF
gh pr edit <n> --attach './proof.mp4'    # appends the video URL: move it under its claim, alone in its paragraph
gh api repos/<owner>/<repo>/pulls/<n> -H 'Accept: application/vnd.github.html+json' --jq .body_html
glab mr update <n> --description-file - --attach ./shot.png <<'EOF'   # appends the reference: move it under its claim
glab api "projects/:id/merge_requests/<n>?render_html=true" | jq -r .description_html
```
