import {Array, Boolean} from 'effect'

import {useState} from 'react'

import {Button} from '@deslop/components-web/ui/button'

import {ApplicationIcon} from '#routes/(home)/-marks.tsx'
import type {processTree} from '#routes/(home)/-process-tree.ts'
import {processUsage} from '#routes/(home)/-process-tree.ts'

export function ProcessUsage(props: {cpu?: number; memory?: number}) {
	const mib = (props.memory ?? 0) / 1024 ** 2
	return (
		<>
			<span
				className="text-muted-foreground text-right font-mono text-xs whitespace-nowrap tabular-nums"
				title="CPU · share of machine capacity"
			>
				{Boolean.match(props.cpu === undefined, {
					onFalse: () =>
						`${new Intl.NumberFormat(undefined, {maximumFractionDigits: Boolean.match((props.cpu ?? 0) < 10, {onFalse: () => 0, onTrue: () => 1})}).format(props.cpu ?? 0)}%`,
					onTrue: () => ''
				})}
			</span>
			<span
				className="text-muted-foreground text-right font-mono text-xs whitespace-nowrap tabular-nums"
				title="Resident memory"
			>
				{Boolean.match(props.memory === undefined, {
					onFalse: () =>
						`${new Intl.NumberFormat(undefined, {maximumFractionDigits: Boolean.match(mib >= 1000 || mib < 10, {onFalse: () => 0, onTrue: () => 1})}).format(Boolean.match(mib >= 1000, {onFalse: () => mib, onTrue: () => mib / 1024}))} ${Boolean.match(mib >= 1000, {onFalse: () => 'MiB', onTrue: () => 'GiB'})}`,
					onTrue: () => ''
				})}
			</span>
		</>
	)
}

export function Processes(props: {rows: ReturnType<typeof processTree>; showMachine: boolean}) {
	const [all, setAll] = useState(false)
	return (
		<div className="pb-2">
			{Array.map(
				Boolean.match(all, {onFalse: () => Array.take(props.rows, 8), onTrue: () => props.rows}),
				(row, index) => (
					<div
						key={row.members[0]?.pid ?? index}
						className="deploy-process-grid h-7"
						data-show-machine={props.showMachine}
					>
						<span className="bg-border w-px self-stretch justify-self-center" />
						<span
							className={`flex min-w-0 items-center gap-2 ${Boolean.match(row.depth === 2, {onFalse: () => '', onTrue: () => 'pl-4'})}`}
							title={row.path}
						>
							<ApplicationIcon name={row.name} small />
							<span className="truncate text-xs">
								{row.name}
								{row.main && <span className="text-muted-foreground ml-1">main</span>}
							</span>
						</span>
						<ProcessUsage {...processUsage(row.members)} />
					</div>
				)
			)}
			{!all && props.rows.length > 8 && (
				<div className="deploy-process-grid h-7" data-show-machine={props.showMachine}>
					<span />
					<Button variant="ghost" size="sm" onClick={() => setAll(true)}>
						{props.rows.length - 8} more
					</Button>
					<ProcessUsage {...processUsage(Array.flatMap(Array.drop(props.rows, 8), row => row.members))} />
				</div>
			)}
		</div>
	)
}
