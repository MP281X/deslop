---
name: design
description: 'UI and UX rules for screens and visual explanations. Use when building, prototyping, or reviewing a component, diagram, review page, or other rendered agent output.'
---

# Design

**Scope.** Follow repository-specific CODING_STANDARDS.md and engineering. CLI-installed skills are read-only; change the maintained package source and refresh through the CLI.

## Decide

**Defaults.** Apply settled user preferences, the task and concrete references before inventing a direction. Keep durable visual preferences and accepted references in their owning design guidance or repository standards, not repeated task briefs; reuse them on the next screen. Ask only about a genuinely new consequential tradeoff that the evidence cannot settle. A critique from another agent does not establish user preference.

**One meaning.** Each visible element must add information, enable a distinct action or clarify a relationship. Delete repeated headings, summaries, counts, status badges, decorative wrappers and controls that say or do the same thing in the same context. Prefer an obvious icon with an accessible name or a clear text label, not both repeating each other. Keyboard shortcuts, screen-reader labels and responsive placement are not redundant visible controls; preserve their function.

```tsx
// one visible action, named for assistive technology
<Button aria-label="Rename" size="icon"><PencilIcon aria-hidden /></Button>
// redundant label for an already-obvious action
<Button><PencilIcon />Rename</Button>
```

Do not remove necessary names, status or instructions merely to make a screen smaller. An unfamiliar icon is not an adequate replacement for a clear label.

## Build

**Canonical components.** Find the existing renderer for the same role. Reuse its component, states and interaction model; do not create another picker, row or dialog for the same job. Inspect only the relevant source/props and registry capabilities, not a full catalogue for every task. Add missing primitives through the repository's registry command. For retained code, fix a wrong shared pattern at its owner within scope rather than copying its inconsistency or adding a local workaround. An exploratory preview does not require refactoring the shared system first. Without a sibling, use the supplied reference and existing component defaults within settled preferences.

```tsx
// same model-selection control used elsewhere
<ModelPicker value={model} onValueChange={setModel} />
// another representation of the same job
<Select value={model} onValueChange={setModel} />
```

**Tokens and structure.** Use the existing app host, compiler, theme, shared components and Tailwind tokens. No custom-CSS/dynamic-class escape or hardcoded color/size exception. Do not weaken shared rules/configuration for a throwaway experiment; do not demand a full check suite before showing it either. Keep surfaces flat and dense; group by proximity before adding borders or elevation. No nested cards or wrappers that merely label content again. Whitespace must support hierarchy, separation or comfortable use, not fill the page.

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

**Question.** Name the next user action and uncertainty the example should settle. If the task is already specified, implement it; do not manufacture design alternatives or a taste question.

**Smallest useful example.** Build the cheapest rough runnable slice that can answer the question. A labelled conceptual sketch is enough only when execution is not needed to judge the idea; do not call it working software. Use realistic task/data and one representative screen or interaction in the existing host. Set a short first-preview budget; if blocked, show the partial result and concrete blocker rather than expanding the investigation unseen. Stub an unneeded boundary honestly, not a disposable architecture. Do not implement production completeness or polish a gallery before showing the first useful result.

**Feedback and synthesis.** Let the user try the actual example before merge-readiness review, aggressive cleanup or comprehensive regression proof. Inspect enough to ensure it tests the intended question; label stubs and limits. Show it while the result can still change direction. Add materially different alternatives only when feedback, unresolved uncertainty or an explicit broader request warrants them; no fixed variant count. Apply known preferences autonomously. Compare transferable strengths and choose a coherent blend, not a concatenation of incompatible mechanisms. Test its weakest assumption before expansion. Reuse one host and keep only comparisons that still answer an open question. Freely discard attempts and rebuild from their findings when simpler than extending the wrong code; no fixed attempt count or sunk-cost obligation to expand a slice. Apply full review, relevant accessibility/responsive proof and cleanup to the retained implementation; settled verification does not need another exploration round.

## Verify and explain

**Inspect the result.** Open actual captures at the sizes needed for the task. Check whether every element earns its place, actions have one visible owner, related controls use the same renderer, and edges/baselines/spacing align. Inspect hierarchy, density, legibility, clipping and visual states—not just successful clicks. Exercise the relevant keyboard/touch, narrow/wide, zoom, error and focus-return journeys; run axe where applicable. A clean scan does not prove contrast or usability. Inspect meaningful video frames and sequence; a playable file is not proof of a good composition. Fix observed defects before claiming acceptance.

**One representation.** Use Markdown for conclusions/comparisons/file maps, visuals for relationships/layout, interaction for exploration and video for behavior over time. Give each fact or changed contract one primary location containing its file/example/consequence. An example replaces the prose retelling; do not repeat it in a summary, table and detail section. Keep risks beside the change they qualify; supporting proof can collapse. A second representation must answer a different question, not decorate the first. Cover all semantic/config changes without formatting noise, host-status repetition or a screenshot file browser.

**Delivery.** Show inspected examples beside the decision they support. Use consistent comparison sizes; do not make the user navigate a variant switcher merely to see the options. HTML complements Markdown only when spatial relationships or real interaction add information; no images/videos of prose or fake screenshots. Link existing evidence rather than duplicating chat, page and PR recaps. Use the user's theme and existing tokens; verify actual browser color preference, not only a dark class. Keep temporary source/services under ignored repository scratch, preserve useful media and remove settled drivers/rejected source. Stop owned temporary services after proof; persistent previews are opt-in.

## Image assets

Use image generation only for a needed illustrative asset, atmosphere, texture or icon exploration—not ordinary text, exact diagrams or fake working UI. Use the native tool exposed by the harness; no invented invocation or replacement API client when unavailable. Report missing capability honestly.

Describe purpose, placement, composition, palette and intended size/aspect ratio. For edits, supply the real source and state what remains unchanged. Generate only what the chosen direction needs; prefer existing icons/CSS when they express the job precisely. Inspect the returned asset at its intended size for crop, text/edge artifacts, contrast and fit. Preserve useful originals and identify generated assets as such; they are not runtime/browser proof. Keep only used assets in product source.
