---
name: design
description: 'Use before editing a .tsx, .css or .html file, before building, mocking or judging a screen, component or web page, before html_preview or html_render, and before a screenshot, recording, device session or video that shows a change.'
---

# Design

**The bar.** Calm, fast screens in the class of Linear, T3 Code and Apple's own apps: the content and the next action read at a glance, every input answers at once, and a person who is not technical finishes the task without help or explanation. Existing screens are the floor; raise them per engineering's Pattern change, never on one screen that diverges.

**Less is more.** Empty space is a material: it groups, ranks and lets the content breathe. Start from the content and the next action, and add a control, label, section, color or decoration only for the request, the reference or a rule here; never fill a gap because it is empty. A crowded screen is fixed by removing: fewer elements, borders, colors, sizes and words, each one larger and clearer.

## Decide

- **Standard first.** Each screen copies the convention people know from its reference: in product mode the canonical screen per engineering's Patterns, otherwise Apple's apps or a reference the user named. Depart only for an improvement a capture beside the reference proves.
- **One meaning.** Each element adds information, a distinct action or a relationship. One action has one control in one place. No heading, summary, badge or text restates what the screen already shows. Keyboard shortcuts and screen-reader labels are not repetition.
- **Zero clicks.** What the task needs is visible: the important value, warning and next action never sit behind a menu, tab, hover or expand. Each frequent action is one click; a choice the app can make is not asked.
- **Current work first.** The first viewport shows real content and the next action; completed work recedes without hiding.
- **Range.** When the reference and the Taste rows leave the structure open, compare 2–3 structurally different solutions on the same data, including one with fewer controls. Present the survivors per orchestrator's Gate and build only the one the user chooses. A website or a new kind of piece starts from three concepts that differ in structure or metaphor, not palette.
- **States.** List each screen's reachable states (empty, loading, partial, error, success, long content) before code. Never re-add an element the user removed or rename a visible term without a request.

## Hierarchy

Blur a capture: the primary content and next action still stand out.

- Unequal priorities get unequal weight; mute labels, metadata and chrome before you enlarge content.
- One strongest action per decision area; gaps inside a group are smaller than between groups.
- The accent marks actions and selection, status colors mark states, chart colors mark series.
- Comparable records sit in aligned rows and columns. A familiar action is a conventional icon with an accessible name; an ambiguous one a text label.

## Build

- **Theme.** Before web UI work, read the repository's shadcn theme, the CSS file its `components.json` names under `tailwind.css`. The look lives only there: a change to color, radius, type, spacing or shadow goes into the theme's tokens for every screen and keeps them consistent, never into a page or a primitive.
- **Web components.** shadcn's primitives, used as shipped. The registry changes often, so list it before you choose: `vpx shadcn@latest list @shadcn -t registry:ui`, then `vpx shadcn@latest docs <name>` for the chosen one. When shadcn has the component, use it with its own variants, props and sizes; add a missing one with `shadcn add` and its defaults. Never a wrapper, a new variant, a restyle or a hand-built replacement; needing one means the wrong primitive or pattern.
- **iOS.** The same shadcn look, carried by native iOS elements: the mobile theme's tokens for color, radius and type on SwiftUI primitives through `@expo/ui` (navigation, toolbars, search, lists, menus, swipe actions, sheets, SF Symbols) with their system sizes and behavior. Glass for controls and navigation, never content. Never draw a custom system control.
- **Surfaces** take color, shadow and radius from the theme's tokens only, group by proximity before borders and give each edge one border owner.
- **Flat.** Never a gradient, glow or blurred shadow, anywhere: screens, pages, videos and images use flat theme colors and even 1 px borders, never a colored stripe on one side.
- **Isometric figures.** A flat 3D figure that explains an idea follows `references/isometric.md`: a real machine, many small parts, four tones, painter's order, checked at 4× and in dark mode.

