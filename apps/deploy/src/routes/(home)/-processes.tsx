import {Array, Boolean, HashSet, String} from 'effect'

import {Box, ChevronRight, Database, SquareTerminal} from 'lucide-react'
import {useState} from 'react'

import type {InventoryItem} from '#services/inventory/schema.ts'

export function ApplicationIcon(props: {name: string}) {
	const [failed, setFailed] = useState(false)
	const app = String.split(props.name, ' ')[0] ?? ''
	return (
		<span className="bg-icon-tile text-icon-shadow flex size-5 shrink-0 items-center justify-center rounded-sm">
			{Boolean.match(
				!failed &&
					Array.contains(['deploy', 'auth', 'gateway', 'scope', 'stash', 'trips', 'opm', 'portfolio', 'signal'], app),
				{
					onFalse: () => {
						if (String.includes('postgres')(app) || String.includes('redis')(app)) {
							return <Database className="size-3.5" />
						}
						if (String.includes('docker')(app)) return <Box className="size-3.5" />
						return <SquareTerminal className="size-3.5" />
					},
					onTrue: () => (
						<img
							src={Boolean.match(app === 'deploy', {
								onFalse: () => `https://${app}.mp281x.xyz/icon`,
								onTrue: () => '/icon'
							})}
							alt=""
							className="pixelated size-full rounded-sm"
							onError={() => setFailed(true)}
						/>
					)
				}
			)}
		</span>
	)
}

function ProcessRow(props: {row: NonNullable<InventoryItem['processes']>[number]; expanded?: boolean}) {
	return (
		<div className="flex min-w-48 items-center gap-2 py-1.5">
			<ChevronRight
				className={`text-muted-foreground size-3 shrink-0 ${Boolean.match(props.expanded === undefined, {onFalse: () => Boolean.match(props.expanded === true, {onFalse: () => '', onTrue: () => 'rotate-90'}), onTrue: () => 'invisible'})}`}
			/>
			<span className="min-w-0 flex-1">
				<span className="block truncate" title={props.row.name}>
					{String.replace(/-MainThread$|\.native$/u, '')(props.row.name)}
				</span>
				<span
					className="text-muted-foreground block font-mono text-xs"
					aria-label={`PID ${props.row.pid}, parent ${props.row.parent}`}
				>
					{props.row.pid} ← {props.row.parent}
				</span>
			</span>
			<span className="text-muted-foreground shrink-0 font-mono tabular-nums">
				{new Intl.NumberFormat(undefined, {maximumFractionDigits: 1}).format(props.row.memory / 1024 ** 2)} MiB
			</span>
		</div>
	)
}

function Branch(props: {
	row: NonNullable<InventoryItem['processes']>[number]
	descendants: Record<string, NonNullable<InventoryItem['processes']>>
}) {
	const [open, setOpen] = useState(false)
	const children = props.descendants[props.row.pid] ?? []
	if (Array.isReadonlyArrayEmpty(children)) {
		return (
			<li>
				<ProcessRow row={props.row} />
			</li>
		)
	}
	return (
		<li>
			<details onToggle={event => setOpen(event.currentTarget.open)}>
				<summary className="cursor-pointer list-none [&::-webkit-details-marker]:hidden">
					<ProcessRow row={props.row} expanded={open} />
				</summary>
				{open && (
					<ul className="ml-1.5 border-l pl-3">
						{Array.map(children, row => (
							<Branch key={row.pid} row={row} descendants={props.descendants} />
						))}
					</ul>
				)}
			</details>
		</li>
	)
}

function Tree(props: {rows: NonNullable<InventoryItem['processes']>}) {
	const pids = HashSet.fromIterable(Array.map(props.rows, row => row.pid))
	const children = Array.groupBy(props.rows, row => `${row.parent}`)
	return (
		<ul>
			{Array.map(
				Array.filter(props.rows, row => !HashSet.has(pids, row.parent)),
				row => (
					<Branch key={row.pid} row={row} descendants={children} />
				)
			)}
		</ul>
	)
}

export function Processes(props: {rows: NonNullable<InventoryItem['processes']>}) {
	const [open, setOpen] = useState(false)
	if (Array.isReadonlyArrayEmpty(props.rows)) return null
	return (
		<details className="min-w-0 overflow-x-auto text-xs" onToggle={event => setOpen(event.currentTarget.open)}>
			<summary className="text-muted-foreground cursor-pointer py-1">Processes</summary>
			{open && <Tree rows={props.rows} />}
		</details>
	)
}
