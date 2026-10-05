---
name: design
description: 'UI and UX rules for screens and visual explanations. Use when building, prototyping, or reviewing a component, diagram, review page, or other rendered agent output.'
---

# Design

**Scope.** Follow repository-specific CODING_STANDARDS.md and engineering.

## Decide

**Direction.** Start from the actual task, audience, content and settled preferences. Make the next user action and its relevant content dominant, not generic "premium" styling. When a reference is useful, inspect the relevant accepted one for transferable hierarchy, density and interaction choices; distinguish observed details from inferred ones. Community brand analyses are inspiration, not verified current tokens. Keep durable visual choices at their owner, not repeated briefs. Ask only about a consequential tradeoff the evidence cannot settle; another agent cannot establish user taste.

**One meaning.** Each visible element must add information, enable a distinct action or clarify a relationship. Delete repeated headings, summaries, counts, status badges, decorative wrappers and controls that say or do the same thing. Remove explanations that merely restate the visible example/state. Keyboard shortcuts, screen-reader labels and responsive placement are not redundant visible controls; preserve their function.

**Scan-first.** Put the task, relevant content and next action where they can be identified without reading a paragraph. Use stable visual roles, not another card/badge/icon for every fact. Expose needed detail on demand, never hide a consequential warning or essential action.

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

**Interaction and state.** Controls remain discoverable, never hover-only. Use the canonical selected-row/active-tab treatment; do not add a second badge or check column that echoes it. Keep pending/error feedback beside its owner and preserve recoverable input. No redundant refresh, copied state or polling shortcut around the existing reactive integration.

**Motion.** Explain change without delaying input or moving content just for decoration. Reuse existing tokens/components; no new library for a fade or universal curve, duration, bounce or press scale.

| Interaction                            | Treatment                                                                                          |
| -------------------------------------- | -------------------------------------------------------------------------------------------------- |
| Typing, shortcuts, frequent navigation | Immediate response; no decorative movement                                                         |
| Trigger-anchored surface               | Enter/exit from its trigger; a centered unanchored modal keeps a centered origin                   |
| Rapid toggle/reversal                  | Retarget from the visible state; no input lock, stale-target snap or wait for the prior transition |
| Drag/gesture                           | Follow the pointer; preserve the existing primitive's capture, cancellation and release behavior   |
| Reduced motion                         | Preserve feedback through a suitable static or gentle non-spatial equivalent                       |

Use responsive entry easing and brief existing durations. Simple retargetable states suit transitions; gestures may need the existing spring. Prefer transform/opacity where appropriate, but CSS/WAAPI does not guarantee compositor execution. Profile observed performance problems, not every animation. Inspect rapid repetition/reversal and reduced motion, not only the final frame.

**Access and responsiveness.** Preserve the complete task on phones, not merely stacked desktop panes. Keep essential actions reachable with keyboard, touch and zoom. Use semantic structure, accessible names, visible focus, logical order and deliberate focus return. Inspect long/duplicate content, overflow, contrast and relevant failure/permission states. Do not remove an accessible affordance to satisfy visual minimalism.

| Mobile defect                                 | Check                                                                                                |
| --------------------------------------------- | ---------------------------------------------------------------------------------------------------- |
| Hover remains after tap                       | Capability-aware styles; inspect the framework's handling before adding another gate                 |
| Input zoom/wrong keyboard                     | Readable input sizing + correct input type/mode; never disable browser zoom                          |
| Bottom controls disappear                     | Real browser chrome, software keyboard and safe areas; appropriate supported viewport sizing/insets  |
| Drag blocks scrolling/content can't be copied | Scope gesture/selection restrictions to their owner; preserve scrolling, zoom and selectable content |

Touch and mouse can coexist; do not infer capabilities from user-agent strings or viewport width. No blanket suppression of overscroll, selection or native feedback without a demonstrated need and working replacement. Emulation verifies selected layout cases, not every phone behavior: affected device-specific keyboard/viewport/gesture contracts need target-device proof before completion.

## Prototype

**Try the question.** Build one rough representative screen or interaction in the existing host with realistic data. Inspect enough to make the trial trustworthy, then show it to the user before merge-readiness work. Label stubs and limits; a conceptual sketch is sufficient only when execution is unnecessary, never proof of working software. Set a short first-preview budget; show a partial result or blocker rather than expanding unseen. No production completeness or polished gallery first.

**Use the findings.** For layout questions, compare hierarchy or interaction, not color-only variants. Add attempts only for unresolved uncertainty, feedback or an explicit request—no fixed count; a style question can compare style. Keep useful comparisons; discard/rebuild freely and combine compatible strengths, not incompatible mechanisms. Test the weakest assumption while it can change the choice. A settled direction needs no manufactured taste question or exploration round.

## Verify and show

**Inspect retained UI.** Open actual captures at the sizes needed for the task. Compare related edges, columns, baselines and equivalent controls across rows/screens—not just successful clicks. Use realistic long names/URLs, translated labels, Unicode, missing fields and relevant 0/1/many records at the actual container width. Respect schema/API limits; never add a validation limit to make layout pass. Mix cases across rows. Check selected/focus/error states and scrolling; a clean default row can hide misalignment. Inspect hierarchy, density, legibility and clipping. Exercise the relevant keyboard/touch, narrow/wide, zoom and focus-return journeys; run axe where applicable. A clean scan does not prove contrast or usability. Inspect meaningful video frames and sequence; a playable file is not proof of a good composition. Batch relevant inspection/repairs; recheck affected views rather than restart a whole audit after each micro-edit. Visible misalignment, inconsistent controls or redundant elements remain defects even when types/tests pass; fix them before claiming acceptance.

**Show the design.** Use inspected screenshots for layout and short video for behavior. Compare at consistent sizes with states needed for the decision; no variant switcher just to see the options. A visual must add spatial or interactive information, not reproduce prose, a file list or a fake runtime screenshot. Link useful existing evidence rather than render another explanation page. Use the user's theme and verify the actual browser color preference. Preserve useful media and retire settled attempts; persistent previews are opt-in.

**Review surfaces.** Open on the outcome the user needs to judge, with technical detail available on demand. Group by changed behavior, not files or agent stages. A selected example, diagram or diff must reveal its scope; never make curated evidence look like complete coverage. Do not build a custom review dashboard when existing captures and the PR can answer the question. A design-skill edit is not a product-screen change.

## Image assets

Use image generation only for a needed illustrative asset, atmosphere, texture or icon exploration—not ordinary text, exact diagrams or fake working UI. Use the native tool exposed by the harness; no invented invocation or replacement API client when unavailable. Report missing capability honestly.

Describe purpose, placement, composition, palette and intended size/aspect ratio. For edits, supply the real source and state what remains unchanged. Generate only what the chosen direction needs; prefer existing icons/CSS when they express the job precisely. Inspect the returned asset at its intended size for crop, text/edge artifacts, contrast and fit. Preserve useful originals and identify generated assets as such; they are not runtime/browser proof. Keep only used assets in product source.
