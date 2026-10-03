---
name: design
description: 'UI and UX rules for screens and visual explanations. Use when building, prototyping, or reviewing a component, diagram, review page, or other rendered agent output.'
---

# Design

**Scope.** Follow repository-specific CODING_STANDARDS.md. CLI-installed skills are read-only; improve their package source and refresh via the CLI.

**Catalog.** List installed components and current shadcn registry capabilities before designing; group the available primitives by purpose. Inspect source/props rather than assuming training-era APIs. Reuse shared components; add missing registry components through the repository command, never hand-build or restyle them. Lint violations use existing tokens/variants.

**Code.** Reuse one app host, compiler, theme, shared components and Tailwind tokens. No custom-CSS/dynamic-class escape or weaker scratch checks. Verify the first real slice before expanding.

```tsx
// good
<Badge variant="secondary">Draft</Badge>
<Empty><EmptyTitle>No runs yet</EmptyTitle><Button onClick={() => startRun()}>Run</Button></Empty>
// bad — "without hardcoding those values the desing/ui/ux need to be consistent with the rest of the app"
<span className="rounded-full bg-[#eef] px-[7px] text-[11px]">Draft</span>
<div className="flex flex-col items-center gap-2 p-6 text-muted-foreground">No runs yet</div>
```

**Consistency.** Match nearest screens: structure, spacing, type, icons, density, states, copy and behavior. Reuse their renderer; follow the majority where inconsistent. Without a sibling, use T3 Code's interface as reference.

```tsx
// good — the picker every other model choice uses
<ModelPicker value={model} onValueChange={setModel} />
// bad — "make how the button behave consistent with the rest to not break the user expectations"
<Select value={model} onValueChange={setModel}>{models.map(...)}</Select> // a second picker that behaves differently
```

**One way.** One representation/action, one consistent name and appearance. Remove redundant refresh, badges, icon-label pairs, decoration and wrappers.

```tsx
// good
<StarIcon aria-label="Default" />
// bad — "i don't want refresh buttons or stuffs like that in the ui/app"
<Button onClick={refetch}><RefreshIcon /></Button>
<Badge><StarIcon /> Default</Badge> // "Don't have icons/emoji and text that say the same thing"
```

**Compact.** Flat and dense: group by proximity before adding a card, cards only when elevation means something and never nested, and no empty vertical space.

```tsx
// good
<section className="flex flex-col gap-2">{rows}</section>
// bad — "keep the UI flat/brutalist/minimal… don't have nested cards or visually heavy layouts"
<Card><CardContent><Card className="p-8">{rows}</Card></CardContent></Card>
```

**Precision.** Exact on the design-system scale: icons sized by one shared box, one horizontal inset for search, pinned rows, dividers, and list rows; pinned rows outside the scroll area; borders that stay put while scrolling.

```tsx
// good
<SearchIcon className="size-4" />
// bad — "some icons have different sizes", "the spacing is kinda shitty"
<SearchIcon width={15} height={15} />
```

**Visible.** Controls are always visible, outlined or filled, never only on hover; state shows by background (the selected row, the active tab), never a check column; when rows share a name, the subtitle shows what tells them apart.

```tsx
// good
<TableRow data-state={selected ? 'selected' : undefined}>
// bad — "i'm not a fan that things like the empty star comes out on hover"
<Button className="opacity-0 group-hover:opacity-100" variant="ghost">
```

**Responsive.** Preserve the complete task on phones, not merely stacked desktop panes. Test narrow/wide screens, long/duplicate content, zoom, overflow, touch targets and reachable controls; no hidden essential action or deep nesting.

**Accessible.** Semantic landmarks, headings, labels and status/errors; keyboard navigation, visible focus, logical order and deliberate return, contrast, reduced motion and accessible names. Run axe and real keyboard/touch journeys; automated scans alone do not prove accessibility.

**Feedback.** Quiet local mutation feedback; pending/error state beside its action or field. Motion explains change, never delays input/navigation/reading. Use existing tokens and respect reduced motion; no animation dependency for a CSS state change.

