---
name: design
description: 'UI and UX rules for screens and visual explanations. Use when building, prototyping, or reviewing a component, diagram, review page, or other rendered agent output.'
---

# Design

The best UI is the one that looks and behaves like the app around it, shows each thing once, and holds nothing that adds no value. Apply the visual conventions in the repository's CODING_STANDARDS.md; this skill wins where they leave a case open.

**Components.** Build every screen from the shared shadcn components in the repository's components package, to the fullest: a missing one is added with the repository's documented shadcn command, never hand-built or restyled. A value lint flags moves to the nearest design-system step, token, or variant.

**Prototype code.** Reuse the initialized app's source host, compiler, theme and checks. Prototype layout uses the same shared components and Tailwind tokens as product code; custom CSS, dynamic classes or weaker scratch configuration are not an escape from the rules. Run the first small component through format, lint/types and its real journey before expanding variants.

```tsx
// good
<Badge variant="secondary">Draft</Badge>
<Empty><EmptyTitle>No runs yet</EmptyTitle><Button onClick={() => startRun()}>Run</Button></Empty>
// bad — "without hardcoding those values the desing/ui/ux need to be consistent with the rest of the app"
<span className="rounded-full bg-[#eef] px-[7px] text-[11px]">Draft</span>
<div className="flex flex-col items-center gap-2 p-6 text-muted-foreground">No runs yet</div>
```

**Consistency.** Read the nearest screens of the same kind and the components they compose first, and match their structure, spacing, type, icons, density, states, copy, and behavior; where the app is inconsistent, follow the majority. Reuse the existing component or renderer for a job before adding one. With no screen of the same kind, t3code's interface (github.com/pingdotgg/t3code) is the reference.

```tsx
// good — the picker every other model choice uses
<ModelPicker value={model} onValueChange={setModel} />
// bad — "make how the button behave consistent with the rest to not break the user expectations"
<Select value={model} onValueChange={setModel}>{models.map(...)}</Select> // a second picker that behaves differently
```

**One way.** One way to see each piece of data or do each action, and the same action has the same look and name everywhere; remove what adds no value: refresh buttons, duplicate badges, an icon and a label that say the same, decorative elements, wrappers.

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

**Mobile.** Every screen works fully on a phone, layout and interaction alike; no deep nesting that a small screen cannot reach.

**Feedback.** A mutation shows that it happened with a small, quiet change of the affected element; loading and error states only where the action produces them, and an error sits next to its field. Motion explains feedback or spatial change, never decorates it: frequent keyboard actions, navigation, and data being read stay immediate. Reuse existing motion tokens and respect reduced motion; add no animation dependency for a CSS state change.

**Inspect.** Open the actual desktop and phone screenshots while building: judge hierarchy, density, readable content, alignment, clipping, and reachable controls, not just whether the action passed. Fix visible defects and weak composition before delivery. For interaction, inspect meaningful recorded frames and their sequence; a playable file or duration is not a visual review.

## Prototypes

**Task.** Name the person, their next action and the uncertainty each version tests. Use realistic domain content and the same task/data across contenders; a different color or rearranged decoration is not a new mechanism. Match the surface to its job: editing, scanning, comparing, exploring a graph or reviewing a decision need different hierarchies.

**Concept.** Include an ambitious mechanism and a smaller plain one. Explore different information models or interaction metaphors, not five versions of the same dashboard. Borrow a useful pattern from a real product, adapt it to this task and challenge its tradeoff. Typography, rhythm, selective color and spatial structure should express the concept; novelty is valuable only when it improves the user's action or understanding.

**Behavior.** Prototype the smallest complete user journey, not only its populated happy screenshot. Include the states that can change the choice: empty, long/duplicate names, selection, validation/failure, pending action or permission limits. Keep outcomes consistent across versions. A prettier shell that cannot finish the task loses to one that can.

