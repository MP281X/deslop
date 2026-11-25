---
name: visuals
description: 'Load before a preview or device tool call, an html_render, a prototype, a screenshot or recording.'
---

# Visuals

- **Prototypes** of UI start from [prototype.html](references/prototype.html). A handoff's copy deletes the other variants from `DECISIONS`, so the approved frames stay as he saw them.
- **Reply charts.** Check an `html_render` first with `html_preview` at 728, 629 and 350 px; text outside a prototype's app is at least 13 px at each.
- **Recordings**, never screenshots, prove whatever reaches a screen, in T3's browser or Device panel, captioned with the short commit: Before on the base, recorded before the first edit, and After on the head, with the same steps where the flow is the same, at the same viewport; a new flow has only After. Use representative data and start at the deepest link that reaches the change. One recording is one turn: `preview_recording_start`, `preview_evaluate` with [journey.js](references/journey.js)'s text plus `play([...steps])`, `preview_recording_stop`; journey.js's header gives the steps.
- **States.** Of cold open, deep-link reload and a failed first request, those the change touches, at `AGENTS.md`'s target sizes; on the iPhone Duo, a fold and an unfold mid-flow that keep the selection.
- **Check** each recording for duplicates, clipping, overflow, false loading, empty and error states, and differences from the prototype. Audit web pages with `preview_evaluate` and [page-audit.js](references/page-audit.js)'s text plus `auditPage()`.
- **Cut** with [compare.js](references/compare.js): write `{out, before: {video, startedAt, result}, after: {…}}`, where `result` is what `play` returned and `startedAt` the recording's start, and run `node compare.js <file>`. It keeps only steps where Before and After differ, a step being the same name in the same kind of place, so a difference must show up as a different step.
