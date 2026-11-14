import {Array, Boolean, Function} from 'effect'

import type {KeyboardEvent, MouseEvent, ReactNode} from 'react'

import {Skeleton} from '#components/ui/skeleton.tsx'
import {Table, TableBody, TableCell, TableRow} from '#components/ui/table.tsx'

// A list row's first cell, taking the width its figures leave: the mark, the name, its markers and a muted detail on one line, cut short rather than widening the table; the detail gives way before the name.
export function RowLead(props: {
	after?: ReactNode
	children: ReactNode
	detail?: ReactNode
	mark?: ReactNode
	title?: string
}) {
	return (
		<TableCell className="w-full">
			<span className="flex w-0 min-w-full items-center gap-2" title={props.title}>
				{props.mark}
				<span className="truncate">{props.children}</span>
				{props.after}
				{props.detail !== undefined && (
					<span className="text-muted-foreground grow basis-0 truncate">{props.detail}</span>
				)}
			</span>
		</TableCell>
	)
}

// The rows a list will hold while it loads, one ruled line each.
export function LoadingRows(props: {label: string; rows: number}) {
	return (
		<Table aria-busy="true" aria-label={props.label}>
			<TableBody>
				{Array.map(Array.range(1, props.rows), row => (
					<TableRow key={row}>
						<TableCell>
							<Skeleton className="h-4 w-1/3" />
						</TableCell>
					</TableRow>
				))}
			</TableBody>
		</Table>
	)
}

// A row of a table that chooses one (`role="grid"`): the whole row selects by pointer, Enter or Space, and the chosen one reads as the registry's selected row. A control inside the row acts alone.
export function ChoiceRow(props: {children: ReactNode; label: string; onSelect: () => void; selected: boolean}) {
	function select(event: MouseEvent<HTMLTableRowElement>) {
		if (event.target instanceof Element && event.target.closest('a, button') !== null) return
		props.onSelect()
	}
	function selectWithKey(event: KeyboardEvent<HTMLTableRowElement>) {
		if (event.target !== event.currentTarget || (event.key !== 'Enter' && event.key !== ' ')) return
		event.preventDefault()
		props.onSelect()
	}
	return (
		<TableRow
			tabIndex={0}
			aria-label={props.label}
			aria-selected={props.selected}
			data-state={Boolean.match(props.selected, {
				onFalse: Function.constUndefined,
				onTrue: Function.constant('selected')
			})}
			onClick={select}
			onKeyDown={selectWithKey}
		>
			{props.children}
		</TableRow>
	)
}
