# Taste

The user's picks and vetoes across projects, one line each with where they came from. Repository rules (`DESIGN.md`, `CODING_STANDARDS.md`) stay in their files.

## Interfaces

- ✕ Labels on what is obvious, like trees and bushes; color carries identity, so team names live in one legend. _Signal_
- ✕ Controls that wrap to two lines while space remains. _Signal_
- ✕ A button that duplicates another path: fit-all, a history button beside an always-visible timeline. _Signal_
- ✕ Zoom buttons and minimaps: wheel or pinch, then zoom out to see more. _Signal_
- ✕ Raw JSON or repeated facts in a feed: extract the data and show it once. _Signal_
- ✓ The content owns the screen; panels open on demand and close again. _Signal_
- ✓ An action whose prerequisite is missing shows disabled, rather than failing. _Signal_
- ✓ Messages that point at a place or time take you there. _Signal_
- ✓ Icons centered on their row; lists end with a visible close; media placeholders keep the media's size. _UI fixes_
- ✓ The same header placement on web and mobile. _UI fixes_

## Explorations

- ✓ Many different directions, unranked; two similar ones are not a choice. _Signal, replies_
- ✓ Icons and showing over describing; no wall of text. _Replies_
- ✕ Screenshots of rendered pages in PR bodies. _PRs_

## Systems

- ✓ Fewer moving parts: single binaries, no system dependencies, one tool owning one job. _Deploy_
- ✓ Standard protocols over custom ones. _Auth, Deploy_
- ✕ Zero-downtime machinery for personal services. _Monitoring_
