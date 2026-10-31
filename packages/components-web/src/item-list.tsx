import {Array} from 'effect'

import {Fragment} from 'react'
import type {ReactElement} from 'react'

import {ItemGroup, ItemSeparator} from '#components/ui/item.tsx'

// DESIGN.md's rows: Items with a hairline between each and no gap, as shadcn's ItemGroup and ItemSeparator compose them.
export function ItemList(props: {children: ReactElement[]; label: string}) {
	return (
		<ItemGroup aria-label={props.label} className="gap-0">
			{Array.map(props.children, (child, index) => (
				<Fragment key={child.key ?? index}>
					{index > 0 && <ItemSeparator className="my-0" />}
					{child}
				</Fragment>
			))}
		</ItemGroup>
	)
}
