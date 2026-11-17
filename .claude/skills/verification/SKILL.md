---
name: verification
description: Load when a bug or failed check is reported, when approved work is built, before claiming done, fixed or working, before capturing proof, and before a review.
---

# Verification

Lint owns what a parser can check; this covers running behaviour. The repository's `AGENTS.md` names its fixer, checks and tests.

## Diagnose

```mermaid
stateDiagram-v2
    [*] --> Reproducing : a bug or failed check
    Reproducing --> Fixing : a probe fails on the unfixed tree / base for a reported bug, the head for a failure the change introduced
    Reproducing --> [*] : [no probe fails] / report the probes run, ask for the failing input
    Fixing --> [*] : the same probe passes on the head
    Fixing --> Reproducing : [the second fix fails] / drop the hypothesis
```

- **Probe.** A check, request or capture, run before any theory.
- **Fix** where the wrong state starts, not with a guard, retry or swallowed error downstream of it.

## Validate

```mermaid
stateDiagram-v2
    [*] --> Using : Validate [the change reaches a screen] / walk its whole flow as the user would, in the T3 browser or the Device panel
    [*] --> Fixing : Validate [it reaches none] / run the repository's fixer
    Using --> Using : it breaks, or First look finds something / fix
    Using --> Fixing : the flow works and First look is clean / run the repository's fixer
    Fixing --> Fixing : the fixer [fails] / fix
    Fixing --> Proving : the fixer [passes] / commit its changes, then on that commit run the tests covering the change and Prove's evidence
    Proving --> Using : a test or proof [fails] / fix, walk the touched flow again
    Proving --> [*] : all pass / Review, once per PR, then CI runs the rest after the push
```

- **Order.** Nothing is checked or reviewed before it has been used: a fixer run or a code review on work that does not run is wasted.
- **Evidence** stays valid while its inputs are unchanged.

## Prove

- **Surface.** UI, and backend changes a screen shows, in the T3 browser; native changes in the Device panel. This standing request covers the preview tools.
- **Capture** representative data on the head, after waiting for the state's own text or element, never a timer, with its short commit in the caption.
- **Record** a flow in one turn: `preview_recording_start`, then `preview_evaluate` with [journey.js](references/journey.js)'s text plus `play(task, [...steps])`, then `preview_recording_stop`. A step is `'Name'` (a click on the visible element labelled Name, or a CSS selector), `{type, into}`, `{press}`, `{see}` (waits for text) or `{say}` (a caption alone); any takes a `label`. The first failed step ends the run; `play` returns `{from, outcomes}`, and the trim starts at `from` minus the recording's `startedAt`.
- **States.** Of cold open, deep-link reload and a failed first request, those the change touches, at one of the repository's target viewports (none listed: `iphone-12-pro` and 1440×900), in one colour scheme.
- **Read each capture** for duplicates, clipping, overflow, untruthful loading, empty or error states, and any screen, label, state or click path that differs from the approved render; audit web states with `preview_evaluate` and [page-audit.js](references/page-audit.js).
- **First look.** Before the user sees UI work, a fresh read-only delegate gets the running app and nothing else, neither diff nor plan, and opens every changed page at desktop and phone size. It reports, each as a marked capture, what the user would remark on at first sight: an element that is useless or duplicated, a difference from how the rest of the app does the same thing, a control that does nothing or has nothing to do, anything that looks off.
- **Unproved** claims say `unverified: <what was not run>`.

## Review

```mermaid
stateDiagram-v2
    [*] --> Reviewing : Validate's tests pass on the PR's final head, or the user asks / one deep read-only delegate pass, routed by the orchestrator skill
    Reviewing --> [*] : [no findings]
    Reviewing --> [*] : [any finding the approach itself causes] / show it, the task returns to Planned
    Reviewing --> Fixing : [every finding fits the approach] / fix every one
    Fixing --> [*] : the fixer and the touched tests pass / report what stays unfixed
```

- **Depth.** The pass reports every finding it can reach at once, never a sample, and is never repeated in a loop.
- **Input.** The decisions, the approved render, the user's acceptance criteria, the head and any captures; a UI reviewer opens its own preview, since source does not prove what renders, and a review of a UI change without a capture of each changed page is returned.
- **Finding.** Architecture, UI/UX and function, not lint's domain: the input, the result, `path:line` or a marked capture, and a severity. P1 broken contract, data loss, secret exposure, false claim, or what the user would see wrong on first opening the page; P2 architecture or ownership violation; P3 a difference from the approved render, or a screen that reads worse than the recorded design.
- **Tests.** Keep a reproducing probe only under the repository's test choices, at the narrowest public seam.
