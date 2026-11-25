---
name: proof
description: 'Load before a preview or device tool call, an html_render, a prototype, a screenshot or recording, or writing a PR body.'
---

# Proof

- **Prototype** UI in a scratch copy of [prototype.html](references/prototype.html), as its comment says. A handoff's copy deletes the other variants from `DECISIONS`, so the approved frames stay as he saw them.
- **Replies.** Check an `html_render` first with `html_preview` at 728, 629 and 350 px; text outside a prototype's app is at least 13 px at each.
- **Capture** representative data on the head, after waiting for the state's own text or element, never a timer, captioned with its short commit. A Before is captured on the base before the first edit.
- **States.** Of cold open, deep-link reload and a failed first request, those the change touches, at `AGENTS.md`'s target sizes; on the iPhone Duo, a fold and an unfold mid-flow that keep the selection.
- **Check** each capture for duplicates, clipping, overflow, false loading, empty and error states, and differences from the prototype. Audit web pages with `preview_evaluate` and [page-audit.js](references/page-audit.js)'s text plus `auditPage()`. Its `design` group lists what breaks `AGENTS.md`'s Design rules; the rest are defects.
- **Record**, never screenshot: whatever reaches a screen is proven by a recording in T3's browser or Device panel, Before on the base and After on the head, with the same steps and viewport; a new flow has only After. Start at the deepest link that reaches the change. One recording is one turn: `preview_recording_start`, `preview_evaluate` with [journey.js](references/journey.js)'s text plus `play([...steps])`, `preview_recording_stop`.
- **Steps.** `'Name'` clicks the visible element with that accessible name, or a CSS selector (starting with `#`, `.`, `[`, `:` or `>`); `{type, into}`, `{press}`, `{see}` (waits for text); each takes a `label`, naming the action and field, never typed or private text. A click or key passes only if focus, the address or a part of the page that was still changes, and a field must keep its text; when the answer lands in a moving part, add a `see`. A navigation ends the evaluation; the first failed step ends the run.
- **Cut** with [compare.js](references/compare.js): write `{out, before: {video, startedAt, result}, after: {…}}`, where `result` is what `play` returned and `startedAt` the recording's start, and run `node compare.js <file>`. It keeps only steps where Before and After differ, a step being the same name in the same kind of place, so a difference must show up as a different step.

## PR body

Each push rewrites the body from `.github/pull_request_template.md` (GitLab: `.gitlab/merge_request_templates/Default.md`) to describe the change at the head, never rounds, rebases or other PRs. Hosts render no HTML: pictures are Mermaid and recordings. Read it back rendered and fix what fails to render. Upload with `--attach`, since host API writes are blocked.

```bash
gh pr edit <n> --title '<title>' --body-file - <<'EOF'
<body>
EOF
gh pr edit <n> --attach './proof.mp4'    # appends the video URL: move it under its claim, alone in its paragraph
gh api repos/<owner>/<repo>/pulls/<n> -H 'Accept: application/vnd.github.html+json' --jq .body_html
glab mr update <n> --description-file - --attach ./proof.mp4 <<'EOF'   # appends the reference: move it under its claim
<body>
EOF
glab api "projects/:id/merge_requests/<n>?render_html=true" | jq -r .description_html
```
