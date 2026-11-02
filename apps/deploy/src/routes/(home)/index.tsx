import {useAtom, useAtomSuspense} from '@effect/atom-react'

import {Array, Boolean, Match, Number, Option, Order, String, pipe} from 'effect'

import {createFileRoute, useSearch} from '@tanstack/react-router'
import {AsyncResult} from 'effect/reactivity'
import {ChevronRight, Globe, Network, X} from 'lucide-react'
import {useState} from 'react'
import type {ReactNode} from 'react'

import {useCommandQuery} from '@deslop/components-web/app-bar'
import {ResultError} from '@deslop/components-web/result-error'
import {StatusDot} from '@deslop/components-web/status-dot'
import {Alert, AlertDescription, AlertTitle} from '@deslop/components-web/ui/alert'
import {Badge} from '@deslop/components-web/ui/badge'
import {Button} from '@deslop/components-web/ui/button'
import {Collapsible, CollapsibleContent, CollapsibleTrigger} from '@deslop/components-web/ui/collapsible'
import {Empty, EmptyHeader, EmptyTitle} from '@deslop/components-web/ui/empty'

import {MachineIcon} from '#lib/components.tsx'
import {hideAtom, inventoryAtom} from '#lib/utils.ts'
import {PageError} from '#routes/(home)/-error.tsx'
import {ApplicationIcon} from '#routes/(home)/-marks.tsx'
import {processTree, processUsage} from '#routes/(home)/-process-tree.ts'
import {ProcessUsage, Processes} from '#routes/(home)/-processes.tsx'
import {workloadName, workloads} from '#services/inventory/lib/utils.ts'
import type {InventoryItem} from '#services/inventory/schema.ts'

function status(item: InventoryItem) {
	if (String.startsWith('stale')(item.state)) return 'stale'
	if (String.includes('unhealthy')(item.detail)) return 'unhealthy'
	if (item.kind === 'port') return 'listening'
	if (item.kind === 'exposure' && item.owned === true) return 'configured'
	if (item.kind === 'exposure' && item.publicAccess === true) return 'public permission'
	return String.replace(/^active · /u, '')(String.toLowerCase(item.state))
}

