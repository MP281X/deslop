---
name: design
description: 'Use before editing a .tsx, .css or .html file, before building, mocking or judging a screen, component or web page, before html_preview or html_render, and before a screenshot, recording, device session or video that shows a change.'
---

# Design

**The bar.** Calm, fast screens in the class of Linear, T3 Code and Apple's own apps: the content and the next action read at a glance, every input answers at once, a person who is not technical finishes unaided. Existing screens are the floor, raised per engineering's Pattern change, never on one screen that diverges.

**Less is more.** Empty space groups and ranks. Add a control, label, section, color or decoration only for the request, the reference or a rule here; fix a crowded screen by removing.

## Decide

- **Convention first.** Copy the reference: the canonical screen per engineering's Canonical example, else Apple's apps or a reference the user named; depart only for an improvement a capture beside it proves.
- **Mobbin.** When its MCP tools are available, search its screens and flows for the shape first, Deep Search only when the standard search comes back thin, and carry the observed patterns and links into the choice.
- **One meaning.** One action, one control, one place; no heading, badge or summary restating what the screen shows.
- **Zero clicks.** The important value, warning and next action never sit behind a menu, tab, hover or expand; a choice the app can make is not asked.
- **Current work first.** The first viewport shows real content and the next action; completed work recedes without hiding.
- **Variants.** When the reference and the repository's Taste rows leave the structure open, show variants per [Mocks](#mocks), one with fewer controls; build only the one the user picks.
- **States.** List each screen's reachable states (empty, loading, partial, error, success, long content) before code. Never re-add an element the user removed or rename a visible term unasked.

## Build

- **Theme.** Read the shadcn theme, the CSS file `components.json` names under `tailwind.css`, before web UI work. Color, radius, type, spacing and shadow change only in its tokens, never in a page or a primitive.
- **shadcn as shipped.** List the registry with `shadcn@latest list @shadcn -t registry:ui` and read `shadcn@latest docs <name>` through the repository's package runner; use the primitive with its own variants, props and sizes, add a missing one with `shadcn add`. Never a wrapper, new variant, restyle or hand-built replacement.
- **Hierarchy.** Blur a capture: the primary content and next action still stand out. Mute labels, metadata and chrome before you enlarge content; one strongest action per area; the accent marks actions and selection, status colors states, chart colors series.
- **Flat.** No gradient, glow, blurred shadow or one-sided colored stripe anywhere: theme colors and even 1 px borders; group by proximity before borders, one border owner per edge.
- **Type.** The theme's semantic styles, at most five sizes per screen, prose 45–75 characters, tabular figures for changing numbers, middle truncation when the end distinguishes names.
- **Alignment.** Few edges; headers share columns with rows; equivalent controls share size, icon style and hit target. Squashed icon: `shrink-0`; vanishing trailing action: `min-w-0` on content.
- **Instant.** Every input answers in the next frame from local state; the `Suspense` fallback keeps the loaded layout and appears after a delay; stale data shows while revalidating; reversible writes apply optimistically.
- **Interaction.** The URL holds navigation state and Back restores scroll and draft; errors beside their field; destructive actions undo or confirm; a forbidden action is disabled with its reason beside it.
- **Motion** explains a state change and never delays input; none on frequent actions or typing. Tweens under 300 ms, springs 0.4 s with 0.15 bounce, entrances from 0.9 scale or more, anchored surfaces from their trigger, every motion interruptible, reduced motion keeps feedback without movement.
- **Phones.** The whole task works with touch, keyboard and zoom; text reflows at 200 %; bottom controls clear the keyboard and safe areas.

## Mocks

The user chooses by seeing and trying, never by reading.

- **Real base.** Start from the real screen's markup, tokens and fonts; change only what the decision needs; realistic data and the main states.
- **Before and after.** Each requested change visible against the current screen, the changed region marked.
- **Hypotheses.** Two or three variants, each testing one structure or interaction hypothesis (where the action lives, what the list groups by, inline edit or a sheet), never palette or spacing; same data, states and copy; the deciding interactions work.
- **Comparison.** One page: each variant's name, its hypothesis in one line, its cost, the recommendation marked. At 390 px, paired full-width crops of the deciding region first, then each full screen.

## Critique

Capture the result beside its reference at the same size, theme, data and state; a picked mock is the reference, and its deciding geometry is measured in both until it matches. First list elements wider than their container, clipped text and fonts that did not load.

1. **Structure.** Opens on current work; nothing repeated, hidden or missing against the canonical screen.
2. **Behavior.** States, focus, errors, gestures and motion match the reference.
3. **Tells.** Gradient or glow, a colored side stripe, every section a bordered card with an icon, equal prominence everywhere, a color per tile, generic copy such as "seamless", content waiting on an entrance animation, and generated defaults: cream canvas with serif and clay accent, identical rounded cards, all-caps eyebrows, the hero, feature grid, logo row and email form skeleton.

Recapture with long names, Unicode, 0, 1 and many records, the narrow phone and dark mode.

**Captures** show the real application with realistic data in the user's theme, cropped to the subject and readable on a phone: screenshots for layout, a video for behavior. Inspect each file before you show it; it is stale once a component it shows changes.

**Video.** A short motion piece the user wants to watch; a raw recording only for one action under ten seconds.

- **Storyboard** first: per chapter the claim, the focal element, the input and the payoff; two to four chapters, 15–35 s, one dataset.
- **Open** on the real subject, its value visible within 3 s, no title card; **end** on the verified outcome, held at least 2 s.
- **Camera** lands on each input before it happens and holds still while the change happens; real speed for the meaningful action, accelerated footage labelled.
- **Captions.** One per chapter, a benefit in at most six words.
- **Check** frames at 390 px wide: app text and captions read without zoom.
