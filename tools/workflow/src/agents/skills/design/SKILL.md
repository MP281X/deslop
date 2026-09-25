---
name: design
description: 'Use for any rendered UI work: prototypes, new or changed screens, and UI review.'
---

## Consistency first

- Before designing, read the 2–3 nearest screens of the same kind and the shared components they compose.
- Match their page structure, spacing, type sizes, radius, icons, density, states, and copy.
- Where the app is inconsistent, follow the majority of the surrounding screens.
- Apply the repository's `project-engineering` skill's visual conventions where one exists.

## Rules

Consistency:

- Semantic theme tokens only; never hardcode a value the theme or a shared component provides.
- The same action looks the same and has the same name everywhere.

Layout:

- Group by proximity before adding a card; cards only when elevation means something, never nested.
- Size icons by a shared box, and scale up an SVG that fills less of its canvas.
- Use one horizontal inset for search, pinned rows, dividers, and list rows.
- Keep controls always visible, outlined or filled, never only on hover, and pinned rows outside the scroll area.
- When rows share a name, the subtitle shows what tells them apart.

Hierarchy:

- Hierarchy by size and weight; `tabular-nums` for numbers.
- No decorative all-caps labels or 01/02 numbering.

States:

- Controls keep the shared component's hover, focus-visible, active, and disabled states; loading and error only where the action produces them.
- In dense lists, show state with a background (the selected row, the active tab with an accent bar), never a check column.
- Skeletons are shaped like the final layout.
- Empty states say what to do and carry the action.
- Errors sit next to the field and name the fix.

Interaction:

- Motion only for state changes, 150–250 ms ease-out; none on constant or keyboard actions.
- Filters, tabs, and pagination live in the URL where the surrounding screens keep them there.
- Destructive actions confirm or undo.

Copy:

- Button labels say what happens; the success message reuses the verb.

## Prototypes

- Be creative and build 3–5 completely different variants, each differing on a named axis: layout, density, hierarchy, or interaction.
- Never variants that differ only in color.
- Use real, product-shaped content.
- Render them in place, on the screen they belong to, switchable with the switcher below.

## Variant switcher

A sketch to adapt to the host screen: ← and → cycle through the variants, and `Button` is the repository's shadcn button, from the UI package the environment skill names.

```tsx
const [selected, setSelected] = useState(0)
return (
	<>
		{variants[selected]}
		<nav className="fixed bottom-4 left-1/2 z-50 flex -translate-x-1/2 gap-1">
			{Array.map(variants, (_variant, index) => (
				<Button key={index} variant={index === selected ? 'secondary' : 'ghost'} onClick={() => setSelected(index)}>
					{index + 1}
				</Button>
			))}
		</nav>
	</>
)
```

## Looking at the result

When appearance is at stake (prototype variants, new or changed surfaces, not logic-only changes), take one browser screenshot per variant or state, read it back, and judge it against these rules and the nearest screens.

## Matching a reference UI

- Read the reference's component source in its clone (environment skill) and take numeric targets (padding, gap, icon box, popup size) with its `path:line`; never guess from screenshots.
- Finish a design pass with light and dark screenshots next to the reference.
