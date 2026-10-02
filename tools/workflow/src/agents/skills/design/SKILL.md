---
name: design
description: 'UI and UX rules for rendered screens, built from the shared shadcn components. Use when building, prototyping, or reviewing a screen or component.'
---

# Design

The best UI is the one that looks and behaves like the app around it, shows each thing once, and holds nothing that adds no value. Apply the visual conventions in the repository's CODING_STANDARDS.md; this skill wins where they leave a case open.

**Components.** Build every screen from the shared shadcn components in the repository's components package, to the fullest: a missing one is added with the repository's shadcn command (the `environment` skill names it), never hand-built or restyled. A value lint flags moves to the nearest design-system step, token, or variant.

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

**Feedback.** A mutation shows that it happened with a small, quiet change of the affected element; motion only for state changes; loading and error states only where the action produces them, and an error sits next to its field.

## Prototypes

When the direction is open, compare serious variants that differ in kind (layout, density, hierarchy, or interaction), on the real screen with product-shaped content. Build only the slice that settles the question; switchable variants use buttons labeled with their axis. Do not fill a fixed variant quota or rebuild alternatives that the evidence already rules out. A behavior question gets the smallest interaction that settles it. Once one is picked, remove the other variants and finish the pick as product code.
