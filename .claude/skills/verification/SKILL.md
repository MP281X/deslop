---
name: verification
description: Load before editing code for a bug or a failed check, before claiming done, fixed or working, before capturing proof, and before a review.
---

# Verification

Verify owns code-level quality; see `tools/coding-standards/README.md`. This skill covers running behavior, the user's experience and codebase-wide decisions. A bug or failed check starts at Diagnose; finished work passes Verify, then Prove, then Review. The output skill owns the shape of the reply, page and PR body.

## Diagnose

1. **Reproduce** on base: a failing check, request or capture of the broken state. No theory before it exists.
2. **Name the mechanism** in one sentence and rank 3 hypotheses; change one variable per probe.
3. **Fix where the wrong state starts**, not where it shows. A guard, retry, clamp or swallowed error fixes only a state that is legitimate.
4. **Sweep the class.** Fix every other instance in the same change; a mistake that can recur becomes a shared component or a lint rule.
5. **Two strikes.** The same check failing after two edits means the hypothesis is wrong: stop editing and form a new one.
6. **Suspect the instrument** first when a result surprises: stale preview, old build, fixture data, the wrong viewport.

## Prove

- **Surface.** Any change to rendered UI, and any backend change a screen shows, is proved in the T3 browser or Device panel.
- **Capture.** Use representative data. Capture native apps from a simulator, after a condition holds rather than a delay. Command output supports a capture, never replaces it; a mock is never proof.
- **Fresh.** The preview runs the latest commit; confirm it before the first capture. Each caption, in the thread and in the PR body, names its short commit; retake a capture whose screen or flow changed since.
- **Final head.** Capture after the last commit. An amend, rebase or restack changes the head: delete the old media and capture again.
- **Fixed means flipped.** A bug fix shows the probe that failed on base passing on the integrated head.
- **Journeys.** The app's `AGENTS.md` lists its main journeys under `## Journeys`; add the ones the change touches when missing. Backend changes are proved through the screen that uses them, with the Scope trace where the app exports traces.
- **Each touched screen**, in the running app on real or planted data, and every screen it reaches by navigation:
  - cold first open, reload of a deep link, the first request failing, and on native background then resume;
  - hover, focus and keyboard on changed controls;
  - 390 and 1440 wide (T3's phone `iphone-12-pro` and desktop 1440×900), 3440 for wide layouts; light and dark when color changed;
  - an app with web and iOS clients: the same screen on both, side by side, with the same content, actions and identity, each in its platform's own controls.
- **Read every capture as a page**, one line per capture: it matches the plan card or chosen variant; nothing appears twice; nothing is cut, misaligned or overflowing; loading, empty and error states tell the truth; every word is needed.
- **Audit** every captured web state: pass the text of `references/page-audit.js` to `preview_evaluate` and fix or give a reason for each entry; its `design` group applies only in Deslop apps. On iOS, read the `agent-device` snapshot the same way: a label or button twice, a control without a name, a missing navigation title.
- **Performance.** Compare the same workload over repeated runs, reporting p50, p95 and resource costs. Use Scope traces and `measure_latency`.
- **Unproved** claims say `unverified: <what was not run>`.

## Review

One reviewer in a fresh context, read-only. Its brief holds the plan card, the user's acceptance criteria in their own words, the immutable head and the captures. It looks only where Verify cannot: architecture and ownership against the repository's recorded choices, data and migrations, caller and user contracts, and the experience in the running app (a UI reviewer opens its own preview tab, since reading source is not evidence). It reports what a person would fix, grouped by class, each with the input, the observed result and `path:line`; "no findings" lists the probes it ran and one attempt to break the change. Blocked, it answers `NOT VERIFIED` and what stopped it. One round, one recheck after fixes; a third round means the approach is wrong. Not findings: anything Verify reports, taste without a rule, hypothetical callers.

| Severity | Meaning                                                                                    |
| -------- | ------------------------------------------------------------------------------------------ |
| P1       | Broken user or caller contract, data loss, secret exposure, missing migration, false claim |
| P2       | Architecture, ownership or boundary violation; an abstraction that adds no capability      |
| P3       | A flow, layout or wording that works but reads worse than the recorded design              |

## Tests

Keep a reproducing probe only under the repository's test choices, at the narrowest public seam; a deleted test names its reason in the commit message.
