import {useAtom, useAtomSet, useAtomValue} from '@effect/atom-react'

import type {DateTime} from 'effect'
import {Array, Boolean, Duration, Equal, Filter, Function, HashSet, Number, Option, Order, Stream, pipe} from 'effect'

import {AppWindowIcon, PlayIcon} from '@phosphor-icons/react'
import {CatchBoundary} from '@tanstack/react-router'
import {AsyncResult, Atom} from 'effect/reactivity'
import {Suspense} from 'react'
import type {ReactNode} from 'react'

import {ResultError} from '@deslop/components-web/blocks/result-error'
import {ChoiceRow, LoadingRows, RowLead} from '@deslop/components-web/blocks/rows'
import {Loaded, ReadFailure} from '@deslop/components-web/blocks/states'
import {StatusDot} from '@deslop/components-web/blocks/status-dot'
import {cn} from '@deslop/components-web/lib/utils'
import {Badge} from '@deslop/components-web/ui/badge'
import {Button} from '@deslop/components-web/ui/button'
import {Empty, EmptyHeader, EmptyMedia, EmptyTitle} from '@deslop/components-web/ui/empty'
import {ScrollArea} from '@deslop/components-web/ui/scroll-area'
import {Table, TableBody, TableCell} from '@deslop/components-web/ui/table'
import {dueOf, timerOf} from '@deslop/runtime/shared/format'

import {inventoryAtom, openExposeAtom, runAtom} from '#lib/fleet.ts'
import {ApplicationIcon} from '#routes/(home)/-marks.tsx'
import {host, impactGroups, middleEllipsis} from '#routes/(home)/-rows.ts'
import {
	failureAge,
	reasonLine,
	reasonOf,
	requestOf,
	type Row,
	status,
	workloadName
} from '#services/inventory/lib/utils.ts'
import type {AppId, InventoryItem, ItemId, Process} from '#services/inventory/schema.ts'

export function InventoryContent(props: {children: ReactNode}) {
	return (
		<Loaded atom={inventoryAtom}>
			{() => (
				<CatchBoundary getResetKey={Function.constant('inventory')} errorComponent={ReadFailure}>
					{props.children}
				</CatchBoundary>
			)}
		</Loaded>
	)
}

// Every port is one chip: an outlined link opens an exposed endpoint, an outlined button opens the Expose dialog, and the rest are plain and inert. No chip is filled, so a selected row's tint never hides one.
function Endpoints(props: {free: readonly InventoryItem[]; row: Row}) {
	const expose = useAtomSet(openExposeAtom)
	const exposedPorts = HashSet.fromIterable(Array.getSomes(Array.map(props.row.exposures, exposure => exposure.port)))
	const freePorts = Array.groupBy(props.free, port => port.id)
	return (
		<>
			{Array.map(
				pipe(
					props.row.listeners,
					Array.filter(
						listener =>
							!Option.contains(listener.address, 'container') &&
							!Option.exists(listener.port, port => HashSet.has(exposedPorts, port))
					),
					Array.dedupeWith((first: InventoryItem, second: InventoryItem) => Equal.equals(first.port, second.port))
				),
				listener =>
					Option.match(Array.head(freePorts[listener.id] ?? []), {
						onNone: () => (
							<Badge key={listener.id} variant="ghost">
								{Option.getOrUndefined(listener.port)}
							</Badge>
						),
						onSome: port => (
							<Badge
								key={listener.id}
								variant="outline"
								render={
									<button
										type="button"
										aria-label={`Expose ${workloadName(props.row.item)} :${Option.getOrUndefined(listener.port)}`}
										onClick={() => expose(port)}
									/>
								}
							>
								{Option.getOrUndefined(listener.port)}
							</Badge>
						)
					})
			)}
			{Array.map(props.row.exposures, exposure => (
				<Badge
					key={exposure.id}
					variant="outline"
					render={
						<a
							href={Option.getOrUndefined(exposure.url)}
							target="_blank"
							rel="noreferrer"
							title={Option.getOrUndefined(exposure.url)}
							aria-label={`Open ${Option.getOrUndefined(exposure.url)}`}
						/>
					}
				>
					{Option.match(exposure.port, {
						onNone: () => Option.match(exposure.url, {onNone: Function.constant(''), onSome: host}),
						onSome: port => `${port}`
					})}
				</Badge>
			))}
		</>
	)
}

// A running job's time: it starts counting when its row shows it, once a second, in the column that shows the next start.
const elapsedAtom = Atom.family((_job: ItemId) =>
	Atom.make(Stream.map(Stream.zipWithIndex(Stream.tick(Duration.seconds(1))), tick => Duration.seconds(tick[1])))
)

// judge-ignore no-silent-fallback -- the infallible tick stream starts at zero; before its first value no elapsed second has passed.
function Elapsed(props: {job: ItemId}) {
	return (
		<span className="text-muted-foreground tabular-nums">
			{timerOf(AsyncResult.getOrElse(useAtomValue(elapsedAtom(props.job)), () => Duration.zero))}
		</span>
	)
}

// A timer's job, started now at its row's end; it waits, disabled, while the job runs.
function RunNow(props: {disabled: boolean; item: InventoryItem; onRun: () => void}) {
	return (
		<Button
			size="icon-xs"
			variant="ghost"
			disabled={props.disabled}
			aria-label={`Run ${workloadName(props.item)} now`}
			onClick={props.onRun}
		>
			<PlayIcon />
		</Button>
	)
}

