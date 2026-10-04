---
name: design
description: 'UI and UX rules for screens and visual explanations. Use when building, prototyping, or reviewing a component, diagram, review page, or other rendered agent output.'
---

# Design

**Scope.** Follow repository-specific CODING_STANDARDS.md and engineering. CLI-installed skills are read-only; change the maintained package source and refresh through the CLI.

## Decide

**Defaults.** Start from the task, settled preferences and accepted visual references. Keep durable visual choices at their owning guidance or repository standards; do not recreate them in task briefs. Ask only about a new consequential tradeoff the evidence cannot settle; another agent cannot establish user taste.

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

**Alignment.** Related headings, search, pinned rows, dividers and list content share deliberate edges. Reuse the owning inset/grid rather than tuning each instance. Match icon boxes, control height, text baseline, spacing and density within the same role. Pinned content stays outside the scroll area; borders do not jump while scrolling. Fix the shared layout cause, not individual one-pixel offsets. Optical alignment and legibility still need inspection; matching bounding boxes alone is not enough.

**Interaction and state.** Controls remain discoverable, never hover-only. Use the canonical selected-row/active-tab treatment; do not add a second badge or check column that echoes it. Keep pending/error feedback beside its owner and preserve recoverable input. Motion explains change without delaying input, navigation or reading; respect reduced motion. No redundant refresh, copied state or polling shortcut around the existing reactive integration.

**Access and responsiveness.** Preserve the complete task on phones, not merely stacked desktop panes. Keep essential actions reachable with keyboard, touch and zoom. Use semantic structure, accessible names, visible focus, logical order and deliberate focus return. Inspect long/duplicate content, overflow, contrast and relevant failure/permission states. Do not remove an accessible affordance to satisfy visual minimalism.

## Prototype

**Try the question.** Build one rough representative screen/interaction in the existing host with realistic data. Inspect enough to make the trial trustworthy, then let the user try it before merge-readiness work. Label stubs and limits; a conceptual sketch is sufficient only when execution is unnecessary, never proof of working software. Set a short first-preview budget; show a partial result/blocker rather than expanding unseen. No production completeness or polished gallery first.

**Use the findings.** Add materially different attempts only for unresolved uncertainty, feedback or an explicit request—no fixed count. Keep useful comparisons; discard/rebuild freely and combine compatible strengths, not incompatible mechanisms. Test the weakest assumption while it can change the choice. A settled direction needs no manufactured taste question or exploration round.

## Verify and explain

**Inspect retained UI.** Open actual captures at the sizes needed for the task. Check whether every element earns its place, actions have one visible owner, related controls use the same renderer, and edges/baselines/spacing align. Inspect hierarchy, density, legibility, clipping and visual states—not just successful clicks. Exercise the relevant keyboard/touch, narrow/wide, zoom, error and focus-return journeys; run axe where applicable. A clean scan does not prove contrast or usability. Inspect meaningful video frames and sequence; a playable file is not proof of a good composition. Fix observed defects before claiming acceptance.

**One representation.** Use Markdown for conclusions/comparisons/file maps, visuals for relationships/layout, interaction for exploration and video for behavior over time. Give each fact or changed contract one primary location containing its file/example/consequence. An example replaces the prose retelling; do not repeat it in a summary, table and detail section. Keep risks beside the change they qualify; supporting proof can collapse. A second representation must answer a different question, not decorate the first. Cover all semantic/config changes without formatting noise, host-status repetition or a screenshot file browser.

**Delivery.** Show inspected examples beside the decision they support. Use consistent comparison sizes; do not make the user navigate a variant switcher merely to see the options. HTML complements Markdown only when spatial relationships or real interaction add information; no images/videos of prose or fake screenshots. Link existing evidence rather than duplicating chat, page and PR recaps. Use the user's theme and existing tokens; verify actual browser color preference, not only a dark class. Keep temporary source/services under ignored repository scratch, preserve useful media and remove settled drivers/rejected source. Stop owned temporary services after proof; persistent previews are opt-in.

## Image assets

Use image generation only for a needed illustrative asset, atmosphere, texture or icon exploration—not ordinary text, exact diagrams or fake working UI. Use the native tool exposed by the harness; no invented invocation or replacement API client when unavailable. Report missing capability honestly.

Describe purpose, placement, composition, palette and intended size/aspect ratio. For edits, supply the real source and state what remains unchanged. Generate only what the chosen direction needs; prefer existing icons/CSS when they express the job precisely. Inspect the returned asset at its intended size for crop, text/edge artifacts, contrast and fit. Preserve useful originals and identify generated assets as such; they are not runtime/browser proof. Keep only used assets in product source.
