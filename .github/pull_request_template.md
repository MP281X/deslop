<!--
For a reviewer who was not in the conversation. Each fact appears once: a
diagram, table or capture is never restated in prose. Delete every comment and
empty section, then read the rendered body back.
-->

## Summary

<!--
One line: what changes for whom. Then the change's shape as one visual: an
architecture diagram for a structural change, a diff for a contract.
-->

## Evidence

<!--
One line per claim, its capture under it: real input → result where it is
consumed. A screenshot per state, a video per sequence, a backend change through
the screen that shows it plus its Scope trace; command output supports a
capture, never replaces it. Before/after on the same data only when the claim is
a difference.
Captures from the final head, at the app's primary viewport and theme on
representative data, native apps from a simulator, taken after a condition holds
rather than a delay.
-->

## Merge danger

<!--
Almost always deleted. Keep it only when merging does something a revert cannot
take back: data deleted or migrated, a package or app release published, an
external system changed, a secret or server setting someone must change by
hand. Routine steps (pulling, installing, restarting, CI and the deploy) are
not merge danger. Then a WARNING alert: what cannot be undone, who it reaches,
and the manual steps as a numbered list.
-->
