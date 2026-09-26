---
name: design
description: 'Visual rules for rendered UI. Use when building, prototyping, or reviewing a screen or component, or matching a reference UI.'
---

# Design

Rendered work matches the screens around it first and a reference second; prototypes explore, execution polishes.

## Consistency first

- Before designing, read the 2–3 nearest screens of the same kind and the shared components they compose.
- Match their page structure, spacing, type sizes, radius, icons, density, states, and copy.
- Where the app is inconsistent, follow the majority of the surrounding screens.
- Apply the visual conventions in the repository's CODING_STANDARDS.md where one exists.

## Rules

Consistency:

- The shadcn lint rules reject raw colors, arbitrary values, inline styles, and restyled shared components; move a value lint or review flags to the nearest design-system step, token, or variant: a small visual shift is fine, a new layout or color scheme is not, and a disable stays only where no close step exists.
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

- A narrow question gets 2–3 close variants; an open one gets 3–4 completely different mechanisms, each differing on a named axis: layout, density, hierarchy, or interaction.
- Never variants that differ only in color.
- Use real, product-shaped content.
- Render them in place, on the screen they belong to, switchable by buttons labeled with each variant's axis.
- Stub every mutation, and ignore lint, tokens, and polish except consistency with the nearest screen; a winning variant is rebuilt in execution, never promoted.

## Looking at the result

Prototype variants get one screenshot each, for the user, with no read-back or rule review. In execution, when appearance is at stake, take one browser screenshot per new or changed state, read it back, and judge it against these rules and the nearest screens.

## Matching a reference UI

- Read the reference's component source in its clone under `~/.deslop/repos` and take numeric targets (padding, gap, icon box, popup size) with its `path:line`; never guess from screenshots.
- Finish a design pass with light and dark screenshots next to the reference.
