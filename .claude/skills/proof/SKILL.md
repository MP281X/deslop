---
name: proof
description: 'Load before a preview or device tool call, a screenshot or recording, or writing a PR body.'
---

# Proof

- **Capture** representative data on the head, after waiting for the state's own text or element (never a timer), captioned with its short commit. A before/after needs its Before captured on the base before the first edit.
- **States.** Cold open, deep-link reload and a failed first request, the ones the change touches, at `AGENTS.md`'s target sizes; on the iPhone Duo, a fold and an unfold mid-flow that keep the selection.
- **Check** each capture for duplicates, clipping, overflow, false loading, empty and error states, and differences from the prototype. Audit web pages with `preview_evaluate` and [page-audit.js](references/page-audit.js)'s text plus `auditPage()`, which only reads the page and lets running transitions settle first; text still animating is listed under `inTransition`, not `lowContrast`. Its `design` group is the rules `AGENTS.md`'s Design section states that a page can show, and the rest are defects.
- **Record**, never screenshot: proof of anything that reaches a screen is a recording. Record the flow on the base (Before) and on the head (After) with the same steps where the flow is the same, at the same viewport; a new flow has only After. Start each at the deepest link that reaches the change, so it skips navigation. Each recording is one turn: `preview_recording_start`, then `preview_evaluate` with [journey.js](references/journey.js)'s text plus `play([...steps])`, then `preview_recording_stop`. A step is `'Name'` (a click on the visible element with that accessible name, or on a CSS selector, recognised by `#`, `.`, `[`, `:` or `>`), `{type, into}`, `{press}` or `{see}` (waits for text); any takes a `label`. Labels name the action and the field, never the typed text, so a label must not hold a secret or private text either. A step reports what the page did: a click that is covered or changes nothing, a field that does not keep its text and a key that changes nothing fail. A click or key counts only a change of focus, address or a part of the page that was still in the second before it, so a page that animates by itself does not pass a dead key; when the answer lands in a moving part, give the step a `see` and the text proves it instead. A navigation ends the evaluation, and the first failed step ends the run.
- **Cut** with [compare.js](references/compare.js): write `{out, before: {video, startedAt, result}, after: {…}}`, where `result` is what `play` returned and `startedAt` the recording's start, and run `node compare.js <file>`. It keeps only the steps where Before and After differ, a step being the same name in the same kind of place, lines them up and holds the side that waits; each side is cropped once to the part of the page its steps use. A step both take alike is cut, so a difference must show up as a different step.

## PR body

Each push rewrites the body from `.github/pull_request_template.md` (GitLab: `.gitlab/merge_request_templates/Default.md`), never appends to it, then reads it back rendered and fixes what fails to render. It describes the change at the head: never rounds, rebases or other PRs. Uploads go through `--attach`, since host API writes are blocked.

```bash
gh pr edit <n> --title '<title>' --body-file - --attach './shot.png#<alt>' <<'EOF'  # ![alt](./shot.png) becomes the upload
<body>
EOF
gh pr edit <n> --attach './proof.mp4'    # appends the video URL: move it under its claim, alone in its paragraph
gh api repos/<owner>/<repo>/pulls/<n> -H 'Accept: application/vnd.github.html+json' --jq .body_html
glab mr update <n> --description-file - --attach ./shot.png <<'EOF'   # appends the reference: move it under its claim
<body>
EOF
glab api "projects/:id/merge_requests/<n>?render_html=true" | jq -r .description_html
```
