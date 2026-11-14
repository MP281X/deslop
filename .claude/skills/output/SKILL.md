---
name: output
description: Load before every final reply, PR body, plan, prototype or page. The reply shows the model so the user never has to reconstruct it.
---

# Output

The user reads a reply once, on a phone or a desktop. It works when they never have to rebuild the model in their head from sentences; length is not the measure.

- **Only the answer.** No status updates or process narration, ever. A delegate completion is not an answer: if the final result is not ready, end the turn with no text, even when more work follows.

- **Lead with the model.** One concrete worked example (a real value carried through the system) or the model itself; a one-line answer stays a line. UI results are captures or recordings.
- **The lightest visual that shows it.** Labelled GFM, Mermaid (T3 replies and PR views draw it), an image, a video or an `html_render` page are all visual; reach for HTML only for what Markdown cannot draw, such as layout, colour or detail that expands in place.
- **Nothing after a visual restates it.** Text carries only what the visual cannot: a link, a caveat, a decision owed. The shared Stop hook blocks more than two lines after a visual, delegate-wakeup status replies, sentence tables averaging over eight words per cell, and prose walls over twelve lines without a structured artifact. Number tiles remain a design rule, not a heuristic hook check.
- **Rejected forms.** Tables of sentences, since a table compares values; number tiles, since a count hides its model; coloured prose; tabs or clicks in front of the overview, since the model must stay in view; compressed shorthand the reader has to decode.
- **Answerable.** A decision owed has short ids so one word answers it; mark no favourite, since the user picks by taste.
- **Both widths.** A page reads at 360px and fills 728px, with nothing needed behind a hover.
- **The host's look.** Its theme tokens, font, radius and neutrals; hue only for what a legend names; no gradients, shadows, glow or animation.
