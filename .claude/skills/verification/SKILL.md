---
name: verification
description: Load before editing code for a bug or a failed check, before claiming done, fixed or working, before capturing proof, and before a review.
---

# Verification

Lint owns what a parser can check; this covers running behaviour. Prove and Review run once the user calls the work settled; Diagnose runs whenever a bug or check fails.

## Diagnose

1. **Reproduce** on base with a failing check, request or capture before forming a theory.
2. **Fix where the wrong state starts**; a guard, retry or swallowed error only hides it.
3. **Two strikes.** A check still failing after two edits means the hypothesis is wrong.

## Prove

- **Surface.** UI, and backend changes a screen shows, in the T3 browser; native changes in the Device panel. This standing request covers the preview tools.
- **Capture** representative data once a condition holds, on the head, with its short commit in the caption; a rebase retakes them all.
- **Fixed means flipped.** The probe that failed on base passes on the head.
- **Journeys.** Walk each touched journey (an app's `AGENTS.md` `## Journeys`) from input to outcome, failures included; Scope's traces show the backend.
- **States.** Cold open, deep-link reload and a failed first request; `iphone-12-pro` and 1440×900, plus the widest target reached; dark and light when colour changed; web and iOS side by side when both exist.
- **Read each capture** for duplicates, clipping, overflow and untruthful loading, empty or error states, and audit web states with `preview_evaluate` and [references/page-audit.js](references/page-audit.js).
- **Unproved** claims say `unverified: <what was not run>`.

## Review

One read-only reviewer in a fresh context gets the decisions, the user's acceptance criteria, the head and the captures, and opens its own preview, since source is not evidence. It weighs architecture, UI/UX and function, not lint's domain. Each finding has the input, the result, `path:line` and a severity: P1 broken contract, data loss, secret exposure or false claim; P2 architecture or ownership violation; P3 reads worse than the recorded design. A third round means the approach is wrong.

## Tests

Keep a reproducing probe only under the repository's test choices, at the narrowest public seam.
