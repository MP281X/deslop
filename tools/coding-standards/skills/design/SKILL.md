---
name: design
description: 'UI and UX rules for product screens, creative pages and visual explanations. Use when building, prototyping or reviewing a component, page, diagram, review page or other rendered agent output.'
---

# Design

Follow the repository's `CODING_STANDARDS.md` and the engineering skill.

**Two modes.** Consistent mode works inside an existing product and follows every rule below. Creative mode covers work with no product to match, such as websites, launch pages, portfolios, motion and video. It replaces Decide and Build with [Creative mode](#creative-mode), because dense product rules turn every page into a dashboard; Access and phones and Verify still apply. In a mixed request, the product's screens stay consistent.

## Decide

**Direction.** Start from the task, audience, content and the user's settled preferences. The next user action and its content dominate, not a generic "premium" style. When a reference helps, take hierarchy, density and interaction from the accepted one, and say which details you observed and which you inferred. Community brand analyses are inspiration, not verified current tokens.

**One meaning.** Each visible element adds information, enables a distinct action or shows a relationship. Delete repeated headings, summaries, counts, status badges, decorative wrappers and controls that say or do the same thing, and text that restates the visible example or state. Keyboard shortcuts, screen-reader labels and responsive placement are not redundant; keep their function.

**Scan first.** The task, its content and the next action read without a paragraph. Use stable visual roles, not another card, badge or icon for each fact. Put detail on demand, but never hide a consequential warning or an essential action.

**Hierarchy.** Blur a capture: the primary content and the next action still stand out.

- Unequal priorities get unequal weight; repeat a layout only for records with equal roles.
- Mute labels, metadata and chrome before you enlarge content. Each decision area has one strongest action; the others use secondary or text variants.
- Gaps inside a group are smaller than gaps between groups; space above a heading is larger than below it.
- The first phone viewport shows real content and the next action, not an introduction.
- Left-align prose and records, and keep prose at 45 to 75 characters a line.
- The accent marks actions and selection, status colors mark states, and chart colors mark series.

| Content                       | Treatment                                                                             |
| ----------------------------- | ------------------------------------------------------------------------------------- |
| Comparable records or options | Aligned rows and columns with consistent order, units and metadata placement          |
| Familiar action               | A conventional icon-only control with an accessible name and one owner                |
| Ambiguous action              | A clear text label, never an invented or guessed icon, or an icon with redundant text |
| Explanation                   | The real state or example first; text only for missing context or impact              |

```tsx
// one visible action, named for assistive technology
<Button aria-label="Rename" size="icon"><PencilIcon aria-hidden /></Button>
// redundant label for an already-obvious action
<Button><PencilIcon />Rename</Button>
```

Never remove a needed name, status, comfortable hit target or instruction only to make a screen smaller.

## Build

These rules cover product UI. A rendered explanation follows the host's rendering contract and these rules.

**Components.** Reuse the existing renderer, states and interactions for the same role; read its relevant source or API, not the whole catalogue. Add a missing primitive through the repository's registry command. Fix a wrong shared pattern at its owner when you deliver retained code, not before an exploratory preview. Without a sibling, use the supplied reference and the component defaults within settled preferences.

```tsx
// same model-selection control used elsewhere
<ModelPicker value={model} onValueChange={setModel} />
// another representation of the same job
<Select value={model} onValueChange={setModel} />
```

**Tokens and surfaces.** Use the existing app host, compiler, theme, shared components and Tailwind tokens. Add no escape into custom CSS or dynamic classes and no hardcoded color or size exception, and weaken no shared rule. Keep surfaces flat and dense: group by proximity before borders or elevation, and nest no cards or wrappers that only label content again. Whitespace serves hierarchy, separation or comfortable use, not filling the page.

```tsx
// existing primitives and semantic tokens
<Empty><EmptyTitle>No runs yet</EmptyTitle><Button onClick={startRun}>Run</Button></Empty>
// parallel hand-built appearance
<div className="rounded-full bg-[#eef] px-[7px] text-[11px]">No runs yet</div>
```

**Typography.** Give headings, navigation, body text and data deliberate roles from the existing type scale, weights, line heights and line lengths. Use tabular numerals for compared values, and let prose wrap without making controls inconsistent. Keep the established fonts and tokens; never change them for novelty. Never use tiny labels, needless capitals or one accented word in place of hierarchy.

**Copy.** Name actions after the user's task, not implementation internals, with one vocabulary across controls and confirmations. Use plain verbs and sentence case; labels describe outcomes. An empty state offers the relevant next action. An error names the failed action and the recovery that exists, beside its existing control; never repeat the action in text or invent a recovery that cannot work.

| Weak                   | Useful                                                            |
| ---------------------- | ----------------------------------------------------------------- |
| `Submit`               | `Save changes`, then `Changes saved`                              |
| `Something went wrong` | `Couldn't save.` beside the existing retry action; keep the draft |
| `No data`              | `No notes yet` beside the existing create action                  |

**Alignment.** Related headings, search, pinned rows, dividers and records share one grid and inset, and headers share columns with row contents. Action columns stay fixed when labels wrap or are missing. Equivalent controls share component and size: icon box, stroke, hit target, height, baseline and spacing. Pinned content stays outside the scroll area, and borders stay still while scrolling. Fix the owning layout or component, never one instance's offset; equal boxes alone prove neither optical alignment nor legibility. Trace the cause first:

| Defect                             | Cause                                   | Repair                                                                             |
| ---------------------------------- | --------------------------------------- | ---------------------------------------------------------------------------------- |
| Squashed icon or avatar            | A fixed-size flex child shrinks         | `shrink-0` keeps its canonical box                                                 |
| Trailing action disappears         | The content track refuses to shrink     | `min-w-0` on the content and `shrink-0` on the control, or a shrinkable grid track |
| Wrapped rows look adrift           | Centering against text of varied height | One deliberate top or baseline alignment                                           |
| Identifiers look identical         | Truncation hides the distinct part      | Keep that part; show the full value on an existing keyboard and touch surface      |
| Counts shift during updates        | Proportional digits or mixed formats    | `tabular-nums` with consistent locale and units                                    |
| Accents or tall scripts clip       | Tight line height or text-box clipping  | Fix the owning type scale or overflow; never shrink the font to fit                |
| Missing metadata leaves separators | Empty optional slots still render       | Omit orphaned separators and lines; reserve space only when layout needs it        |

**Prevent before rejecting.** When the app already knows an action is not allowed, such as a missing permission, a referenced record or invalid input, disable or hide the control and show the reason beside it. Never let the user act and then show an error the app can predict.

**Motion.** Motion explains a change; it never delays input or moves content for decoration. Reuse existing tokens and components: no new library for a fade, and no universal curve, duration, bounce or press scale. Show press, pending, success and failure through the existing primitives.

- Use brief existing durations and responsive entry easing. Where no primitive sets the easing, use ease-out for entrances, ease-in-out for morphs and linear only for elapsed progress.
- An entrance starts near its resting size, never from zero. A dismissible surface stays mounted through its exit and reverses its entry path; its panel, backdrop and content move together while unrelated chrome stays still.
- A surface anchored to a trigger enters and exits from it; a centered unanchored modal keeps a centered origin.
- Typing, shortcuts and frequent navigation respond at once, without decorative movement. A rapid toggle or reversal retargets from the visible state, with no input lock, stale-target snap or wait for the earlier transition.
- A drag follows the pointer and keeps the primitive's capture, cancel and release behavior. Reduced motion keeps the feedback with a static or gentle non-spatial equivalent.
- Delay a loader so fast results never flash it, and size it like the final content. List transition properties; never `transition-all`. Delay the first tooltip, then open neighbors at once.
- Transitions suit simple states that retarget; gestures can use the existing spring. Prefer transforms and opacity, but neither CSS nor WAAPI guarantees compositor execution. Profile only an observed performance problem.
- Inspect rapid repetition, reversal and reduced motion in slowed intermediate frames for jumps and stretched text, not only the final frame.

**Access and phones.** The whole task works on a phone, not only stacked desktop panes, and essential actions stay reachable with keyboard, touch and zoom. Use semantic structure, accessible names, visible focus, logical order and deliberate focus return. Inspect long and duplicate content, overflow, contrast, and the failure and permission states that apply. Never remove an accessible affordance for minimalism.

- Hover that stays after a tap needs capability-aware styles; read the framework's handling before you add another gate.
- Inputs use a readable size and the right input type and mode; never disable browser zoom.
- Bottom controls survive real browser chrome, the software keyboard and safe areas, with supported viewport units and insets.
- Scope gesture and selection limits to their owner, and keep scrolling, zoom and selectable content.
- Touch and mouse coexist: never infer capabilities from the user agent or the viewport width. Add no blanket suppression of overscroll, selection or native feedback without a shown need and a working replacement.
- Emulation verifies selected layout cases, not every phone behavior: an affected device-specific keyboard, viewport or gesture contract needs proof on the target device.

## Creative mode

Work as the design lead of a studio whose clients reject anything templated, and aim at an award-winning site, not a tidy product page. Every choice of palette, type, layout and motion comes from this brief.

**Ground it.** Before designing, name the subject, the audience and the page's one job. Take the visual language from the subject's world: its materials, tools, documents, places, times of day and vernacular. The brief's data is raw material for an idea, not content to lay out. Copy names concrete capabilities and outcomes, never selling filler.

**Concept first.** Before any system or code, write three concepts that differ in structure, not palette. Each is one paragraph: the big idea in one sentence; the metaphor or artifact from the subject's world; the structure it gives the page, such as a clock from night to morning, a document being read, a journey or one interactive object; the signature moment; the motion; and the visual world of type, color, texture and imagery. Score each from 1 to 5: would a viewer remember it tomorrow, does it belong to this subject alone, does it make the reader act. Discard any concept built as hero, features, list and form. Build the winner whole: the full canvas, display typefaces from Fontshare or Google Fonts chosen for the subject, and canvas or SVG where the idea needs them. Never retreat toward a safe page while building.

**Plan, then challenge it.** Write a compact system: four to six named colors with roles (canvas, ink, atmosphere, action), one or two distinct typefaces with roles and a type scale, and a layout concept with its alignment. Sketch three compositions as ASCII wireframes, not three palettes, and pick one. Then ask what you would produce for any similar brief, change every part of the plan that matches it, and say what changed.

**Defaults to avoid** unless the brief asks for one, because they appear whatever the subject and read as generated:

- a cream canvas with a serif display and a clay accent; near-black with one acid accent; navy ink on pale sage or off-white;
- broadsheet hairlines with zero radius; identical rounded cards with soft shadows and gradient washes;
- all-caps eyebrows, middle-dot meta strings, a monospace label face, `→` on every link, one emphasized headline word, and numbering on content that is no sequence;
- the launch-page skeleton: hero, feature table, ranked list, logo row and email form, each section a heading on the left and a grey paragraph on the right.

**Compose.** Build the page around one artifact from the subject's world, shown as it lives there: the message as it arrives, the object in use, the document as it is read. Take the structure from that artifact's story, not a section template, and give the product a mark people remember. Open with the most characteristic thing in its best form: a headline, an image, a live demo or an interaction, not a big number with a gradient by default. Own the grid with deliberate spans, overlaps and whitespace, and repeat a layout only for content with equal roles. Alternate dense demonstrations with quiet reading passages. Typography carries the personality as an active visual element, with body lines under 75 characters. Spend boldness on one signature, keep the rest quiet, and remove one more element before you finish.

**Imagery and texture.** Make assets for the subject with one consistent light, material, palette and crop, and keep text and controls in code. Take texture from the subject's real materials, never a universal grain or grid overlay. Never present a generated picture or an invented testimonial as evidence.

**Motion.** Motion explains a cause and its effect, a before and after, or a process in order; it never only fades content in. Choreograph one moment, such as the page load or one reveal, instead of fade-ups on every section. Before coding a sequence, write its purpose, focal order, movement, easing, duration, overlap and resting moment. Animate interactions from their spatial origin and keep them interruptible. Scroll storytelling follows scroll progress without hijacking it, and the first viewport reads and acts before any animation runs. Every motion has a complete reduced-motion and static version, and offscreen animation stops. A video gets a storyboard of timed keyframes with reading holds, persistent objects and deterministic frames, and its text is checked at playback size.

**Critique.** Capture desktop, phone and slowed motion frames, and compare them with the plan and the defaults above. Batch the repairs and recheck once. The quality floor holds without mention: phone layouts, visible keyboard focus, enough contrast and reduced motion.

## Prototype

**Try the question.** Build one rough representative screen or interaction in the existing host with realistic data. Inspect enough to trust the trial, then show it before any merge-readiness work. Label stubs and limits; a sketch is enough only when execution is unnecessary, and it never proves working software. Set a short budget for the first preview, and show a partial result or a blocker rather than growing unseen. Build no production completeness or polished gallery first.

**Use the findings.** For a layout question, compare hierarchy or interaction, not color variants; a style question can compare style. Compare several directions as mockups, and build real attempts only for open uncertainty, feedback or an explicit request. Keep useful comparisons, discard and rebuild freely, and combine compatible strengths, never incompatible mechanisms. Test the weakest assumption while it can still change the choice. A settled direction needs no invented taste question or exploration round.

## Verify and show

**Inspect retained UI** in real captures at the sizes the task needs:

- Compare related edges, columns, baselines and equivalent controls across rows and screens, not only successful clicks.
- Use long names and URLs, translated labels, Unicode, missing fields and 0, 1 and many records, mixed across rows at the real container width. Respect schema and API limits; never add a validation limit to make a layout pass.
- Check selected, focus, error and scrolling states, and the hierarchy, density, legibility, contrast and clipping.
- Walk the keyboard, touch, narrow, wide, zoom and focus-return journeys that apply, and run axe where it applies; a clean scan proves neither contrast nor usability.
- Inspect video frames in sequence; a playable file is not a good composition.

Batch repairs and recheck only the affected views instead of restarting the audit after each small edit. Misalignment, inconsistent controls and redundant elements stay defects when types and tests pass; fix them before you claim acceptance.

**Generic output.** Fix each of these tells before you show a capture:

| Tell                                            | Check                                                  |
| ----------------------------------------------- | ------------------------------------------------------ |
| Every section is a bordered card with an icon   | Each container groups something; remove the others     |
| Everything has equal prominence                 | The blurred capture still shows the primary content    |
| Uniform gaps                                    | Unrelated groups sit farther apart than related items  |
| Each tile gets its own accent color             | Every hue names a state, series or action              |
| An emphasized headline word or decorative label | Removing the treatment loses no meaning, so remove it  |
| Charts, rings or dots without readable data     | Each graphic shows values, units or state              |
| Generic copy such as "seamless" or "Learn more" | Each label names its capability or the click's outcome |
| Content that waits for an entrance animation    | The first frame is readable and actionable             |

**Show the design** with inspected screenshots for layout and short video for behavior, at consistent sizes, with the states the decision needs, in the user's theme and the browser's real color preference. Embed existing captures instead of recreating them, and build no variant switcher only to view options. Keep useful media and retire settled attempts; environment decides how long previews run. A review surface opens on the outcome the user judges, with technical detail on demand, and groups by changed behavior, not by file or agent stage. Build no custom dashboard when captures and the pull request answer the question. A design-skill edit is not a product-screen change.

## Visual explanations

These rules cover diagrams, review pages and rendered agent answers; the pair prompt decides when a reply needs a render. A render adds spatial or interactive information and replaces the text it shows; it never redraws prose, a file list or a fake runtime screenshot.

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

When none fits, choose the form that matches the data's shape, not the first card layout; draw a list as a list.

- **One message.** Each page answers one question, and its title states the conclusion, such as "The catalog loads 26 times faster", not the topic.
- **One dominant element.** Size, weight and position show importance; mute the context and shrink secondary detail.
- **Color.** Use the theme's status colors only for states and its chart colors only for series. Keep one accent and no decorative color.
- **Labels.** Put names, values and units on the data instead of a distant legend, with one scale per comparison. Repeat small exhibits on one scale rather than crowd one chart.
- **Real content.** Use real names, numbers and captures, and show the scope, so a sample never looks like full coverage.
- **Grid.** Align to one grid with 4, 8, 12 and 16 pixel spacing, two or three type sizes and one corner radius. Labels and captions stay under twelve words, and a visual holds no paragraphs.
- **Check.** Use the host's theme variables, check light, dark and phone width, and fix clipping, overlap, contrast and empty areas before you show it.

**Avoid** a table or list redrawn as styled boxes, and a card, badge or icon for every fact. Avoid gradients, shadows and illustrations that carry no information, crossing links where an ordered list or lanes show the same relation, and a visual that repeats the text around it.

## Image assets

Generate an image only for a needed illustration, atmosphere, texture or icon exploration, never for text, exact diagrams or fake working UI. Use the harness's native tool; when it is missing, say so instead of inventing an invocation or an API client. Describe the purpose, placement, composition, palette, size and aspect ratio; for an edit, supply the real source and state what stays unchanged. Generate only what the chosen direction needs, and prefer existing icons or CSS when they fit. Inspect the result at its real size for crop, text, edge artifacts, contrast and fit. Keep useful originals, label generated assets as generated, never count them as runtime or browser proof, and keep only used assets in product source.
