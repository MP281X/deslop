import {Array, Boolean, String} from 'effect'

import {Box, Database, SquareTerminal} from 'lucide-react'
import {useState} from 'react'

import type {InventoryItem} from '#services/inventory/schema.ts'

export function ApplicationIcon(props: {name: string}) {
	const [failed, setFailed] = useState(false)
	const app = String.split(props.name, ' ')[0] ?? ''
	if (
		!failed &&
		Array.contains(['deploy', 'auth', 'gateway', 'scope', 'stash', 'trips', 'opm', 'portfolio', 'signal'], app)
	) {
		return (
			<img
				src={Boolean.match(app === 'deploy', {onFalse: () => `https://${app}.mp281x.xyz/icon`, onTrue: () => '/icon'})}
				alt=""
				className="pixelated size-5 shrink-0 rounded-sm"
				onError={() => setFailed(true)}
			/>
		)
	}
	if (String.includes('postgres')(app) || String.includes('redis')(app)) return <Database className="size-4" />
	if (String.includes('docker')(app)) return <Box className="size-4" />
	return <SquareTerminal className="size-4" />
}

function Branch(props: {rows: NonNullable<InventoryItem['processes']>; parent: number}) {
	return (
		<ul className="ml-3 border-l pl-3">
			{Array.map(
				Array.filter(props.rows, row => row.parent === props.parent),
				row => (
					<li key={row.pid}>
						<div className="flex min-w-56 items-center gap-2 py-1 text-xs">
							<span className="flex size-5 shrink-0 items-center justify-center">
								<ApplicationIcon name={row.name} />
							</span>
							<span className="min-w-0 flex-1 wrap-anywhere">{row.name}</span>
							<span className="text-muted-foreground font-mono tabular-nums">
								{row.pid} ·{' '}
								{new Intl.NumberFormat(undefined, {maximumFractionDigits: 1}).format(row.memory / 1024 ** 2)} MiB
							</span>
						</div>
						<Branch rows={props.rows} parent={row.pid} />
					</li>
				)
			)}
		</ul>
	)
}

export function Processes(props: {rows: NonNullable<InventoryItem['processes']>}) {
	const roots = Array.map(
		Array.filter(props.rows, row => !Array.some(props.rows, candidate => candidate.pid === row.parent)),
		row => ({...row, parent: 0})
	)
	if (Array.isReadonlyArrayEmpty(roots)) return null
	return (
		<details className="min-w-0 overflow-x-auto text-xs">
			<summary className="text-muted-foreground cursor-pointer py-1">
				{props.rows.length}{' '}
				{Boolean.match(props.rows.length === 1, {onFalse: () => 'processes', onTrue: () => 'process'})}
			</summary>
			<Branch
				rows={[...roots, ...Array.filter(props.rows, row => !Array.some(roots, root => root.pid === row.pid))]}
				parent={0}
			/>
		</details>
	)
}
