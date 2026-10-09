---
name: design
description: 'UI and UX rules for screens and visual explanations. Use when building, prototyping, or reviewing a component, diagram, review page, or other rendered agent output.'
---

# Design

**Scope.** Follow repository-specific CODING_STANDARDS.md and engineering.

**Two modes.** Consistent mode works inside an existing product: its components, tokens and every rule below. Creative mode covers work with no product to match, such as websites, landing pages, portfolios, launch pages, motion design and videos. It follows [Creative mode](#creative-mode) in place of Decide and Build, whose calm, dense product rules make every page a dashboard; only Access and responsiveness and Verify still apply. When a request mixes both, the product's screens stay consistent.

## Decide

**Direction.** Start from the actual task, audience, content and settled preferences. Make the next user action and its relevant content dominant, not generic "premium" styling. When a reference is useful, inspect the relevant accepted one for transferable hierarchy, density and interaction choices; distinguish observed details from inferred ones. Community brand analyses are inspiration, not verified current tokens.

**One meaning.** Each visible element must add information, enable a distinct action or clarify a relationship. Delete repeated headings, summaries, counts, status badges, decorative wrappers and controls that say or do the same thing. Remove explanations that merely restate the visible example/state. Keyboard shortcuts, screen-reader labels and responsive placement are not redundant visible controls; preserve their function.

**Scan-first.** Put the task, relevant content and next action where they can be identified without reading a paragraph. Use stable visual roles, not another card/badge/icon for every fact. Expose needed detail on demand, never hide a consequential warning or essential action.

**Hierarchy.** Blur a capture: the primary content and the next action must still stand out. Give unequal priorities unequal weight, and repeat one layout only for records with equal roles. De-emphasize labels, metadata and chrome before enlarging the important content. Give each decision area one strongest action, with secondary or text variants for the rest. Keep gaps inside a group smaller than gaps between groups, and space above a heading larger than below it. The first phone viewport shows real content and the next action, not an introduction. Left-align prose and records; keep prose at 45 to 75 characters per line. Reserve the accent for actions and selection, status colors for states and chart colors for series.

| Content                    | Preferred treatment                                                       |
| -------------------------- | ------------------------------------------------------------------------- |
| Comparable records/options | Aligned rows/columns; consistent order, units and metadata placement      |
| Familiar action            | Conventional icon-only control with an accessible name; one visible owner |
| Ambiguous action           | Clear text label, not an invented/guessed icon or redundant icon + text   |
| Explanation                | Real state/example first; text only for missing context or consequences   |

```tsx
// one visible action, named for assistive technology
<Button aria-label="Rename" size="icon"><PencilIcon aria-hidden /></Button>
// redundant label for an already-obvious action
<Button><PencilIcon />Rename</Button>
```

Do not remove necessary names, status, comfortable hit targets or instructions merely to make a screen smaller.

## Build

These rules apply to product UI. A rendered explanation follows the host's rendering contract and the rules below.

**Canonical components.** Reuse the existing renderer, states and interactions for the same role. Inspect its relevant source/API, not a full catalogue; add missing primitives through the repository registry command. Fix wrong shared patterns at their owner when delivering retained code, not before an exploratory preview. Without a sibling, use the supplied reference and component defaults within settled preferences.

```tsx
// same model-selection control used elsewhere
<ModelPicker value={model} onValueChange={setModel} />
// another representation of the same job
<Select value={model} onValueChange={setModel} />
```

**Tokens and structure.** Use the existing app host, compiler, theme, shared components and Tailwind tokens. No custom-CSS/dynamic-class escape, hardcoded color/size exception or weakened shared rules. Keep surfaces flat and dense; group by proximity before adding borders or elevation. No nested cards or wrappers that merely label content again. Whitespace must support hierarchy, separation or comfortable use, not fill the page.

```tsx
// existing primitives and semantic tokens
<Empty><EmptyTitle>No runs yet</EmptyTitle><Button onClick={startRun}>Run</Button></Empty>
// parallel hand-built appearance
<div className="rounded-full bg-[#eef] px-[7px] text-[11px]">No runs yet</div>
```

**Typography.** Give headings, navigation, body text and data deliberate roles through the existing type scale, weights, line heights and readable line lengths. Use tabular numerals where values need comparison; let prose wrap without making controls inconsistent. Preserve established fonts and tokens rather than changing them for novelty. Do not substitute tiny labels, gratuitous capitals or isolated accent words for hierarchy.

**Copy.** Name actions from the user's task, not implementation internals. Keep the same vocabulary across controls and confirmations. Use plain verbs and sentence case; labels describe outcomes, not decoration. Empty states offer a relevant next action; errors identify the failed action and available recovery. Reuse its existing control rather than repeating the action in text or adding another button; do not invent a recovery that cannot work.

| Weak                   | Useful                                                            |
| ---------------------- | ----------------------------------------------------------------- |
| `Submit`               | `Save changes` → `Changes saved`                                  |
| `Something went wrong` | `Couldn't save.` beside the existing retry action; keep the draft |
| `No data`              | `No notes yet` beside the existing create action                  |

**Alignment.** Give related headings, search, pinned rows, dividers and records one owning grid/inset. Headers and row contents share columns; action columns stay fixed when labels wrap or are absent. Use the same component/size variant for equivalent controls: icon box/stroke, hit target, control height, baseline and spacing. Pinned content stays outside the scroll area; borders do not jump while scrolling. Fix the owning layout/component, not per-instance offsets; matching boxes alone does not establish optical alignment or legibility. Trace the cause before applying these repairs:

| Defect                             | Check                                         | Owning repair                                                                                      |
| ---------------------------------- | --------------------------------------------- | -------------------------------------------------------------------------------------------------- |
| Squashed icon/avatar               | Fixed-size flex child shrinks                 | Preserve its canonical box with `shrink-0`                                                         |
| Trailing action disappears         | Content track refuses to shrink               | `min-w-0` on content; `shrink-0` on the control, or a shrinkable grid track                        |
| Wrapped rows look adrift           | Center alignment against variable-height text | Consistent, deliberate top/baseline alignment                                                      |
| Identifiers look identical         | Truncation hides the distinguishing segment   | Preserve that segment; expose the full value through an existing keyboard/touch-accessible surface |
| Counts shift during updates        | Proportional digits/inconsistent formatting   | `tabular-nums` + consistent locale/units                                                           |
| Accents/tall scripts clip          | Tight line height or text-box clipping        | Fix the owning type-scale/overflow choice; don't shrink the font to fit                            |
| Missing metadata leaves separators | Empty optional slots still render             | Omit orphaned separators/lines; reserve space only when the layout needs it                        |

**Prevent before rejecting.** When the app already knows an action is not allowed, such as a missing permission, a referenced record or invalid input, disable or hide the control and show the reason beside it. Never let the user act and then show an error the app can predict.

**Motion.** Explain change without delaying input or moving content just for decoration. Reuse existing tokens/components; no new library for a fade or universal curve, duration, bounce or press scale. Show press, pending, success and failure through the existing primitives. Where no primitive sets the easing, use ease-out for entrances, ease-in-out for morphs and linear only for elapsed progress. Start an entrance near its resting size, never from zero. Keep a dismissible surface mounted through its exit, reverse its entry path, and move its panel, backdrop and content together while unrelated chrome stays still. Delay a loader so fast results never flash it, and size it like the final content. List transition properties explicitly; never `transition-all`. Delay the first tooltip, then open neighboring ones at once.

| Interaction                            | Treatment                                                                                          |
| -------------------------------------- | -------------------------------------------------------------------------------------------------- |
| Typing, shortcuts, frequent navigation | Immediate response; no decorative movement                                                         |
| Trigger-anchored surface               | Enter/exit from its trigger; a centered unanchored modal keeps a centered origin                   |
| Rapid toggle/reversal                  | Retarget from the visible state; no input lock, stale-target snap or wait for the prior transition |
| Drag/gesture                           | Follow the pointer; preserve the existing primitive's capture, cancellation and release behavior   |
| Reduced motion                         | Preserve feedback through a suitable static or gentle non-spatial equivalent                       |

Use responsive entry easing and brief existing durations. Simple retargetable states suit transitions; gestures can use the existing spring. Prefer transforms and opacity where appropriate, but CSS and WAAPI do not guarantee compositor execution. Profile observed performance problems, not every animation. Inspect rapid repetition, reversal and reduced motion, not only the final frame.

**Access and responsiveness.** Preserve the complete task on phones, not merely stacked desktop panes. Keep essential actions reachable with keyboard, touch and zoom. Use semantic structure, accessible names, visible focus, logical order and deliberate focus return. Inspect long/duplicate content, overflow, contrast and relevant failure/permission states. Do not remove an accessible affordance to satisfy visual minimalism.

| Mobile defect                                 | Check                                                                                                |
| --------------------------------------------- | ---------------------------------------------------------------------------------------------------- |
| Hover remains after tap                       | Capability-aware styles; inspect the framework's handling before adding another gate                 |
| Input zoom/wrong keyboard                     | Readable input sizing + correct input type/mode; never disable browser zoom                          |
| Bottom controls disappear                     | Real browser chrome, software keyboard and safe areas; appropriate supported viewport sizing/insets  |
| Drag blocks scrolling/content can't be copied | Scope gesture/selection restrictions to their owner; preserve scrolling, zoom and selectable content |

Touch and mouse can coexist; do not infer capabilities from user-agent strings or viewport width. No blanket suppression of overscroll, selection or native feedback without a demonstrated need and working replacement. Emulation verifies selected layout cases, not every phone behavior: affected device-specific keyboard/viewport/gesture contracts need target-device proof before completion.

## Creative mode

Work as the design lead of a studio whose clients reject anything templated, and aim at the level of an award-winning site, not a tidy product page. Every choice of palette, type, layout and motion comes from this brief.

**Ground it.** Name the subject, the audience and the page's one job before designing. Take the visual language from the subject's world: its materials, tools, documents, places, times of day and vernacular. The brief's data is raw material for an idea, not content to lay out; write copy that names concrete capabilities and outcomes, never selling filler.

**Concept first.** Before any system or code, write three concepts that differ in structure, not in palette. Each is one paragraph: the big idea in one sentence; the metaphor or artifact from the subject's world; the structure it gives the page, such as a clock running from night to morning, a document being read, a journey or one interactive object; the signature moment; the motion; and the visual world of type, color, texture and imagery. Score each from 1 to 5 on three questions: would a viewer remember it tomorrow, could it exist for no other subject, does it make the reader act. Discard any concept whose structure is hero, features, list and form. Build the winner whole, with the full canvas, display typefaces chosen for the subject from Fontshare or Google Fonts, and canvas or SVG where the idea needs them; never retreat toward a safe page while building.

**Plan, then challenge the plan.** Then write a compact system for the chosen concept: four to six named colors with roles (canvas, ink, atmosphere, action), one or two clearly distinct typefaces with roles and a type scale, and a layout concept with alignment. Sketch three different compositions as ASCII wireframes, not three palettes, and pick one. Then ask what you would produce for any similar brief; revise every part of the plan that matches it, and say what changed.

**Defaults to avoid.** These appear whatever the subject, so they read as generated: a cream canvas with a serif display and a clay accent; near-black with one acid accent; broadsheet hairlines with zero radius; identical rounded cards with soft shadows and gradient washes; all-caps eyebrows above headings, middle-dot meta strings, a monospace face for labels, `→` on every link; one emphasized word in a headline; numbering on content that is no sequence. Also the generated launch-page skeleton: hero, feature table, ranked list, logo row, email form, each section opened by a heading on the left and a grey paragraph on the right; a pale sage or off-white canvas with navy ink. Use one only when the brief asks for it.

**Compose.** Build the page around one artifact from the subject's world, shown as it lives there: the message as it arrives, the object as it is used, the document as it is read. Invent the page's structure from the story that artifact tells, not from a section template, and give the product a mark people remember. Open with the most characteristic thing in its best form: a headline, an image, a live demo or an interaction, not a big number with a gradient by default. Own the grid: deliberate spans, overlaps and whitespace, with repeated layouts only for content with equal roles. Alternate dense demonstrations with quiet reading passages. Let typography carry the personality, as an active visual element, with body lines under 75 characters. Spend boldness on one memorable signature, keep everything around it quiet, and remove one more element before you finish.

**Imagery and texture.** Make subject-specific assets with one consistent light, material, palette and crop; keep text and controls in code. Take texture from the subject's real materials, never a universal grain or grid overlay. Never present a generated picture or invented testimonial as evidence.

**Motion.** Use motion to explain: a cause and its effect, a before and after, a process in order, not content fading in. Choreograph one orchestrated moment, such as the page load or one reveal, instead of fade-up entrances on every section. Before coding a sequence, write its purpose, focal order, movement, easing, duration, overlap and resting moment. Animate interactions from their spatial origin and keep them interruptible. Bind scroll storytelling to scroll progress without hijacking scrolling, and keep the first viewport readable and actionable before any animation runs. Every motion has a complete reduced-motion and static version; stop offscreen animation. For a video, storyboard timed keyframes with reading holds, persistent objects and deterministic frames, and check text at the size it plays.

**Critique.** Capture desktop and phone, and slowed motion frames; compare them with the plan and with the defaults above. Batch the repairs and recheck once. The quality floor is silent: responsive to phones, visible keyboard focus, sufficient contrast and reduced motion respected.

## Prototype

**Try the question.** Build one rough representative screen or interaction in the existing host with realistic data. Inspect enough to make the trial trustworthy, then show it to the user before merge-readiness work. Label stubs and limits; a conceptual sketch is sufficient only when execution is unnecessary, never proof of working software. Set a short first-preview budget; show a partial result or blocker rather than expanding unseen. No production completeness or polished gallery first.

**Use the findings.** For layout questions, compare hierarchy or interaction, not color-only variants. Compare several directions at the mockup stage; add real attempts only for unresolved uncertainty, feedback or an explicit request. A style question can compare style. Keep useful comparisons; discard/rebuild freely and combine compatible strengths, not incompatible mechanisms. Test the weakest assumption while it can change the choice. A settled direction needs no manufactured taste question or exploration round.

## Verify and show

**Inspect retained UI.** Open actual captures at the sizes needed for the task. Compare related edges, columns, baselines and equivalent controls across rows/screens—not just successful clicks. Use realistic long names/URLs, translated labels, Unicode, missing fields and relevant 0/1/many records at the actual container width. Respect schema/API limits; never add a validation limit to make layout pass. Mix cases across rows. Check selected/focus/error states and scrolling; a clean default row can hide misalignment. Inspect hierarchy, density, legibility and clipping. Exercise the relevant keyboard/touch, narrow/wide, zoom and focus-return journeys; run axe where applicable. A clean scan does not prove contrast or usability. Inspect meaningful video frames and sequence; a playable file is not proof of a good composition. Batch relevant inspection/repairs; recheck affected views rather than restart a whole audit after each micro-edit. Visible misalignment, inconsistent controls or redundant elements remain defects even when types/tests pass; fix them before claiming acceptance. Inspect motion in slowed intermediate frames for jumps and stretched text.

**Generic output.** Check every capture for these tells and fix each one before showing it:

| Tell                                            | Check                                                    |
| ----------------------------------------------- | -------------------------------------------------------- |
| Every section is a bordered card with an icon   | Each container has a grouping purpose; remove the others |
| Everything has equal prominence                 | The blurred capture still shows the primary content      |
| Uniform gaps                                    | Unrelated groups sit farther apart than related items    |
| Each tile gets its own accent color             | Every hue names a state, series or action                |
| An emphasized headline word or decorative label | Removing the treatment loses no meaning, so remove it    |
| Charts, rings or dots without readable data     | Each graphic shows values, units or state                |
| Generic copy such as "seamless" or "Learn more" | Each label names its capability or the click's outcome   |
| Content that waits for an entrance animation    | The first frame is readable and actionable               |

**Show the design.** Use inspected screenshots for layout and short video for behavior. Compare at consistent sizes with states needed for the decision; no variant switcher just to see the options. A visual must add spatial or interactive information, not reproduce prose, a file list or a fake runtime screenshot. Embed useful existing captures in the render rather than recreate them. For diagrams, review pages and rendered answers, follow Visual explanations below. Use the user's theme and verify the actual browser color preference. Preserve useful media and retire settled attempts; environment decides how long previews run.

**Review surfaces.** Open on the outcome the user needs to judge, with technical detail available on demand. Group by changed behavior, not files or agent stages. A selected example, diagram or diff must reveal its scope; never make curated evidence look like complete coverage. Do not build a custom review dashboard when existing captures and the PR can answer the question. A design-skill edit is not a product-screen change.

## Visual explanations

These rules cover diagrams, review pages and rendered agent answers; the pair prompt decides when a reply needs a render. A render replaces the text it shows; it never repeats it.

**Pick the exhibit from the question.**

| The reader asks                      | Exhibit                                                        |
| ------------------------------------ | -------------------------------------------------------------- |
| What changed on screen?              | Before and after pair with the same data, the old state left   |
| Which transitions are allowed?       | State machine with forbidden edges marked                      |
| What happens in order, and who acts? | Sequence in swimlanes, one lane per actor                      |
| Where did the time go?               | Timeline with bars on one time axis                            |
| How much faster, bigger or cheaper?  | Bars on a shared axis, values printed on the bars              |
| Where exactly is the defect?         | Annotated capture with numbered markers and short notes        |
| Which requirement has which proof?   | Coverage grid of requirements against proof, colored by state  |
| Where does the change live?          | Change map: a tree with sizes, added and removed parts colored |
| How do the parts relate?             | Node and link map with few, labeled links                      |
| Which option is better?              | Options side by side at the same size and with the same data   |
| What will a video show?              | Storyboard of chapter frames, the outcome frame marked         |

When none fits, choose the form that matches the data's shape, not the first card layout that comes to mind. Draw a list as a list.

- **One message.** Each page answers one question. Its title states the conclusion, such as "The catalog loads 26 times faster", not the topic.
- **One dominant element.** Size, weight and position show importance. Mute the context and make secondary detail smaller.
- **Color means something.** Use the theme's status colors only for states and the chart colors only for series. Keep one accent, and never color for decoration.
- **Label directly.** Put names and values on the data instead of a distant legend. Show units, and use one scale per comparison.
- **Real content.** Use real names, numbers and captures. Show the scope, so a sample never looks like full coverage.

- **Grid and rhythm.** Align to one grid. Use a spacing scale of 4, 8, 12 and 16 pixels, two or three type sizes, and one corner radius.
- **Little text.** Labels and captions stay under twelve words. A visual holds no paragraphs.
- **Small multiples.** Compare several cases with repeated small exhibits on the same scale, rather than one crowded chart.
- **Both themes and widths.** Use the host's theme variables, check light and dark, and keep the page readable at phone width.
- **Inspect before showing.** Look at the rendered page for clipping, overlap, contrast and empty areas, and fix them first.

**Avoid** these:

- A table or bullet list redrawn as styled boxes.
- A card, badge or icon for every fact.
- Gradients, shadows and illustrations that carry no information.
- Crossing links, when an ordered list or lanes would show the same relation.
- A visual that repeats the text around it.

## Image assets

Use image generation only for a needed illustrative asset, atmosphere, texture or icon exploration—not ordinary text, exact diagrams or fake working UI. Use the native tool exposed by the harness; no invented invocation or replacement API client when unavailable. Report missing capability honestly.

Describe purpose, placement, composition, palette and intended size and aspect ratio. For edits, supply the real source and state what remains unchanged. Generate only what the chosen direction needs; prefer existing icons or CSS when they express the job precisely. Inspect the returned asset at its intended size for crop, text and edge artifacts, contrast and fit. Preserve useful originals and identify generated assets as such; they are not runtime or browser proof. Keep only used assets in product source.
