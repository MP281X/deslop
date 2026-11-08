<!--
The user merges on this body alone, read in T3 Code's dark theme: it proves the
change works without anyone reading the code. Each fact appears once: a
diagram, table or capture is never restated in prose, and no section repeats
another. GFM first: a table for comparisons and numbers, Mermaid for a flow or
an architecture, a diff for a shape, <details> for long output, at most one
IMPORTANT alert. A figure (an html_preview page saved as an image) only where
color or the thing itself carries the meaning. Bullets are fragments. Cut what
the diff or the PR page shows: history, walkthroughs, test lists, check results.
Delete every comment and empty section.
-->

## Summary

<!--
One line: what changes for whom. Then the change's shape as one visual: a
Mermaid architecture or flow for a structural change, a diff for a contract.
-->

## Evidence

<!--
One line per claim, its capture under it: real input → result where it is
consumed. A screenshot per state, a motion video per journey, a backend change
through the screen that shows it plus its Scope trace; command output supports a
capture, never replaces it; a mock is never proof. Before/after on the same data
only when the claim is a difference, as a | Before | After | table.
Captures from the final head after the last edit, on representative data,
native apps from a simulator, taken after a condition holds rather than a delay.
T3 Code shows an image at most 480 px wide: crop a desktop capture to the region
its claim is about, in dark, unless the claim is the whole layout. Captions say
what changed, not how it was captured. An unchecked task-list item under its
claim for what stays unverified.
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
