import {useAtom, useAtomSet, useAtomValue} from '@effect/atom-react'

import type {DateTime} from 'effect'
import {Array, Boolean, Duration, Equal, Function, HashSet, Number, Option, Order, Stream, pipe} from 'effect'

import {AppWindowIcon, PlayIcon} from '@phosphor-icons/react'
import {CatchBoundary} from '@tanstack/react-router'
import {AsyncResult, Atom} from 'effect/reactivity'
import {Suspense} from 'react'
import type {ReactNode} from 'react'

import {cn} from '@deslop/components-web/classes'
import {EmptyState, Loaded, ReadFailure} from '@deslop/components-web/fallbacks'
import {RowsSkeleton} from '@deslop/components-web/item-list'
import {ResultError} from '@deslop/components-web/result-error'
import {StatusDot} from '@deslop/components-web/status-dot'
import {Badge} from '@deslop/components-web/ui/badge'
import {Button} from '@deslop/components-web/ui/button'
import {Item, ItemActions, ItemContent, ItemDescription, ItemMedia, ItemTitle} from '@deslop/components-web/ui/item'
import {ScrollArea} from '@deslop/components-web/ui/scroll-area'
import {Skeleton} from '@deslop/components-web/ui/skeleton'
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
				<CatchBoundary getResetKey={() => 'inventory'} errorComponent={ReadFailure}>
					{props.children}
				</CatchBoundary>
			)}
		</Loaded>
	)
}

// The list's loading rows: the real row's 16px mark at the 16px gutter, a name bar where names sit and a chip-sized box where its ports end.
function AppRowsSkeleton(props: {label: string; rows: number}) {
	return (
		<RowsSkeleton label={props.label} rows={props.rows}>
			<ItemMedia>
				<Skeleton className="size-4" />
			</ItemMedia>
			<ItemContent>
				<Skeleton className="h-3 w-2/5" />
			</ItemContent>
			<ItemActions>
				<Skeleton className="h-5 w-12" />
			</ItemActions>
		</RowsSkeleton>
	)
}

// Every port is one bordered chip whose digits end on the same edge: exposed in foreground text opening its endpoint, exposable in muted text opening the Expose dialog, the rest muted and inert.
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
							<Badge key={listener.id} variant="outline">
								<span className="text-muted-foreground">{Option.getOrUndefined(listener.port)}</span>
							</Badge>
						),
						onSome: port => (
							<span key={listener.id} className="relative z-10 flex shrink-0">
								<Badge
									variant="outline"
									render={
										<button
											type="button"
											aria-label={`Expose ${workloadName(props.row.item)} :${Option.getOrUndefined(listener.port)}`}
											onClick={() => expose(port)}
										/>
									}
								>
									<span className="text-muted-foreground">{Option.getOrUndefined(listener.port)}</span>
								</Badge>
							</span>
						)
					})
			)}
			{Array.map(props.row.exposures, exposure => (
				<span key={exposure.id} className="relative z-10 flex shrink-0">
					<Badge
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
							onNone: () => Option.match(exposure.url, {onNone: () => '', onSome: host}),
							onSome: port => `${port}`
						})}
					</Badge>
				</span>
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
		<span className="text-muted-foreground shrink-0 pr-2 font-mono text-xs whitespace-nowrap tabular-nums">
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
			<PlayIcon className="size-3" />
		</Button>
	)
}

