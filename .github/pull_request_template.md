<!--
Describe the head for a reviewer who was not in the conversation, in the style
of a reply page: each point a text heading, one picture of the difference and at
most one plain line. Delete every comment and every empty section, then read the
rendered body back.
-->

## Summary

<!--
One line: what changes for whom. Then the page that shows it, as its dark and
light screenshots in one <picture>; Mermaid for a flow that should stay diffable
text. No walkthrough, inventory, history or test list.
-->

## Evidence

<!--
One line per claim, its capture under it: real input → result where it is
consumed. A screenshot per state, a video per sequence, a request or trace for
backend; command output supports a capture, never replaces it. Before/after on
the same data only when the claim is a difference.
Captures use representative data at the app's primary viewport and theme,
native apps from a simulator, taken after a condition holds rather than a delay.
-->

## Merge danger

<!--
Delete when a revert undoes everything and nothing runs by hand. Otherwise:
what cannot be undone (data, a published package, an app release, an external
effect), who it reaches, and the manual steps as a numbered list.
-->
