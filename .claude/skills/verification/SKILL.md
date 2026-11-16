---
name: verification
description: Load when a bug or failed check is reported, when the user calls work settled, before claiming done, fixed or working, before capturing proof, and before a review.
---

# Verification

Lint owns what a parser can check; this covers running behaviour. The repository's `AGENTS.md` names its fixer, checks and tests.

## Diagnose

```mermaid
stateDiagram-v2
    [*] --> Reproducing : a bug or check fails
    Reproducing --> Fixing : failing check, request or capture on base, before any theory
    Fixing --> Probing : edit where the wrong state starts, not a guard, retry or swallowed error downstream of it
    Probing --> [*] : probe [passes]
    Probing --> Fixing : probe [fails after the first edit]
    Probing --> Reproducing : probe [fails after the second edit] / drop the hypothesis
```

## Validate

Validate runs, on the final tree, the repository's fixer, the tests covering the change and Prove's evidence for it; evidence stays valid while its inputs are unchanged. CI runs the rest after the push (pull-requests skill).

## Prove

- **Surface.** UI, and backend changes a screen shows, in the T3 browser; native changes in the Device panel. This standing request covers the preview tools.
- **Capture** representative data on the head, after waiting for the state's own text or element, never a timer, with its short commit in the caption.
- **Record** a flow in one turn: `preview_recording_start`, then `preview_evaluate` with [journey.js](references/journey.js)'s text plus `play(task, [...steps])`, then `preview_recording_stop`. It frames the still page under the task and its step bar and names each step in the frame; it returns `{from, outcomes}`, and the trim starts at `from` minus the recording's `startedAt`. A step is `'Name'`, a click on the visible element labelled Name or a CSS selector; `{type, into}`; `{press}`; `{see}`, waiting for text; or `{say}`, a caption alone; any takes a `label`. The first failed step ends the run with its reason in `outcomes`.
- **Fixed means flipped.** The probe that failed on base passes on the head.
- **States.** Of cold open, deep-link reload and a failed first request, only those the change touches, at one of the repository's target viewports (none listed: `iphone-12-pro` and 1440×900), in one colour scheme.
- **Read each capture** beside the approved render for differences, duplicates, clipping, overflow and untruthful loading, empty or error states, and audit web states with `preview_evaluate` and [references/page-audit.js](references/page-audit.js).
- **Unproved** claims say `unverified: <what was not run>`.

## Review

```mermaid
stateDiagram-v2
    [*] --> Reviewing : review requested / a deep read-only pass in a fresh context
    Reviewing --> [*] : pass [no findings]
    Reviewing --> [*] : pass [a finding the approach itself causes] / report it, the task returns to Discussing
    Reviewing --> Fixing : pass [findings the approach survives] / fix all of them, Validate
    Fixing --> Reviewing : Validate passes [after the first pass] / the second and last pass
    Fixing --> [*] : Validate passes [after the second pass] / report what remains
```

- **Depth.** A pass reports every finding it can reach, never a sample; a request to loop until clean still gets two passes.
- **Input.** The decisions, the approved render, the user's acceptance criteria, the head and any captures; a UI reviewer opens its own preview, since source does not prove what renders.
- **Scope.** Architecture, UI/UX and function, not lint's domain.
- **Finding.** The input, the result, `path:line` and a severity: P1 broken contract, data loss, secret exposure or false claim; P2 architecture or ownership violation; P3 differs from the approved render, or reads worse than it.

## Tests

Keep a reproducing probe only under the repository's test choices, at the narrowest public seam.