**Interaction.** Use the shared component's semantics and keyboard behavior, with visible focus, accessible names and deliberate focus return. A mobile adaptation must preserve the task, not merely stack desktop panes or hide actions. Test long content and reachable controls at the actual viewport; dense is not tiny text or touch targets.

When prototyping an open UI direction, propose at least five materially different versions of the same small real slice: vary layout, density, hierarchy, or interaction, not just cosmetic details. Let the user's task and product-shaped content shape the composition; preserve the app's palette, typography, and component language. Reuse one initialized host rather than five apps, builds, or worktrees. Inspect and show labeled screenshots of every version at consistent desktop and phone viewports; use short videos where interaction or time matters. No variant switcher or manual journey for the user to compare them. Normal verification of a settled UI is not another five-version exercise. Challenge the strongest candidate's remaining weakness and refine while another small trial can change the choice; a smaller layout alone is not a better one. Respect the user's visual preference, remove losing variants, and expand the pick as product code without a stage-approval callback.

## Visual explanations

**Comprehension.** Choose the form that makes the user's next judgement easiest, not the richest format you can generate. Keep a conclusion in readable text; compare aligned facts in a table; show relationships or spatial changes in an image; use interaction for exploring evidence and video for change over time. Do not turn every reply into a page, diagram, or explainer video. An image of prose is harder to search, copy, and read on a phone than the prose itself.

**Hierarchy.** Start with the outcome or decision, then its decisive evidence and limits. Group by the reader's question rather than the agent's execution order. Use consistent labels, active verbs, direct sentences and concrete examples. Put annotations beside the thing they explain; a legend, color, animation or decoration must add information. Never shrink a whole desktop canvas into unreadable phone output; simplify or split it into legible views.

**Review.** Review evidence is a short map to the real diff, not another diff viewer or approval gate. Group net changes by intent; attach observed proof and limits to their claims, with links to the authoritative source. Distinguish facts, hypotheses and unrun steps. Name the revision the evidence covers; discard stale material after changes. Filtering, comparisons or focused expansion must save reading, not hide important risks or require clicking to discover the conclusion.

**Delivery.** Keep planning, comparisons and review in the conversation as readable text and embedded images/video. Disposable HTML or a real app host may render evidence; it is not an external plan or persistence mechanism. An interactive preview is for a requested working app, not a required place to read the decision. Prove actual controls, keyboard access, desktop/phone layout and errors; inspect meaningful screenshots and a short interaction when it adds evidence. Stop owned proof services and remove settled prototype source. No duplicate chat, page and PR recap.

**Theme and scale.** Agent-made explanations use the user's dark theme and the existing design tokens. Set and verify the browser's dark color preference; a dark class alone does not activate a media-query theme. Show the best full-size view, with other variants separately legible; never compress five phone-length walls of prose into a tiny screenshot strip. Use real relationships, structure or changed behavior when an image adds comprehension, not decorated paragraphs. Reject a weak composition even when overflow and clicks pass.

## Image assets

Use image generation for an asset that benefits from synthesis—illustration, atmosphere, texture, an icon exploration—not for ordinary text, an exact diagram or a fake screenshot of functioning software. Use the native generation/editing tool exposed by the assigned harness (Codex image work uses its native image tool); never invent a tool call or substitute an API client when the capability is absent. Missing capability is a reported gap, not a successful generation.

Give the tool the asset's purpose, placement, composition, existing palette, intended dimensions/aspect ratio and output constraints. For edits, supply the real source image and name what must remain unchanged. Generate only assets the chosen direction needs; do not add speculative art or an image dependency to an otherwise complete UI. Use repository icons and CSS where they express the job more precisely.

Inspect the actual returned file at its intended display size: composition, subject, crop, text/edge artifacts, contrast and fit with the surrounding screen. Correct visible defects before integrating. Preserve useful original output and identify it as generated; a generated visual is not runtime or browser evidence. Real UI proof still comes from the rendered app and actual interaction. Store only used assets in product source; remove discarded variants and temporary generation material.