function dot(item: InventoryItem, state: string) {
	if (Option.isSome(String.match(/failed|unhealthy|Exited \([1-9]/u)(item.state + item.detail))) return 'error'
	if (state === 'stale' || state === 'public permission' || state === 'restarting') return 'warning'
	if (Option.isSome(String.match(/running|online|listening/u)(state))) return 'live'
	return 'quiet'
}

function ExposureLink(props: {item: InventoryItem}) {
	const [result, hide] = useAtom(
		hideAtom(
			Boolean.match(String.startsWith('remote:')(props.item.id), {onFalse: () => '', onTrue: () => props.item.worker})
		)(props.item.name)
	)
	return (
		<div className="min-w-0">
			<div className="flex items-center gap-1">
				<Badge
					variant="outline"
					className="max-w-full font-mono"
					render={
						<a
							href={props.item.url}
							aria-label={props.item.url}
							target="_blank"
							rel="noreferrer"
							title={props.item.url}
						/>
					}
				>
					{Boolean.match(props.item.publicAccess === true, {
						onFalse: () => <Network className="size-3 shrink-0" aria-label="Tailnet" />,
						onTrue: () => <Globe className="size-3 shrink-0" aria-label="Public" />
					})}
					<span className="truncate">
						{Boolean.match(props.item.publicAccess === true, {
							onFalse: () => `:${props.item.port}`,
							onTrue: () => String.replace(/^https:\/\//u, '')(props.item.url)
						})}
					</span>
				</Badge>
				{props.item.owned === true && (
					<Button
						size="icon-sm"
						variant="ghost"
						disabled={AsyncResult.isWaiting(result)}
						aria-label={`Remove ${props.item.name} exposure`}
						onClick={() => hide()}
					>
						<X />
					</Button>
				)}
			</div>
			<ResultError result={result} />
		</div>
	)
}

const untilNext = new Intl.RelativeTimeFormat('en', {numeric: 'auto', style: 'narrow'})

// When a timer next starts the job, against the snapshot's clock: minutes within the hour, then hours.
function nextRun(next: number, now: number) {
	const minutes = Number.max(0, Number.round((next - now) / 60_000, 0))
	if (minutes < 60) return untilNext.format(minutes, 'minute')
	return untilNext.format(Number.round(minutes / 60, 0), 'hour')
}

function WorkloadRow(props: {
	row: ReturnType<typeof workloads>[number]
	now: number
	showMachine: boolean
	toggle?: ReactNode
}) {
	const state = status(props.row.item)
	const processes = props.row.item.processes ?? []
	return (
		<div className="deploy-process-grid min-w-0 gap-y-1" data-show-machine={props.showMachine}>
			<ApplicationIcon
				name={workloadName(props.row.item)}
				process={processTree(processes)[0]?.name}
				container={props.row.item.kind === 'container'}
			/>
			<span className="min-w-0 truncate text-sm font-medium" title={props.row.item.name}>
				{workloadName(props.row.item)}
			</span>
			<ProcessUsage {...processUsage(processes)} />
			{props.showMachine && <MachineIcon worker={props.row.item.worker} />}
			<span title={state} aria-label={state} role="img" className="flex items-center justify-center">
				<StatusDot status={dot(props.row.item, state)} />
			</span>
			{props.toggle ?? <span />}
			<div className="col-start-2 col-end-5 flex min-w-0 flex-wrap items-center gap-1 empty:hidden">
				{Array.map(
					Array.dedupe(
						Array.map(
							Array.filter(
								props.row.listeners,
								listener =>
									listener.address !== 'container' &&
									!Array.some(props.row.exposures, exposure => exposure.port === listener.port)
							),
							listener => listener.port
						)
					),
					port => (
						<Badge key={port} variant="secondary" className="font-mono">
							:{port}
						</Badge>
					)
				)}
				{Array.map(props.row.exposures, exposure => (
					<ExposureLink key={exposure.id} item={exposure} />
				))}
				{props.row.item.next !== undefined && (
					<span className="text-muted-foreground text-xs tabular-nums">
						next {nextRun(props.row.item.next, props.now)}
					</span>
				)}
			</div>
			{(state === 'stale' ||
				state === 'unhealthy' ||
				String.includes('failed')(state) ||
				String.includes('exited')(state)) && (
				<p
					className={`col-start-2 col-end-5 text-xs wrap-anywhere ${Boolean.match(dot(props.row.item, state) === 'error', {onFalse: () => Boolean.match(dot(props.row.item, state) === 'warning', {onFalse: () => 'text-muted-foreground', onTrue: () => 'text-warning'}), onTrue: () => 'text-destructive'})}`}
				>
					{props.row.item.detail}
				</p>
			)}
		</div>
	)
}

function InventoryRow(props: {
	row: ReturnType<typeof workloads>[number]
	now: number
	showMachine: boolean
	processMatch: boolean
}) {
	const [open, setOpen] = useState(false)
	const processes = processTree(props.row.item.processes ?? [])
	if (processes.length < 2 && !props.processMatch) {
		return (
			<div role="listitem" className="border-b py-2.5">
				<WorkloadRow row={props.row} now={props.now} showMachine={props.showMachine} />
			</div>
		)
	}
	return (
		<Collapsible role="listitem" className="border-b py-2.5" open={open || props.processMatch} onOpenChange={setOpen}>
			{/* Only the chevron toggles, so the row's endpoint links and their remove buttons stay their own controls. */}
			<WorkloadRow
				row={props.row}
				now={props.now}
				showMachine={props.showMachine}
				toggle={
					<CollapsibleTrigger
						aria-label={`Processes of ${workloadName(props.row.item)}`}
						className="text-muted-foreground flex cursor-pointer items-center justify-center"
					>
						<ChevronRight
							className={`size-3 ${Boolean.match(open || props.processMatch, {onFalse: () => '', onTrue: () => 'rotate-90'})}`}
						/>
					</CollapsibleTrigger>
				}
			/>
			<CollapsibleContent>
				<Processes rows={processes} showMachine={props.showMachine} />
			</CollapsibleContent>
		</Collapsible>
	)
}

// An app in trouble leads: failed first, then one that needs a look, then the rest in their usual order.
const urgency = Order.mapInput(Order.Number, (row: ReturnType<typeof workloads>[number]) =>
	pipe(
		Match.value(dot(row.item, status(row.item))),
		Match.when('error', () => 0),
		Match.when('warning', () => 1),
		Match.orElse(() => 2)
	)
)

function Services() {
	const result = useAtomSuspense(inventoryAtom)
	const query = useCommandQuery()
	const search = useSearch({from: '/(home)'})
	const items = Array.filter(
		result.value.items,
		item => search.machine === undefined || search.machine === 'all' || item.worker === search.machine
	)
	const rows = Array.filter(workloads(items), row =>
		String.includes(String.toLowerCase(query))(
			String.toLowerCase(
				`${row.item.worker} ${row.item.name} ${Array.join(
					Array.map(row.item.processes ?? [], process => process.name),
					' '
				)} ${Array.join(
					Array.map(row.listeners, listener => `${listener.port}`),
					' '
				)} ${Array.join(
					Array.map(row.exposures, exposure => exposure.url),
					' '
				)}`
			)
		)
	)
	const apps = Array.sort(
		Array.filter(rows, row => row.item.scheduled !== true),
		urgency
	)
	const jobs = Array.sort(
		Array.filter(rows, row => row.item.scheduled === true),
		urgency
	)
	return (
		<div className="flex min-h-0 w-full max-w-3xl flex-1 flex-col gap-4 self-center">
			{Array.map(
				Array.filter(
					result.value.sources,
					source => source.error !== '' && !Array.contains(result.value.workers ?? [], source.name)
				),
				source => (
					<Alert key={source.name} variant="destructive">
						<AlertTitle>{source.name} is unreachable</AlertTitle>
						<AlertDescription className="wrap-anywhere">{source.error}</AlertDescription>
					</Alert>
				)
			)}
			<div className="pb-safe min-h-0 flex-1 overflow-y-auto pr-3">
				{Array.map(
					[
						{label: 'Apps', rows: apps},
						// What a timer starts, such as an updater, after the apps it serves.
						{label: 'Scheduled', rows: jobs}
					],
					group =>
						!Array.isArrayEmpty(group.rows) && (
							<section key={group.label} aria-label={group.label} className="not-first:mt-6">
								{group.label === 'Scheduled' && <h2 className="text-muted-foreground mb-1 text-xs">Scheduled</h2>}
								<div role="list">
									{Array.map(group.rows, row => (
										<InventoryRow
											key={`${row.item.id}:${query !== ''}`}
											row={row}
											now={result.value.time}
											showMachine={search.machine === undefined || search.machine === 'all'}
											processMatch={
												query !== '' &&
												!String.includes(String.toLowerCase(query))(
													String.toLowerCase(
														`${row.item.worker} ${row.item.name} ${Array.join(
															Array.map(row.listeners, listener => `${listener.port}`),
															' '
														)} ${Array.join(
															Array.map(row.exposures, exposure => exposure.url),
															' '
														)}`
													)
												)
											}
										/>
									))}
								</div>
							</section>
						)
				)}
				{Array.isArrayEmpty(rows) && (
					<Empty>
						<EmptyHeader>
							<EmptyTitle>No app matches</EmptyTitle>
						</EmptyHeader>
					</Empty>
				)}
			</div>
		</div>
	)
}

export const Route = createFileRoute('/(home)/')({component: Services, errorComponent: PageError})
