---
name: design
description: 'UI and UX rules for screens and visual explanations. Use when building, prototyping, or reviewing a component, diagram, review page, or other rendered agent output.'
---

# Design

The best UI is the one that looks and behaves like the app around it, shows each thing once, and holds nothing that adds no value. Apply the visual conventions in the repository's CODING_STANDARDS.md; this skill wins where they leave a case open.

**Components.** Build every screen from the shared shadcn components in the repository's components package, to the fullest: a missing one is added with the repository's documented shadcn command, never hand-built or restyled. A value lint flags moves to the nearest design-system step, token, or variant.

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

When prototyping an open UI direction, propose at least five materially different versions of the same small real slice: vary layout, density, hierarchy, or interaction, not just cosmetic details. Let the user's task and product-shaped content shape the composition; preserve the app's palette, typography, and component language. Reuse one initialized host rather than five apps, builds, or worktrees. Inspect and show labeled screenshots of every version at consistent desktop and phone viewports; use short videos where interaction or time matters. No variant switcher or manual journey for the user to compare them. Normal verification of a settled UI is not another five-version exercise. Challenge the strongest candidate's remaining weakness and refine while another small trial can change the choice; a smaller layout alone is not a better one. Respect the user's visual preference, remove losing variants, and expand the pick as product code without a stage-approval callback.

## Visual explanations

**Comprehension.** Choose the form that makes the user's next judgement easiest, not the richest format you can generate. Keep a conclusion in readable text; compare aligned facts in a table; show relationships or spatial changes in an image; use interaction for exploring evidence and video for change over time. Do not turn every reply into a page, diagram, or explainer video. An image of prose is harder to search, copy, and read on a phone than the prose itself.

**Hierarchy.** Start with the outcome or decision, then its decisive evidence and limits. Group by the reader's question rather than the agent's execution order. Use consistent labels, active verbs, direct sentences and concrete examples. Put annotations beside the thing they explain; a legend, color, animation or decoration must add information. Never shrink a whole desktop canvas into unreadable phone output; simplify or split it into legible views.

**Review.** A review page is a short map to the real diff, not another diff viewer or approval gate. Group net changes by intent; attach observed proof and limits to their claims, with links to the authoritative source. Distinguish facts, hypotheses and unrun steps. Name the revision the evidence covers; discard stale material after changes. Filtering, comparisons or focused expansion must save reading, not hide important risks or require clicking to discover the conclusion. Read-only local controls do not post comments, approve a PR or persist review state.

**Delivery.** Keep the essential result readable in the conversation without opening an artifact. Offer an interactive page only when interaction materially helps; exposure and retention follow the user's preview preference. Use the current client's supported link/preview surface, not an assumed browser panel. Prove the actual controls, keyboard access, desktop and phone layout, errors and meaningful screenshots. Capture one short interaction when it adds evidence; inspect it, then stop owned services and remove settled prototype source. No duplicate chat, page and PR recap.
