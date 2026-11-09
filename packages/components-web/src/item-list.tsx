import type {ReactNode} from 'react'

// A quiet heading over a group of rows, such as the processes or the scheduled jobs: a row's height, with its 16px icon in the marks' column so its text lines up with the names.
export function ItemListHeading(props: {children: ReactNode; icon: ReactNode}) {
	return (
		<div
			role="presentation"
			className="list-row text-muted-foreground flex h-8 items-center gap-3 px-4 text-xs max-sm:h-11 [&_svg]:size-4 [&_svg]:shrink-0"
		>
			{props.icon}
			{props.children}
		</div>
	)
}
