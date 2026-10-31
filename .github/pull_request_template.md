<!--
For a reviewer who was not in the conversation: Markdown formats over sentences,
nothing the diff already shows. Delete every comment and empty section, then
read the rendered body back.
-->

## Summary

<!--
One line: what changes for whom. Then the shape: a diff or code block, a table
for a comparison or before/after numbers, Mermaid for a flow.
Bullets only for what a reviewer must know: **bold lead**: a few words.
No walkthrough, inventory, history or test list.
-->

## Evidence

<!--
One line per claim, its capture under it: real input → result where it is
consumed. A screenshot per state, a video per sequence, a request or trace for
backend; command output supports a capture, never replaces it, and long output
goes in <details>. Before/after on the same data only when the claim is a
difference, as a table for numbers.
Captures are of the app itself, never of a rendered page: representative data
at the app's primary viewport and theme, native apps from a simulator, taken
after a condition holds rather than a delay.
-->

## Merge danger

<!--
Delete when a revert undoes everything and nothing runs by hand. Otherwise:
what cannot be undone (data, a published package, an app release, an external
effect), who it reaches, and the manual steps as a numbered list.
-->