**Inspect.** Open actual desktop/phone captures: hierarchy, density, legibility, alignment, clipping, controls. Inspect meaningful video frames and sequence. Fix weak composition even when clicks/axe pass; a playable recording is not inspection.

## Prototypes

**Task.** Name the person, next action and uncertainty. Compare the same realistic task/data; hierarchy follows editing, scanning, comparison, graph exploration or review.

**Range.** Show at least five clearly different directions across information model, interaction, layout, density and visual language—not cosmetic variations. Include an ambitious/unexpected concept and a plain smaller direction; adapt useful real-product patterns. Label executable prototypes versus conceptual sketches and what each tests. Concepts may contribute only an interaction, hierarchy or visual idea; never imply they are working software.

**Behavior.** Executable candidates exercise the smallest complete journey plus choice-changing empty, long/duplicate, selection, pending, failure and permission states. Conceptual sketches state unimplemented behavior; judge their idea, not a fictional runtime pass.

**Synthesis.** The user often chooses between directions. Compare transferable strengths/tradeoffs and propose a coherent blend; don't force a winner or concatenate incompatible mechanisms. Test the blend's weakest assumption before expansion.

**Show.** Labeled, inspected desktop/phone views at consistent sizes; short video only for meaningful interaction. No manual variant-switcher journey. Reuse one host, discard losing source and expand the synthesis. Settled UI verification does not require five more directions.

## Visual explanations

**Form.** Markdown for conclusions, comparisons and file maps; visuals for relationships/layout; interaction for exploration; video for change over time. Use the simplest useful form, not images of prose.

**Hierarchy.** Outcome/decision, decisive evidence, limits. Group by reader question, not execution order; consistent labels and annotations beside their subject. Simplify/split for phones, never shrink unreadable canvases.

**Review.** Map every semantic/config change to final packages/files; distinguish moves/generated copies and omit formatting noise. Use readable lists/tables, not compressed tree art. Explain behavior and consequential choices without requiring diff reading. Risks stay visible; supporting detail collapses. No host-status duplication or screenshot file browser.

**Delivery.** Markdown carries the explanation. HTML complements it only where spatial relationships, layout or interaction communicate something Markdown cannot; never screenshot or record a replacement for readable prose, tables or file maps. Embed only the useful visual, beside its claim; keep secondary captures collapsed or linked rather than making a gallery the default reading path. Prove actual controls, keyboard access, desktop/phone layout and errors. Keep temporary hosts, source and media under the repository's ignored scratch path, never a root proof directory. Stop owned services and remove settled source. No duplicate chat, page and PR recap.

**Theme and scale.** Agent-made visuals use the user's dark theme and existing design tokens. Verify browser color preference; a dark class alone does not activate a media-query theme. Align headings, controls and rows to shared insets; use consistent type/spacing and compact grouping, not empty space or tiny text. Show variants separately legible, not as a compressed strip. Inspect hierarchy, density and alignment at desktop/phone sizes; reject a weak composition even when overflow and clicks pass.

## Image assets

Use image generation for an asset that benefits from synthesis—illustration, atmosphere, texture, an icon exploration—not for ordinary text, an exact diagram or a fake screenshot of functioning software. Use the native generation/editing tool exposed by the assigned harness (Codex image work uses its native image tool); never invent a tool call or substitute an API client when the capability is absent. Missing capability is a reported gap, not a successful generation.

Give the tool the asset's purpose, placement, composition, existing palette, intended dimensions/aspect ratio and output constraints. For edits, supply the real source image and name what must remain unchanged. Generate only assets the chosen direction needs; do not add speculative art or an image dependency to an otherwise complete UI. Use repository icons and CSS where they express the job more precisely.

Inspect the actual returned file at its intended display size: composition, subject, crop, text/edge artifacts, contrast and fit with the surrounding screen. Correct visible defects before integrating. Preserve useful original output and identify it as generated; a generated visual is not runtime or browser evidence. Real UI proof still comes from the rendered app and actual interaction. Store only used assets in product source; remove discarded variants and temporary generation material.
