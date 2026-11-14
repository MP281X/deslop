import {useAtom, useAtomSet, useAtomValue} from '@effect/atom-react'

import type {DateTime} from 'effect'
import {Array, Boolean, Duration, Equal, Filter, Function, HashSet, Number, Option, Order, Stream, pipe} from 'effect'

import {AppWindowIcon, PlayIcon} from '@phosphor-icons/react'
import {CatchBoundary} from '@tanstack/react-router'
import {AsyncResult, Atom} from 'effect/reactivity'
import {Fragment, Suspense} from 'react'
import type {ReactNode} from 'react'

import {cn} from '@deslop/components-web/classes'
import {EmptyState, Loaded, ReadFailure} from '@deslop/components-web/fallbacks'
import {RowsSkeleton} from '@deslop/components-web/item-list'
import {ResultError} from '@deslop/components-web/result-error'
import {StatusDot} from '@deslop/components-web/status-dot'
import {Badge} from '@deslop/components-web/ui/badge'
import {Button} from '@deslop/components-web/ui/button'
import {
	Item,
	ItemContent,
	ItemDescription,
	ItemGroup,
	ItemMedia,
	ItemSeparator,
	ItemTitle
} from '@deslop/components-web/ui/item'
import {ScrollArea} from '@deslop/components-web/ui/scroll-area'
import {timerOf} from '@deslop/runtime/shared/format'

import {inventoryAtom, openExposeAtom, runAtom} from '#lib/fleet.ts'
import {ApplicationIcon} from '#routes/(home)/-marks.tsx'
import {host, impactGroups, middleEllipsis} from '#routes/(home)/-rows.ts'
import {
	failureAge,
	nextRun,
	reasonLine,
	reasonOf,
	requestOf,
	type Row,
	status,
	workloadName
} from '#services/inventory/lib/utils.ts'
import type {InventoryItem, ItemId, Process} from '#services/inventory/schema.ts'
import type {MachineHistory} from '#services/metrics/schema.ts'

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

// Every port is one chip: exposed and outlined, opening its endpoint; exposable and filled, opening the Expose dialog; the rest plain and inert.
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
								variant="secondary"
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

function Elapsed(props: {job: ItemId}) {
	return (
		<span className="text-muted-foreground text-xs tabular-nums">
			{timerOf(AsyncResult.getOrElse(useAtomValue(elapsedAtom(props.job)), () => Duration.zero))}
		</span>
	)
}

// A timer's job, started now at its row's end; it waits, disabled, while the job runs.
function RunNow(props: {disabled: boolean; item: InventoryItem; onRun: () => void}) {
	return (
		<Button
			size="icon-sm"
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
			nextRun(
				Option.getOrElse(props.row.item.next, () => props.now),
				props.now
			),
		onTrue: Function.constant('')
	})
	const reasonText = Boolean.match(scheduled, {
		onFalse: () => reasonLine(props.row.item, props.now),
		onTrue: () => reason
	})
	// The row opens its processes; its chips and run button sit beside it, outside the row's own button.
	return (
		<div role="listitem">
			<div className="flex items-center gap-2 pr-3">
				<Item
					size="sm"
					variant={Boolean.match(props.selected, {
						onFalse: Function.constant('default' as const),
						onTrue: Function.constant('muted' as const)
					})}
					className="min-w-0 flex-1"
					render={<button type="button" aria-label={`Open ${fullName}`} title={fullName} onClick={props.onSelect} />}
				>
					<ItemMedia variant="icon">
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
					</ItemMedia>
					<ItemContent>
						<ItemTitle>{name}</ItemTitle>
						{failing && <ItemDescription title={reasonText}>{reasonText}</ItemDescription>}
					</ItemContent>
				</Item>
				{props.row.item.health !== 'quiet' && <StatusDot status={props.row.item.health} label={state} />}
				{Boolean.match(scheduled, {
					onFalse: () => <Endpoints free={props.free} row={props.row} />,
					onTrue: () =>
						Boolean.match(running, {
							onFalse: () => (
								<span className="text-muted-foreground text-xs tabular-nums">
									{Boolean.match(failing, {onFalse: () => next, onTrue: () => Option.getOrElse(age, () => next)})}
								</span>
							),
							onTrue: () => <Elapsed job={props.row.item.id} />
						})
				})}
				{/* An endpoint this app exposed is hidden through Deploy's hide_exposure tool, not this page. */}
				{scheduled && <RunNow disabled={running} item={props.row.item} onRun={() => run(requestOf(props.row.item))} />}
			</div>
			{scheduled && <RunFailure item={props.row.item} />}
		</div>
	)
}

function ListRows(props: {
	compact: boolean
	free: readonly InventoryItem[]
	now: DateTime.Utc
	onSelect: (row: Row) => void
	rows: readonly Row[]
	selectedId?: string
}) {
	return (
		<ItemGroup>
			{Array.map(props.rows, row => (
				<AppRow
					key={row.item.id}
					compact={props.compact}
					free={props.free}
					now={props.now}
					onSelect={() => props.onSelect(row)}
					row={row}
					selected={props.selectedId === row.item.id}
				/>
			))}
		</ItemGroup>
	)
}

// The apps on one machine: failures first, then high-impact apps by memory, then healthy low-impact apps under their heading, then the jobs a timer starts.
export function ListPane(props: {
	className?: string
	compact: boolean
	free: readonly InventoryItem[]
	history?: MachineHistory
	now: DateTime.Utc
	onSelect: (row: Row) => void
	rows: readonly Row[]
	selectedId?: string
}) {
	const [jobs, apps] = Array.partition(
		props.rows,
		Filter.fromPredicate(row => Option.contains(row.item.scheduled, true))
	)
	const groups = impactGroups(apps, props.history)
	return (
		<div className={cn('flex min-h-0 flex-col', props.className)}>
			<Suspense fallback={<RowsSkeleton label="Apps loading" rows={8} />}>
				<InventoryContent>
					{Array.match(props.rows, {
						onEmpty: () => <EmptyState icon={<AppWindowIcon weight="light" />} label="No apps in this range" />,
						onNonEmpty: () => (
							<ScrollArea className="min-h-0 flex-1">
								{pipe(
									[
										{name: 'high', rows: groups.high},
										{name: 'low', rows: groups.low},
										{name: 'jobs', rows: jobs}
									],
									Array.filter(group => Array.isReadonlyArrayNonEmpty(group.rows)),
									Array.map((group, index) => (
										<Fragment key={group.name}>
											{index > 0 && <ItemSeparator />}
											<ListRows
												compact={props.compact}
												free={props.free}
												now={props.now}
												onSelect={props.onSelect}
												rows={group.rows}
												selectedId={props.selectedId}
											/>
										</Fragment>
									))
								)}
							</ScrollArea>
						)
					})}
				</InventoryContent>
			</Suspense>
		</div>
	)
}
