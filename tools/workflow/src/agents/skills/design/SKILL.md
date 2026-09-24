---
name: design
description: 'Use for any rendered UI work: prototypes, new or changed screens, and UI review.'
---

Consistency in UI and UX comes first: the result looks and behaves like the rest of the app it lives in.

## Consistency first

- Before designing, read the 2–3 nearest screens of the same kind and the shared components they compose.
- Match their page structure, spacing, type sizes, radius, icons, density, states, and copy.
- Where the app is inconsistent, follow the majority of the surrounding screens.
- Never hardcode a value the app derives from its theme or components.

## Rules

Consistency:

- Semantic theme tokens only, never named colors, so any shadcn theme works.
- One radius system and one icon family, the ones the app already uses.
- The same action looks the same and has the same name everywhere.

Layout:

- Group by proximity before adding a card; cards only when elevation means something, never nested.

Hierarchy:

- Hierarchy by size and weight; `tabular-nums` for numbers.
- No decorative all-caps labels or 01/02 numbering.

States:

- Every control has hover, focus-visible, active, disabled, loading, and error states.
- Skeletons are shaped like the final layout.
- Empty states say what to do and carry the action.
- Errors sit next to the field and name the fix.

Interaction:

- Motion only for state changes, 150–250 ms ease-out; none on constant or keyboard actions.
- Filters, tabs, and pagination live in the URL.
- Destructive actions confirm or undo.

Copy:

- Button labels say what happens; the success message reuses the verb.

## Prototypes

- Be creative and build 3–5 completely different variants, each differing on a named axis: layout, density, hierarchy, or interaction.
- Never variants that differ only in color.
- Use real, product-shaped content.
- Render them in place, on the screen they belong to, switchable with the switcher below.
- After the user picks, delete the losing variants and the switcher.

## Variant switcher

A sketch to adapt to the host screen: ← and → cycle through the variants, and `Button` is the repository's shadcn button (deslop: `packages/components`, dual: `packages/ui`).

```tsx
const [selected, setSelected] = useState(0)
// a plain window keydown listener: ArrowLeft and ArrowRight move selected by one, wrapping around variants.length
return (
	<>
		{variants[selected]}
		<nav className="fixed bottom-4 left-1/2 z-50 flex -translate-x-1/2 gap-1">
			{variants.map((_variant, index) => (
				<Button key={index} variant={index === selected ? 'secondary' : 'ghost'} onClick={() => setSelected(index)}>
					{index + 1}
				</Button>
			))}
		</nav>
	</>
)
```

## Looking at the result

When appearance is at stake (prototype variants, new or changed surfaces, not logic-only changes):

- Take one browser screenshot per variant or state and read it back.
- Judge it against these rules and the nearest screens.
- Apply one batch of fixes, then at most one confirming round.

## Matching a reference UI

- Before styling to a named reference UI, read its component source in `~/.deslop/repos`; never guess from screenshots.
- Turn "cleaner" or "the spacing is bad" into numeric targets (padding, gap, icon box, popup size), each with the reference's `path:line`.
- Size icons by a shared box, and scale up an SVG that fills less of its canvas.
- Use one horizontal inset for search, pinned rows, dividers, and list rows.
- In dense lists, show state with a background (the selected row, the active tab with an accent bar), never a check column.
- Keep controls always visible, outlined or filled, never only on hover, and pinned rows outside the scroll area.
- When rows share a name, the subtitle shows what tells them apart.
- Finish a design pass with light and dark screenshots next to the reference.

## deslop

In deslop, the project-engineering skill's Components rules also apply.
