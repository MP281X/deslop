import {Array, Boolean, Function, Option} from 'effect'

import type {KeyboardEvent, MouseEvent, ReactNode} from 'react'

import {Skeleton} from '#components/ui/skeleton.tsx'
import {Table, TableBody, TableCell, TableRow} from '#components/ui/table.tsx'
import {cn} from '#lib/utils.ts'

// Every row's mark sits in one 24px square, a picture filling it and a 16px glyph centred, so names start at one column; a `label` names what it shows.
export function RowMark(props: {children: ReactNode; label?: string}) {
	return (
		<span
			role={Option.match(Option.fromUndefinedOr(props.label), {
				onNone: Function.constUndefined,
				onSome: Function.constant('img')
			})}
			aria-label={props.label}
			title={props.label}
			className="flex size-6 shrink-0 items-center justify-center"
		>
			{props.children}
		</span>
	)
}

// A list row's first cell, taking the width its figures leave: the mark, the name, its markers and a muted detail on one line, cut short rather than widening the table; the detail gives way before the name. The line is a mark's height with or without one; `depth` indents a tree's row by 12px a level. A `reason` says why the row needs a look where touch has no hover to show it: on touch it takes the detail's place as a second line, in full under the name.
export function RowLead(props: {
	after?: ReactNode
	children: ReactNode
	depth?: number
	detail?: ReactNode
	mark?: ReactNode
	markLabel?: string
	reason?: ReactNode
	title?: string
}) {
	return (
		<TableCell className="w-full">
			<span
				className="flex h-6 w-0 min-w-full items-center gap-2 ps-(--indent)"
				style={{'--indent': `${(props.depth ?? 0) * 0.75}rem`}}
				title={props.title}
			>
				{props.mark !== undefined && (
					<RowMark
						{...Option.match(Option.fromUndefinedOr(props.markLabel), {onNone: () => ({}), onSome: label => ({label})})}
					>
						{props.mark}
					</RowMark>
				)}
				<span className="truncate">{props.children}</span>
				{props.after}
				{props.detail !== undefined && (
					<span
						className={cn(
							'text-muted-foreground in-data-[state=selected]:text-foreground grow basis-0 truncate',
							props.reason !== undefined && 'pointer-coarse:hidden'
						)}
					>
						{props.detail}
					</span>
				)}
			</span>
			{props.reason !== undefined && (
				<span
					className="text-muted-foreground in-data-[state=selected]:text-foreground hidden w-0 min-w-full ps-(--indent) whitespace-normal pointer-coarse:block"
					style={{
						'--indent': `${(props.depth ?? 0) * 0.75 + Boolean.match(props.mark !== undefined, {onFalse: Function.constant(0), onTrue: Function.constant(2)})}rem`
					}}
				>
					{props.reason}
				</span>
			)}
		</TableCell>
	)
}

// One row while its list loads, in a real row's shape and height: the mark's square, then the name.
export function LoadingRow(props: {columns?: number; label: string}) {
	return (
		<TableRow aria-busy="true" aria-label={props.label}>
			<TableCell colSpan={props.columns}>
				<span className="flex w-full items-center gap-2">
					<Skeleton className="size-6" />
					<Skeleton className="h-4 w-1/3" />
				</span>
			</TableCell>
		</TableRow>
	)
}

// The rows a list will hold while it loads.
export function LoadingRows(props: {label: string; rows: number}) {
	return (
		<Table aria-busy="true" aria-label={props.label}>
			<TableBody>
				{Array.map(Array.range(1, props.rows), row => (
					<LoadingRow key={row} label={props.label} />
				))}
			</TableBody>
		</Table>
	)
}

// A row of a plain table that chooses one: the whole row selects by pointer, Enter or Space, and is one Tab stop. The chosen one reads as the registry's selected row and, to assistive technology, as the current one; `aria-selected` belongs to a grid, whose arrow-key contract these tables do not offer. A row that waits for an answer is an ordinary row whose action says so. A control inside the row acts alone.
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
			aria-current={Boolean.match(props.selected, {
				onFalse: Function.constUndefined,
				onTrue: Function.constant('true')
			})}
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
