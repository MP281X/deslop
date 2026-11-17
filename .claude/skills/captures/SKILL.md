---
name: captures
description: 'Load before the first preview or device tool call of a task, and before any screenshot or recording.'
---

# Captures

- **Capture** representative data on the head, after waiting for the state's own text or element, never a timer, with its short commit in the caption.
- **Record** a flow in one turn: `preview_recording_start`, then `preview_evaluate` with [journey.js](references/journey.js)'s text plus `play(task, [...steps])`, then `preview_recording_stop`. A step is `'Name'` (a click on the visible element labelled Name, or a CSS selector), `{type, into}`, `{press}`, `{see}` (waits for text) or `{say}` (a caption alone); any takes a `label`. The first failed step ends the run; `play` returns `{from, outcomes}`, and the trim starts at `from` minus the recording's `startedAt`.
- **States.** Of cold open, deep-link reload and a failed first request, those the change touches, at one of the repository's target viewports (none listed: `iphone-12-pro` and 1440×900), in one colour scheme.
- **Read each capture** for duplicates, clipping, overflow, untruthful loading, empty or error states, and any screen, label, state or click path that differs from the plan's prototype; audit web states with `preview_evaluate` and [page-audit.js](references/page-audit.js).
