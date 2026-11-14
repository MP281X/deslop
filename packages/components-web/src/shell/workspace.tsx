import type {ReactNode} from 'react'

// A split-pane app's page: its panes take the whole width under the bar, edge to edge. Anything in a pane that is not a table (a chart, an axis) keeps the table cells' 8px gutter, so it starts at the rows' column.
export function Workspace(props: {children: ReactNode}) {
	return (
		// Positioned, so a row's screen-reader text stays beside it in this scroller.
		<main className="pb-safe-bottom relative flex min-h-0 flex-1 flex-col overflow-hidden">{props.children}</main>
	)
}