function RunFailure(props: {item: InventoryItem}) {
	return <ResultError result={useAtomValue(runAtom(props.item.id))} />
}

// One app or job: its mark, name, ports or reason, and the actions it has at the row's end; the whole row opens its processes.
function AppRow(props: {
	compact: boolean
	free: readonly InventoryItem[]
	now: DateTime.Utc
	onSelect: () => void
	row: Row
	selected: boolean
}) {
	const [runResult, run] = useAtom(runAtom(props.row.item.id))
	const state = status(props.row.item)
	const scheduled = Option.contains(props.row.item.scheduled, true)
	const reason = reasonOf(props.row.item)
	const age = failureAge(props.row.item, props.now)
	const running = props.row.item.running || AsyncResult.isWaiting(runResult)
	const fullName = workloadName(props.row.item)
	const name = Boolean.match(props.compact, {onFalse: () => fullName, onTrue: () => middleEllipsis(fullName)})
	const failing = props.row.item.health !== 'quiet'
	const next = Boolean.match(running, {
		onFalse: () =>
			dueOf(
				Option.getOrElse(props.row.item.next, () => props.now),
				props.now
			),
		onTrue: Function.constant('')
	})
	const reasonText = Boolean.match(scheduled, {
		onFalse: () => reasonLine(props.row.item, props.now),
		onTrue: () => reason
	})
	// The row opens its processes; its chips and run button act alone.
	return (
		<ChoiceRow label={`Open ${fullName}`} selected={props.selected} onSelect={props.onSelect}>
			<RowLead
				title={fullName}
				mark={
					<ApplicationIcon
						name={fullName}
						process={pipe(
							props.row.item.processes,
							Option.getOrElse(Array.empty<Process>),
							Array.match({
								onEmpty: Function.constUndefined,
								onNonEmpty: entries =>
									Array.max(
										entries,
										Order.mapInput(Number.Order, (entry: Process) => entry.memory)
									).name
							})
						)}
						container={props.row.item.kind === 'container'}
					/>
				}
				after={
					<>
						{props.row.item.health !== 'quiet' && <StatusDot status={props.row.item.health} label={state} />}
						{scheduled && <RunFailure item={props.row.item} />}
					</>
				}
				detail={Boolean.match(failing, {onFalse: Function.constUndefined, onTrue: () => reasonText})}
			>
				{name}
			</RowLead>
			<TableCell className="text-right">
				{Boolean.match(scheduled, {
					onFalse: () => (
						<span className="inline-flex gap-1">
							<Endpoints free={props.free} row={props.row} />
						</span>
					),
					onTrue: () =>
						Boolean.match(running, {
							onFalse: () => (
								<span className="text-muted-foreground tabular-nums">
									{Boolean.match(failing, {onFalse: () => next, onTrue: () => Option.getOrElse(age, () => next)})}
								</span>
							),
							onTrue: () => <Elapsed job={props.row.item.id} />
						})
				})}
			</TableCell>
			{/* An endpoint this app exposed is hidden through Deploy's hide_exposure tool, not this page. */}
			<TableCell>
				{scheduled && <RunNow disabled={running} item={props.row.item} onRun={() => run(requestOf(props.row.item))} />}
			</TableCell>
		</ChoiceRow>
	)
}

function ListRows(props: {
	compact: boolean
	free: readonly InventoryItem[]
	now: DateTime.Utc
	onSelect: (row: Row) => void
	rows: readonly Row[]
	selectedId?: string | undefined
}) {
	return Array.map(props.rows, row => (
		<AppRow
			key={row.item.id}
			compact={props.compact}
			free={props.free}
			now={props.now}
			onSelect={() => props.onSelect(row)}
			row={row}
			selected={props.selectedId === row.item.id}
		/>
	))
}

// The apps on one machine: failures first, then high-impact apps by memory, then healthy low-impact apps under their heading, then the jobs a timer starts.
export function ListPane(props: {
	className?: string
	compact: boolean
	free: readonly InventoryItem[]
	lowImpact?: HashSet.HashSet<AppId> | undefined
	now: DateTime.Utc
	onSelect: (row: Row) => void
	rows: readonly Row[]
	selectedId?: string | undefined
}) {
	const [jobs, apps] = Array.partition(
		props.rows,
		Filter.fromPredicate(row => Option.contains(row.item.scheduled, true))
	)
	const groups = impactGroups(apps, props.lowImpact)
	return (
		<div className={cn('flex min-h-0 flex-col', props.className)}>
			<Suspense fallback={<LoadingRows label="Apps loading" rows={8} />}>
				<InventoryContent>
					{Array.match(props.rows, {
						onEmpty: () => (
							<Empty role="status">
								<EmptyHeader>
									<EmptyMedia variant="icon">
										<AppWindowIcon />
									</EmptyMedia>
									<EmptyTitle>No apps</EmptyTitle>
								</EmptyHeader>
							</Empty>
						),
						onNonEmpty: () => (
							<ScrollArea className="min-h-0 flex-1">
								<Table role="grid" aria-label="Apps">
									<TableBody>
										<ListRows
											compact={props.compact}
											free={props.free}
											now={props.now}
											onSelect={props.onSelect}
											rows={[...groups.high, ...groups.low, ...jobs]}
											selectedId={props.selectedId}
										/>
									</TableBody>
								</Table>
							</ScrollArea>
						)
					})}
				</InventoryContent>
			</Suspense>
		</div>
	)
}