- **Type.** The theme's semantic styles, at most five sizes per screen, prose 45–75 characters, tabular figures for changing numbers, middle truncation when the end distinguishes names.
- **Alignment.** Few edges; headers share columns with rows; equivalent controls share size, icon style and hit target. Squashed icon: `shrink-0`. Vanishing trailing action: `min-w-0` on content. Empty optional slots render no orphan separators.
- **Interaction.** Inputs with the right type and autofill; visible focus restored after a dialog; Escape closes it; the URL holds navigation state and Back restores scroll and draft; errors beside their field; destructive actions undo or confirm; a known-forbidden action is disabled with its reason beside it; "All" clears a filter.
- **Speed** at the level of [T3 Code](https://github.com/pingdotgg/t3code), the reference to read for it: every input answers in the next frame from local state, and the network catches up behind it. The screen owner's `Suspense` fallback keeps the loaded layout and appears after a delay; cached data shows stale while revalidating; reversible writes apply optimistically and roll back without losing the place.
- **Copy.** Actions named after the task, sentence case, one vocabulary; an empty state offers the next action; an error names what failed and the recovery.
- **Motion** explains a state change or spatial relationship and never delays input. No animation on frequent actions or typing. Tweens under 300 ms, ease-out entrances, ease-in-out morphs, springs 0.4 s with 0.15 bounce, entrances from 0.9 scale or more, anchored surfaces enter from their trigger, content swaps crossfade, drags keep velocity and resist at bounds, every motion interruptible, reduced motion keeps feedback without movement.
- **Phones.** The whole task works on a phone with touch, keyboard and zoom; text reflows at 200% and Dynamic Type; bottom controls clear the keyboard and safe areas.

## Mocks

The user chooses by seeing and trying, never by reading a description.

- **Real base.** Start from the real screen: copy its rendered markup, theme tokens and fonts from the running app or its source, change only what the decision needs, keep realistic data and the main states. A native mock imitates the system look; the simulator settles the final appearance.
- **The ask, visible.** Each change the user requested is visible against the current screen: before beside after, the changed region marked.
- **Variants.** An open direction gets three variants, two when a third would only pad. Each tests one named hypothesis about structure or interaction (where the action lives, what the list groups by, inline edit or a sheet), never palette or spacing; all share the same data, states and copy; the interactions the decision turns on work.
- **Comparison.** One page shows every variant as a choice: its name, its hypothesis in one line, what it costs. Mark a recommendation without hiding the others; the user picks or combines. At 390 px, show paired full-width crops of the deciding region first, then each full screen; never shrunken screens side by side.

## Pages

An explanatory page reads like a slide: the conclusion in the first view, then one row per item with a label under twelve words, one takeaway line per section, no paragraphs. Motion only shows a mechanism, at a pace a viewer follows, and stops on the final state with replay.

## Critique

Capture the result at the reference's size, theme, data and state, beside the reference; once the user picks a mock, that mock is the reference, and its deciding geometry (offsets, widths, the joins of lines across rows) is measured in both until it matches. First measure in the page: list elements wider than the viewport or their container, text clipped by its box and fonts that did not load, and fix each. Then check in order:

1. **Structure.** Opens on current work; nothing repeated, hidden or missing; route, sections, controls, terms and copy match the canonical screen unless the request changed them.
2. **Behavior.** States, focus, errors, gestures and motion match the reference; replay transitions.
3. **Visual.** Hierarchy, alignment, spacing, type, color, icons, and these tells: any gradient or glow, a colored stripe on one side of a card, quote or code block, every section a bordered card with an icon, equal prominence everywhere, a color per tile, decorative emphasized words, generic copy such as "seamless", content waiting on an entrance animation, and generated defaults: cream canvas with serif and clay accent, identical rounded cards, all-caps eyebrows, the hero, feature grid, logo row and email form skeleton.

Repair grouping, then hierarchy, alignment, copy and states; recapture with long names, Unicode, 0, 1 and many records, the narrow phone and dark mode.

**Captures** show the result: screenshots for layout, a video for behavior. The real application only, with realistic data in the user's theme, cropped to the subject and readable on a phone; record at phone width when desktop text is too small. Inspect each file before you show it; a capture is stale once a component it shows changes.

**Video.** A proof video is a short motion piece the user wants to watch; a raw recording only for one action under ten seconds.

- **Storyboard** before recording: per chapter the claim, the focal element, the input and the payoff. Two to four chapters, 15–35 s in total, one dataset and one recurring object across chapters.
- **Open** on the real subject in the first frame, its value visible within 3 s: no title card, introduction or idle time. **End** on the verified outcome, framed by the reveal and held at least 2 s.
- **Camera** with a purpose per move: the wide shot sets context, a push lands before each input, the view stays still while the change happens, the reveal holds. Real speed for the meaningful action; label accelerated footage.
- **Consistency.** Every video keeps one look: a dark backdrop from the app's theme with the app's primary as the only accent, the app's font, one caption style, one input marker, one chapter transition, one easing family and visible chapter progress. Energy rises only around the one reveal.
- **Captions.** One per chapter, a benefit in at most six words, for meaning the footage lacks.
- **Check** frames scaled to 390 px wide: app text and captions read without zoom. Replay the file and check an intermediate frame.
