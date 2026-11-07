---
name: verification
description: Load before editing code for a bug or a failed check, before claiming done, fixed or working, before capturing proof, and before a review.
---

# Verification

A bug or a failed check starts at Diagnose. Finished work goes Cleanup, Prove, Review.

## Diagnose

1. **Reproduce** on base: a failing check, request or capture of the broken state. No theory before it exists.
2. **Name the mechanism** in one sentence and rank 3 hypotheses; change one variable per probe.
3. **Fix where the wrong state starts**, not where it shows. A guard, retry, clamp or swallowed error fixes only a state that is legitimate.
4. **Sweep the class.** Search for every other instance and fix them in the same change. A mistake that can recur becomes a shared component or a lint rule.
5. **Two strikes.** The same check failing after two edits means the hypothesis is wrong: stop editing and form a new one.
6. **Suspect the instrument** first when a result surprises: stale preview, old build, fixture data, the wrong viewport.

## Cleanup

Before any capture, remove what the change no longer needs: debug code, dead code, duplicates, restyled shadcn components, unused files and the leftovers listed under Cleanup in Work. `rg` and Fallow rank candidates; deleting code something may still call needs caller or registration evidence plus a reachable-path probe. Proof shows the code that will merge.

## Prove

- **Fresh.** The preview runs the latest commit; confirm it before the first capture. Captures come after the last edit and are labelled with the commit; a later edit retakes every capture it affects.
- **Fixed means flipped.** A bug fix shows the probe that failed on base passing on the integrated head.
- **Journeys.** The app's `AGENTS.md` lists its main journeys under `## Journeys`; add the ones the change touches when missing. Backend changes are proved through the screen that uses them, with the Scope trace for the backend path where the app exports traces.
- **Each touched screen**, in the running app on real or planted data:
  - cold first open, reload of a deep link, the first request failing, and on native background then resume;
  - hover, focus and keyboard on changed controls;
  - 390 and 1440 wide, 3440 for wide layouts; light and dark when color changed.
- **Read every capture as a page** before it counts, one line per capture saying what it shows:
  - it matches the plan card or the chosen variant;
  - nothing appears twice: a value, action, status or control already shown elsewhere;
  - nothing is cut, misaligned or overflowing, and spacing matches its siblings;
  - loading, empty and error states tell the truth: no error while data is loading;
  - every word is needed.
- **Audit** every captured web state: pass the text of `page-audit.js` in this skill's directory to `preview_evaluate`. It returns cut text, page overflow, repeated text and actions, overlapping controls, unnamed controls, broken images and errors shown while loading; each entry is fixed or given a reason. Assert anything else a rule can check: element counts, computed colors.
- **Performance**: the same workload, repeated runs, p50 and p95, resource cost; Scope traces and `measure_latency`.
- **Unproved** claims say `unverified: <what was not run>`.

## Review

One reviewer from another model family, in a fresh context, read-only. Its brief holds the plan card, the user's acceptance criteria in their own words, the immutable head and the captures. It reports only what a person would fix, grouped by class, each with the input, the observed result and `path:line`. "No findings" lists the probes it ran and one attempt to break the change; a UI reviewer opens its own preview tab, since reading source is not evidence. Blocked, it answers `NOT VERIFIED` and what stopped it. One round, one recheck after fixes; needing a third round means the approach is wrong. Not findings: taste without a rule, hypothetical callers, what lint covers.

| Severity | Meaning                                                                                     |
| -------- | ------------------------------------------------------------------------------------------- |
| P1       | Broken user or caller contract, data loss, secret exposure, missing migration, false claim  |
| P2       | Repository ownership, boundary or reference violation; unnecessary, duplicated or dead code |
| P3       | Naming, wording or style                                                                    |

## Tests

`CODING_STANDARDS.md` decides which tests to keep. A probe that reproduced a real failure is kept only when those rules keep it, at the narrowest public seam. A deleted test names its reason in the commit message.
