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
- Render them in place, on the screen they belong to, switchable with the snippet below.
- After the user picks, delete the losing variants and the snippet.

## Variant switcher

Wrap the variants in it; ← and → cycle through them. Adjust the `Button` import to the host repository's button primitive.

```tsx
import {useEffect, useState} from 'react'
import {Button} from '#components/ui/button.tsx'
function Variants(props: {children: React.ReactNode[]}) {
	const [value, setValue] = useState(0)
	useEffect(() => {
		function onKeyDown(event: KeyboardEvent) {
			if (event.key === 'ArrowLeft') setValue(index => (index + props.children.length - 1) % props.children.length)
			if (event.key === 'ArrowRight') setValue(index => (index + 1) % props.children.length)
		}
		window.addEventListener('keydown', onKeyDown)
		return () => window.removeEventListener('keydown', onKeyDown)
	}, [props.children.length])
	return (
		<>
			{props.children[value]}
			<nav className="border-border bg-background fixed bottom-4 left-1/2 z-50 flex -translate-x-1/2 gap-1 border p-1.5">
				{props.children.map((_child, index) => (
					<Button
						key={index}
						variant={index === value ? 'secondary' : 'ghost'}
						aria-current={index === value ? 'page' : undefined}
						onClick={() => setValue(index)}
					>
						{index + 1}
					</Button>
				))}
			</nav>
		</>
	)
}
```

## Looking at the result

When appearance is at stake (prototype variants, new or changed surfaces, not logic-only changes):

- Take one browser screenshot per variant or state and read it back.
- Judge it against these rules and the nearest screens.
- Apply one batch of fixes, then at most one confirming round.

## deslop

In deslop, the project-engineering skill's Components rules also apply.
