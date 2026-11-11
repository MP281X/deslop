---
name: verification
description: Load before editing code for a bug or a failed check, before claiming done, fixed or working, before capturing proof, and before a review.
---

# Verification

Lint owns what a parser can check. This skill covers running behaviour, the user's experience and decisions only the whole codebase shows. A bug or failed check starts at Diagnose; finished work passes Verify, then Prove, then Review.

## Diagnose

1. **Reproduce** on base: a failing check, request or capture of the broken state. No theory before it exists.
2. **Name the mechanism** in one sentence and rank 3 hypotheses; change one variable per probe.
3. **Fix where the wrong state starts**, not where it shows. A guard, retry, clamp or swallowed error fixes only a state that is legitimate.
4. **Sweep the class.** Fix every other instance in the same change; a mistake that can recur becomes a shared component or a lint rule.
5. **Two strikes.** The same check failing after two edits means the hypothesis is wrong: stop editing and form a new one.
6. **Suspect the instrument** first when a result surprises: stale preview, old build, fixture data, the wrong viewport.

## Prove

- **Surface.** The user wants every change to rendered UI, and every backend change a screen shows, proved in the T3 browser, and a native change in the Device panel. This standing request covers the preview tools.
- **Capture** representative data, after a condition holds rather than a delay. Command output supports a capture, never replaces it; a mock is never proof.
- **Fresh.** The preview runs the head: confirm it before the first capture, and name the short commit in each caption. A later commit retakes the captures whose screen or flow it changed; an amend, rebase or restack retakes them all.
- **Fixed means flipped.** A bug fix shows the probe that failed on base passing on the integrated head.
- **Journeys.** Walk each journey the change touches from its input to its outcome; an app's `AGENTS.md` lists its main ones under `## Journeys`. A backend change is proved through the screen that uses it, with Scope's traces where the app exports them.
- **Each touched screen**, and every screen it reaches by navigation, on real or planted data:
  - cold first open, reload of a deep link, the first request failing, and on native background then resume;
  - hover, focus and keyboard on changed controls;
  - a phone and a desktop, T3's `iphone-12-pro` and 1440×900, and the widest layout the repository targets when the change reaches it; light and dark when colour changed;
  - an app with web and iOS clients: the same screen on both, side by side, with the same content, actions and identity, each in its platform's own controls.
- **Read every capture as a page**, one line each: it matches the approved plan; nothing appears twice; nothing is cut, misaligned or overflowing; loading, empty and error states tell the truth; every word is needed.
- **Audit** every captured web state with `preview_evaluate` and [references/page-audit.js](references/page-audit.js): fix or give a reason for each entry, and apply its `design` group only where the repository records design rules. On iOS, read the `agent-device` snapshot the same way: a label or button twice, a control without a name, a missing navigation title.
- **Performance.** Compare the same workload over repeated runs: p50, p95 and resource costs, from Scope's traces.
- **Unproved** claims say `unverified: <what was not run>`.

## Review

- **Who.** One reviewer in a fresh context, read-only.
- **Brief.** The approved plan, the user's acceptance criteria in their own words, the immutable head and the captures.
- **Where.** Only where Verify cannot look: architecture and ownership against the repository's recorded choices, data and migrations, caller and user contracts, and the experience in the running app. A UI reviewer opens its own preview tab, since reading source is not evidence.
- **Findings** are what a person would fix, grouped by class, each with the input, the observed result and `path:line`. "No findings" lists the probes run and one attempt to break the change; blocked, the answer is `NOT VERIFIED` and what stopped it. Not findings: anything Verify reports, taste without a rule, hypothetical callers.
- **Rounds.** One round, then one recheck after fixes; a third means the approach is wrong.

| Severity | Meaning                                                                                    |
| -------- | ------------------------------------------------------------------------------------------ |
| P1       | Broken user or caller contract, data loss, secret exposure, missing migration, false claim |
| P2       | Architecture, ownership or boundary violation; an abstraction that adds no capability      |
| P3       | A flow, layout or wording that works but reads worse than the recorded design              |

## Tests

Keep a reproducing probe only under the repository's test choices, at the narrowest public seam; a deleted test names its reason in the commit message.
