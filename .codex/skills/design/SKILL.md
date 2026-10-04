---
name: design
description: 'UI and UX rules for screens and visual explanations. Use when building, prototyping, or reviewing a component, diagram, review page, or other rendered agent output.'
---

# Design

**Scope.** Follow repository-specific CODING_STANDARDS.md and engineering. CLI-installed skills are read-only; change the maintained package source and refresh through the CLI.

## Decide

**Direction.** Start from the actual task, audience, content and settled preferences. Make the next user action and its relevant content dominant, not generic "premium" styling. When a reference is useful, inspect the relevant accepted one for transferable hierarchy, density and interaction choices; distinguish observed details from inferred ones. Community brand analyses are inspiration, not verified current tokens. Keep durable visual choices at their owner, not repeated briefs. Ask only about a consequential tradeoff the evidence cannot settle; another agent cannot establish user taste.

**One meaning.** Each visible element must add information, enable a distinct action or clarify a relationship. Delete repeated headings, summaries, counts, status badges, decorative wrappers and controls that say or do the same thing in the same context. Prefer an obvious icon with an accessible name or a clear text label, not both repeating each other. Keyboard shortcuts, screen-reader labels and responsive placement are not redundant visible controls; preserve their function.

```tsx
// one visible action, named for assistive technology
<Button aria-label="Rename" size="icon"><PencilIcon aria-hidden /></Button>
// redundant label for an already-obvious action
<Button><PencilIcon />Rename</Button>
```

Do not remove necessary names, status or instructions merely to make a screen smaller. An unfamiliar icon is not an adequate replacement for a clear label.

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

**Alignment.** Related headings, search, pinned rows, dividers and list content share deliberate edges. Reuse the owning inset/grid rather than tuning each instance. Match icon boxes, control height, text baseline, spacing and density within the same role. Pinned content stays outside the scroll area; borders do not jump while scrolling. Fix the shared layout cause, not individual one-pixel offsets. Optical alignment and legibility still need inspection; matching bounding boxes alone is not enough.

**Interaction and state.** Controls remain discoverable, never hover-only. Use the canonical selected-row/active-tab treatment; do not add a second badge or check column that echoes it. Keep pending/error feedback beside its owner and preserve recoverable input. Motion explains change without delaying input, navigation or reading; frequent typing/navigation actions favor instant feedback. Respect reduced motion. No redundant refresh, copied state or polling shortcut around the existing reactive integration.

**Access and responsiveness.** Preserve the complete task on phones, not merely stacked desktop panes. Keep essential actions reachable with keyboard, touch and zoom. Use semantic structure, accessible names, visible focus, logical order and deliberate focus return. Inspect long/duplicate content, overflow, contrast and relevant failure/permission states. Do not remove an accessible affordance to satisfy visual minimalism.

## Prototype

**Try the question.** Build one rough representative screen/interaction in the existing host with realistic data. Inspect enough to make the trial trustworthy, then let the user try it before merge-readiness work. Label stubs and limits; a conceptual sketch is sufficient only when execution is unnecessary, never proof of working software. Set a short first-preview budget; show a partial result/blocker rather than expanding unseen. No production completeness or polished gallery first.

**Use the findings.** For layout questions, compare hierarchy or interaction, not color-only variants. Add attempts only for unresolved uncertainty, feedback or an explicit request—no fixed count; a style question can compare style. Keep useful comparisons; discard/rebuild freely and combine compatible strengths, not incompatible mechanisms. Test the weakest assumption while it can change the choice. A settled direction needs no manufactured taste question or exploration round.

## Verify and show

**Inspect retained UI.** Open actual captures at the sizes needed for the task. Check whether every element earns its place, actions have one visible owner, related controls use the same renderer, and edges/baselines/spacing align. Inspect hierarchy, density, legibility, clipping and visual states—not just successful clicks. Exercise the relevant keyboard/touch, narrow/wide, zoom, error and focus-return journeys; run axe where applicable. A clean scan does not prove contrast or usability. Inspect meaningful video frames and sequence; a playable file is not proof of a good composition. Batch relevant state/viewport inspection and resulting repairs; recheck affected views rather than restart a whole visual audit after each micro-edit. Fix observed defects before claiming acceptance.

**Show the design.** Use inspected screenshots for layout and short video for behavior. Compare at consistent sizes with states needed for the decision; no variant switcher just to see the options. Prefer the existing app-owned preview/element feedback. A visual must add spatial or interactive information, not reproduce prose, a file list or a fake runtime screenshot. Link useful existing evidence rather than render another explanation page. Use the user's theme and verify the actual browser color preference. Keep temporary source/services in ignored scratch, preserve useful media and retire settled attempts; persistent previews are opt-in.

## Image assets

Use image generation only for a needed illustrative asset, atmosphere, texture or icon exploration—not ordinary text, exact diagrams or fake working UI. Use the native tool exposed by the harness; no invented invocation or replacement API client when unavailable. Report missing capability honestly.

Describe purpose, placement, composition, palette and intended size/aspect ratio. For edits, supply the real source and state what remains unchanged. Generate only what the chosen direction needs; prefer existing icons/CSS when they express the job precisely. Inspect the returned asset at its intended size for crop, text/edge artifacts, contrast and fit. Preserve useful originals and identify generated assets as such; they are not runtime/browser proof. Keep only used assets in product source.
