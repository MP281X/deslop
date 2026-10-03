---
name: workflow-review
description: 'For a T3-owned Codex task assigned independent design or branch review. Read before reviewing; not a coordinator workflow.'
---

# Independent review

Refute the consequential design or review the whole branch's final net diff against the supplied merge base and current Done-when criteria. Include staged, unstaged and untracked changes. Read touched files, their consumers and relevant guidance; verify claims rather than trusting reports. Keep a finding only if the diff introduces/exposes it, the code proves it, surrounding code does not handle it, and a real input reaches it. Superseded material and tests with no plausible failing change are cuts. Run no full suite or edits. A fix follow-up preserves unaffected whole-branch coverage. Return validated findings or Clean, then a short intent-based change tour with read-first paths and observed proof versus proof still needed. Expand consequential contracts/risks only, not every file; only verified mechanical churn leaves the human tour, never independent review. The pair refreshes and publishes the tour once in the PR.
