---
name: visuals
description: 'Load before a preview or device tool call, an html_render, a prototype, a screenshot or recording.'
---

# Visuals

- **Prototypes** of UI: copy [prototype.html](references/prototype.html) to the scratchpad once and read only its header, above `<!-- ENGINE -->`. Each round edits the decisions in place, `FIRST` continuing the thread's count.
- **Renders**, prototypes and reply charts alike, go to `html_render` by path with height 2000, with no `html_preview` check; text outside a prototype's app is at least 13 px.
- **A handoff** carries screenshots of the approved versions, never the prototype's code, shot from the page T3 saved when he approved it, `~/.t3/userdata/attachments/<attachmentId>.html`, the id in that `html_render`'s result or `t3_thread_read`'s activity view: `vpx playwright screenshot --viewport-size=728,800 --full-page 'file://<page>?v=<decision><version>,…&beat=<n>' <png>` once per journey step, `n` from 0, `v` keeping only the approved versions (first `vpx playwright install --only-shell chromium` when it asks).
- **Recordings**, never screenshots, prove UI in T3's browser, including UI bundled by Capacitor. Use the iOS Simulator in the Device panel only for share extensions, push, Live Activities, the Dynamic Island and widgets. Caption each recording with its short commit: Before on the base, recorded before the first edit, and After on the head, with the same steps where the flow is the same, at the same viewport; a new flow has only After. Use representative data and start at the deepest link that reaches the change. One browser recording is one turn: `preview_recording_start`, `preview_evaluate` with [journey.js](references/journey.js)'s text plus `play([...steps])`, `preview_recording_stop`; journey.js's header gives the steps.
- **States.** Use `AGENTS.md`'s target sizes for browser proof. Walk cold open, deep-link reload and a failed first request when touched; resize between the iPhone Duo's folded and open viewports mid-flow to prove the selection holds.
- **Check** each recording for duplicates, clipping, overflow, false loading, empty and error states, and differences from the prototype. Audit web pages with `preview_evaluate` and [page-audit.js](references/page-audit.js)'s text plus `auditPage()`.
- **Cut** with [compare.js](references/compare.js): write `{out, before: {video, startedAt, result}, after: {…}}`, where `result` is what `play` returned and `startedAt` the recording's start, and run `node compare.js <file>`. It keeps only steps where Before and After differ, a step being the same name in the same kind of place, so a difference must show up as a different step.
