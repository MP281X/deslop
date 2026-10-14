---
name: design
description: 'UI and UX rules for product screens, creative pages and visual explanations. Use when building, prototyping or reviewing a component, page, diagram, review page or other rendered agent output.'
---

# Design

Follow the engineering skill and the repository's `CODING_STANDARDS.md` when present; where it sets a style, such as square borders, it wins over this skill.

**The bar.** Build what people recommend for its polish and simplicity: Linear, T3 Code, Apple's own apps and apple.com. A person who is not technical uses it without help. The repository's existing screens are the floor, not the target.

**Two modes.** Product mode works inside an app and follows every rule below. Creative mode covers websites, launch pages and motion pieces with no product to match; it adds [Creative mode](#creative-mode) and keeps every other rule.

## Before the first draft

For an open direction, show a question-sized prototype before polishing it. Use orchestrator when available to settle consequential user choices. For an approved direction, refine privately before showing the implementation; do not make the user tune routine values.

1. **Task and feeling.** Name the person, their task, their context and the feeling the product gives, such as calm, fast or trustworthy. Name three qualities the person notices, each with what "excellent" looks like.
2. **Baseline.** Name the category and platform, and the reference screen for each screen you build: one of Apple's apps on iOS, the product's existing screen, or a reference the user named. Capture the reference in the states you need. Start from the system or established component defaults.
3. **Range.** Compare structurally different solutions only when the structure has a real unresolved fork, on the same data. Include a simpler solution that removes unnecessary controls. Show the smallest comparison that decides the fork, then develop the chosen direction.
4. **States.** List every screen, its reachable states (empty, loading, partial, error, success, long content) and the events between them, before any code. Group states by concern instead of multiplying every combination.
5. **Settled choices.** Carry forward what the user approved and what he removed. Never re-add a removed element or change an approved detail without a request.

## Decide

**Standard first.** Each screen and interaction follows the convention people know from the reference. Copy its structure, controls, gestures and states. Depart from it only for a deliberate improvement that a capture beside the reference proves.

**Fewest parts.** Start from the content and the next action. Add a control, label, section, color or decoration only when the request, the reference screen or a rule below needs it. When the user calls a screen bloated or wrong, remove parts before you add any.

**One meaning.** Each visible element adds information, enables a distinct action or shows a relationship. Each action has one control in one place, apart from the gestures and menus the reference repeats. Delete repeated headings, summaries, counts, badges, wrappers and text that restates the visible state. Keyboard shortcuts and screen-reader labels are not repetition.

**Current work first.** The first viewport shows real content and the next action, not an introduction. Open the current step, diminish completed work without hiding it, and show prerequisites and time expectations where they help.

**Hierarchy.** Blur a capture: the primary content and the next action still stand out.

- Unequal priorities get unequal weight. Mute labels, metadata and chrome before you enlarge content; metadata never looks like user content.
- Each decision area has one strongest action. Gaps inside a group are smaller than gaps between groups.
- The accent marks actions and selection, status colors mark states, and chart colors mark series.
- Put detail on demand, but never hide a consequential warning or an essential action.

| Content                       | Treatment                                                                    |
| ----------------------------- | ---------------------------------------------------------------------------- |
| Comparable records or options | Aligned rows and columns with consistent order, units and metadata placement |
| Familiar action               | A conventional icon with an accessible name                                  |
| Ambiguous action              | A clear text label, never a guessed icon                                     |
| Explanation                   | The real state or example first; text only for missing context or impact     |

## Build

**Components.** Reuse the existing renderer, states and interactions for the same role, and read its source. Add a missing primitive through the repository's registry command and keep its defaults. Fix a wrong shared pattern at its owner.

**Native platforms.** On iOS, build from the system primitives in the current release's style, such as SwiftUI views through `@expo/ui`. They cover navigation, toolbars, search, lists, menus, swipe actions, sheets and SF Symbols. Glass belongs to controls and navigation, never to content. The repository's mobile theme sets colors and type; never draw a custom version of a system control.

**Surfaces.** Use the existing theme, tokens and semantic colors; add no hardcoded color or size. Group by proximity before borders or elevation, and nest no cards. Give each shared edge one border owner, and use translucent border tokens that pick up their background. Build elevation from stacked shadows at 5% black, each with offset equal to blur: 1, 2, 4 and 8 pixels for small elevation. Nested corners are concentric: the inner radius is the outer radius minus the padding between them.

**Color.** Keep neutrals at one temperature, and derive subtle fills from the main neutral at 10% opacity. Match peer colors by perceived lightness in OKLCH, not HSL; darker shades of a hue gain chroma. Text meets WCAG AA: 4.5:1, or 3:1 for large text. Ease an overlay gradient with 15 smoothstep stops instead of a two-stop fade, and interpolate gradients `in oklch`.

**Typography.** Use semantic text styles: on iOS the system styles with a 17 point body, on the web the existing scale.

- Use at most five sizes on a screen. Start leading at 1.5 for body, 1.3 for subheadings and 1.1 for headings.
- Track uppercase labels +0.08em, body 0 and display −0.022em. In dark mode, lower a variable weight by 20. Prose lines hold 45 to 75 characters.
- Use tabular figures for changing or compared numbers, and right-align numeric columns. Use real quotes, apostrophes, dashes and `…`.
- Truncate names in the middle when the end tells them apart, such as a file extension.

**Alignment.** Use as few edges and axes as the layout allows. Related headings, search, rows and dividers share one grid and inset, and headers share columns with row contents. Align icons of different shapes by their centers and labels by one edge. Equivalent controls share size, icon style, stroke, radius, fill and hit target. Balance by eye where shapes differ, and encode the offset in the owning component: a button with a trailing arrow starts at 12 pixels left and 9 right. Trace a defect to its cause:

| Defect                             | Cause                                  | Repair                                                                             |
| ---------------------------------- | -------------------------------------- | ---------------------------------------------------------------------------------- |
| Squashed icon or avatar            | A fixed-size flex child shrinks        | `shrink-0` keeps its canonical box                                                 |
| Trailing action disappears         | The content track refuses to shrink    | `min-w-0` on the content and `shrink-0` on the control, or a shrinkable grid track |
| Accessory drifts in a tall row     | It follows wrapped text                | Center the accessory in the row, independent of the text                           |
| Counts shift during updates        | Proportional digits or mixed formats   | `tabular-nums` with consistent locale and units                                    |
| Accents or tall scripts clip       | Tight line height or text-box clipping | Fix the owning type scale or overflow; never shrink the font to fit                |
| Missing metadata leaves separators | Empty optional slots still render      | Omit orphaned separators and lines                                                 |

**Interaction contracts.**

- Hit targets are at least 24 pixels, and 44 on touch. Mobile inputs use 16 pixels or more, the right input type, paste and autofill.
- Keep focus visible, restore it after a dialog, and close a dialog with Escape. Keep standard keyboard behavior.
- The URL holds navigation state, and Back restores the scroll position and the draft.
- Place an error beside its field and move focus to the first one. Undo or confirm a destructive action.
- When the app already knows an action is not allowed, disable it and show the reason beside it.
- Selecting "All" clears the filter; never store or show "All" as one more filter value.

**States and speed.** A loading state has the layout of the loaded content, and a loader waits before it appears. Use stale-while-revalidate for cached data. Apply writes optimistically and roll back on failure without losing the person's place. Start unavoidable work early, and add no artificial wait. Errors and rare states get the same care as the main path.

**Copy.** Name actions after the person's task, with one vocabulary and sentence case. An empty state offers the next action. An error names what failed and the recovery that exists, beside its control.

**Motion.** Motion explains a state change or a spatial relationship: plan its trigger, source and destination with the interaction. It never delays input or decorates.

- Frequent actions and typing get no animation. Keep tweens under 300 ms, ease-out for entrances and ease-in-out for morphs. Interface springs start at a 0.4 second duration with 0.15 bounce.
- An entrance starts near its resting size, from 0.9 scale or more. A surface anchored to a trigger enters and exits from it.
- Replace content with a crossfade, never exit then entry. Stagger repeated items slightly.
- A drag follows the finger, keeps velocity on release and resists at its bounds instead of stopping hard. Let people interrupt any motion.
- Reduced motion keeps the feedback without movement. Inspect slowed intermediate frames, not only the final one.

**Access and phones.** The whole task works on a phone, with keyboard, touch and zoom. Text reflows at 200% and with Dynamic Type instead of clipping. Bottom controls clear the keyboard and safe areas. Never remove an accessible affordance for minimalism.

## Prototype and tune

**Variants.** For a real unresolved choice, show one representative journey or a small comparison on the same realistic data before product code. Use the app's tokens, components, copy and behavior. Add interaction only when manipulating the subject exposes a consequential difference; never add tabs or a state dashboard merely to navigate the explanation. Get the direction approved before expanding its states and polish. For a native app the render settles structure and flow; settle its native appearance in simulator captures.

**Real host.** Build one representative screen with realistic data in the real host: the browser preview for the web, the simulator for a native app. An HTML imitation of a native screen misleads.

**Tune.** Settle values yourself. For values you cannot settle by reasoning, such as spacing, timing, springs or blur, capture candidates side by side, including both extremes, and judge them against the reference. Write the chosen values into the source and recapture.

## Critique before showing

Capture the result at the reference's size, theme, data and state, and put it beside the reference. Review it in four separate passes, measure each defect and record the repair:

1. **Structure.** Does the screen open on current work? Is anything redundant, hidden or missing for the task?
2. **Behavior.** Do states, focus, errors, gestures and motion behave like the reference? Replay transitions and loop joins.
3. **Visual.** Check hierarchy, alignment, spacing, type, color, icon consistency and the generic tells below.
4. **Context.** Does it carry the named feeling and the three qualities? Where does a person hesitate?

Repair in this order: grouping, hierarchy, alignment, copy, then states. Recapture after each batch, and stress long names, Unicode, 0, 1 and many records, the narrow phone and dark mode. Misalignment and inconsistent controls stay defects when types and tests pass.

| Generic tell                                    | Check                                                 |
| ----------------------------------------------- | ----------------------------------------------------- |
| Every section is a bordered card with an icon   | Each container groups something; remove the others    |
| Everything has equal prominence                 | The blurred capture still shows the primary content   |
| Each tile gets its own accent color             | Every hue names a state, series or action             |
| An emphasized headline word or decorative label | Removing the treatment loses no meaning, so remove it |
| Generic copy such as "seamless" or "Learn more" | Each label names its capability or the outcome        |
| Content that waits for an entrance animation    | The first frame is readable and actionable            |

**Show the design.** Use screenshots for layout and short videos for behavior. Keep text readable on a phone, match the app's visual style and show the input, action and outcome without unrelated decoration. Evidence must show the real application.

## Creative mode

Ground the page in its subject: name the audience and the page's one job, and take the visual language from the subject's world. Open with the most characteristic thing in its best form, such as a live demo, an image or a headline, and give the product one memorable signature. Interaction, navigation and reading stay conventional; novelty lives in composition, imagery and one choreographed moment. Concept before code: compare three compositions that differ in structure, not palette, and build the winner whole. Avoid defaults that read as generated: a cream canvas with a serif and a clay accent, identical rounded cards with soft shadows, all-caps eyebrows, and the hero, feature table, logo row and email form skeleton.

## Visual explanations

These rules cover diagrams, review pages and rendered agent answers. The visual must transmit a specific message with less effort than prose. Write that message privately before choosing the form. Do not render when a sentence is clearer. Never turn a source list, process recap or checklist into a dashboard.

| The reader asks                      | Exhibit                                                        |
| ------------------------------------ | -------------------------------------------------------------- |
| What does it look like now?          | Real capture, or a named system view with changed parts marked |
| What changed on screen?              | Before and after pair with the same data, the old state left   |
| Which transitions are allowed?       | State machine with forbidden edges marked                      |
| What happens in order, and who acts? | Sequence in swimlanes, one lane per actor                      |
| Where did the time go?               | Timeline with bars on one time axis                            |
| How much faster, bigger or cheaper?  | Bars on a shared axis, values printed on the bars              |
| Where exactly is the defect?         | Annotated capture with numbered markers and short notes        |
| Which requirement has which proof?   | Coverage grid of requirements against proof, colored by state  |
| How do the parts relate?             | Named actors and explicit relationships; no unlabeled blocks   |
| Which option is better?              | Options side by side at the same size and with the same data   |
| What will a video show?              | Storyboard of chapter frames, the outcome frame marked         |

When none fits, choose the form that matches the data's shape; draw a list as a list.

- **One message.** The first visible state must state the actual change, comparison or consequence. Put the relevant names, direction, units and state on the subject. Use a sentence only when the graphic otherwise requires guessing. A decorative title or recap is not a substitute for that meaning.
- **One dominant element.** Size, weight and position show importance; mute context. Use the available width without stretching an empty stage. Add each shape, label and surface only for a relationship or action it communicates. Isometric depth belongs to a meaningful layer or ownership boundary, not arbitrary slabs.
- **Honest scale.** Bars start at zero on one linear scale; draw a range as a range.
- **Labels.** Put names, values and units on the data, with one scale per comparison. Labels and captions stay under twelve words, and a visual holds no paragraphs.
- **Real content.** Use actual names, operations and relationships. Keep a proposal distinct from an applied change, and a simulated explanation distinct from application evidence. A physical model is useful only when its operation explains the concept without another metaphor to decode.
- **Interaction.** Keep the message understandable without a click. Add a control only to explore a real alternative or change an assumption. A predetermined change uses an automatic sequence, not a required click. On a phone, keep essential comparisons visible; do not hide the answer in tabs or menus.
- **Motion.** Animate the subject from its real source to its destination. Keep identity, scale, alignment and unchanged context stable. Use transform and opacity, not per-frame layout. Make transitions brief and uninterrupted; pause only to let the reader see a state. If a demonstration needs replay, make its reset distinct from an undo. Do not use an invisible one-shot movement as the only explanation.
- **Host.** Match the enclosing UI's typography, density, controls, surfaces and semantic tokens, not only its colors. Keep the outer background transparent and remove unnecessary card wrappers. Prefer native CSS for simple automatic diagrams; use relative geometry instead of JavaScript sizing when it gives the same result.
- **Proof.** Inspect the artifact in its actual host, including an intermediate frame and the final state. A valid file, a correct model or a headless screenshot alone does not prove readable, smooth, correctly triggered motion. Compare before and after at the same scale and actual playback speed. Fix a repeated failure in its representation or source, not with more prompt prohibitions.
- **Check.** Use the host's theme variables, check light, dark and a 390-point width, and fix clipping, overlap and contrast before you show it. At that width the page stays under about 400 points tall.