function RunFailure(props: {item: InventoryItem}) {
	return (
		<div className="wrap-anywhere">
			<ResultError result={useAtomValue(runAtom(props.item.id))} className="mx-4" />
		</div>
	)
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
		onTrue: () => ''
	})
	const reasonText = Boolean.match(scheduled, {
		onFalse: () => reasonLine(props.row.item, props.now),
		onTrue: () => reason
	})
	return (
		<>
			<Item size="row" role="listitem" data-selected={props.selected}>
				{/* The whole row is the hit area; the row itself draws hover, selection and the focus ring, and the controls it holds sit above it. */}
				<div className="absolute inset-0 z-0 flex">
					<Button
						aria-label={`Open ${fullName}`}
						variant="bare"
						className="w-full max-sm:h-11"
						onClick={props.onSelect}
					/>
				</div>
				<ItemMedia>
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
					<ItemTitle
						className={Boolean.match(failing, {onFalse: () => 'w-full', onTrue: () => 'max-w-1/2'})}
						title={fullName}
					>
						<span className="min-w-0 truncate">{name}</span>
					</ItemTitle>
					{failing && (
						<ItemDescription title={reasonText}>
							<span className="block truncate">{reasonText}</span>
						</ItemDescription>
					)}
				</ItemContent>
				<ItemActions className="shrink-0">
					<span className="flex min-w-0 items-center justify-end gap-1.5">
						{props.row.item.health !== 'quiet' && (
							<span
								title={state}
								aria-label={state}
								role="img"
								className="flex size-3 shrink-0 items-center justify-center"
							>
								<StatusDot status={props.row.item.health} />
							</span>
						)}
						{Boolean.match(scheduled, {
							onFalse: () => <Endpoints free={props.free} row={props.row} />,
							onTrue: () =>
								Boolean.match(running, {
									onFalse: () =>
										Boolean.match(failing, {
											onFalse: () => (
												<span className="text-muted-foreground shrink-0 pr-2 font-mono text-xs whitespace-nowrap tabular-nums">
													{next}
												</span>
											),
											onTrue: () => (
												<span className="text-muted-foreground shrink-0 pr-2 font-mono text-xs whitespace-nowrap tabular-nums">
													{Option.getOrElse(age, () => next)}
												</span>
											)
										}),
									onTrue: () => <Elapsed job={props.row.item.id} />
								})
						})}
					</span>
					{/* An endpoint this app exposed is hidden through Deploy's hide_exposure tool, not this page. */}
					{Boolean.match(scheduled, {
						onFalse: Function.constNull,
						onTrue: () => (
							<span className="relative z-10 flex size-5 shrink-0 items-center justify-center">
								<RunNow disabled={running} item={props.row.item} onRun={() => run(requestOf(props.row.item))} />
							</span>
						)
					})}
				</ItemActions>
			</Item>
			{scheduled && <RunFailure item={props.row.item} />}
		</>
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
		<div role="list">
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
		</div>
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
	const jobs = Array.filter(props.rows, row => Option.contains(row.item.scheduled, true))
	const groups = impactGroups(
		Array.filter(props.rows, row => !Option.contains(row.item.scheduled, true)),
		props.history
	)
	return (
		<div className={cn('flex min-h-0 flex-col', props.className)}>
			<Suspense
				fallback={
					<div className="min-h-0 flex-1 overflow-hidden">
						<AppRowsSkeleton label="Apps loading" rows={8} />
					</div>
				}
			>
				<InventoryContent>
					{Array.match(props.rows, {
						onEmpty: () => <EmptyState icon={<AppWindowIcon weight="light" />} label="No apps in this range" />,
						onNonEmpty: () => (
							<ScrollArea className="min-h-0 flex-1">
								{Array.isReadonlyArrayNonEmpty(groups.high) && (
									<ListRows
										compact={props.compact}
										free={props.free}
										now={props.now}
										onSelect={props.onSelect}
										rows={groups.high}
										selectedId={props.selectedId}
									/>
								)}
								{Array.isReadonlyArrayNonEmpty(groups.low) && (
									<ListRows
										compact={props.compact}
										free={props.free}
										now={props.now}
										onSelect={props.onSelect}
										rows={groups.low}
										selectedId={props.selectedId}
									/>
								)}
								{Boolean.match(Array.isReadonlyArrayNonEmpty(jobs), {
									onFalse: Function.constNull,
									onTrue: () => (
										<ListRows
											compact={props.compact}
											free={props.free}
											now={props.now}
											onSelect={props.onSelect}
											rows={jobs}
											selectedId={props.selectedId}
										/>
									)
								})}
							</ScrollArea>
						)
					})}
				</InventoryContent>
			</Suspense>
		</div>
	)
}
