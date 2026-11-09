import {useAtom, useAtomRefresh, useAtomSuspense, useAtomValue} from '@effect/atom-react'

import {Array, Boolean, Cause, HashSet, Number, Option, Order, Stream, String} from 'effect'

import {AppWindowIcon, ClockIcon, PlayIcon, StackIcon} from '@phosphor-icons/react'
import {CatchBoundary} from '@tanstack/react-router'
import {AsyncResult, Atom} from 'effect/reactivity'
import {Suspense, useState} from 'react'
import type {ReactNode} from 'react'

import {EmptyState} from '@deslop/components-web/fallbacks'
import {ItemListHeading} from '@deslop/components-web/item-list'
import {ResultError} from '@deslop/components-web/result-error'
import {StatusDot} from '@deslop/components-web/status-dot'
import {Badge} from '@deslop/components-web/ui/badge'
import {Button} from '@deslop/components-web/ui/button'
import {Item, ItemActions, ItemContent, ItemDescription, ItemMedia, ItemTitle} from '@deslop/components-web/ui/item'
import {ScrollArea} from '@deslop/components-web/ui/scroll-area'
import {Skeleton} from '@deslop/components-web/ui/skeleton'
import {cn} from '@deslop/components-web/utils'
import {Failure} from '@deslop/runtime/web'

import {inventoryAtom, runAtom} from '#lib/utils.ts'
import {useExpose} from '#routes/(home)/-expose.tsx'
import {ApplicationIcon} from '#routes/(home)/-marks.tsx'
import {
	type Row,
	counted,
	dot,
	failureAge,
	host,
	middleEllipsis,
	nextRun,
	reasonLine,
	reasonOf,
	runRequest,
	status
} from '#routes/(home)/-rows.ts'
import {workloadName} from '#services/inventory/lib/utils.ts'
import type {InventoryItem, Process} from '#services/inventory/schema.ts'

export function InventoryContent(props: {children: ReactNode}) {
	const result = useAtomSuspense(inventoryAtom, {includeFailure: true})
	const refresh = useAtomRefresh(inventoryAtom)
	if (AsyncResult.isFailure(result) && Option.isNone(AsyncResult.value(result))) {
		return <Failure error={Cause.squash(result.cause)} reset={refresh} />
	}
	return (
		<CatchBoundary getResetKey={() => 'inventory'} errorComponent={Failure}>
			{props.children}
		</CatchBoundary>
	)
}

// The list's loading rows: the real row's 16px mark at the 16px gutter, a name bar where names sit and a chip-sized box where its ports end.
function AppRowsSkeleton(props: {label: string; rows: number}) {
	return (
		<div aria-busy="true" aria-label={props.label} role="status">
			{Array.map(Array.range(1, props.rows), row => (
				<Item key={row} aria-hidden size="row">
					<ItemMedia>
						<Skeleton className="size-4" />
					</ItemMedia>
					<ItemContent>
						<Skeleton className="h-3 w-2/5" />
					</ItemContent>
					<ItemActions>
						<Skeleton className="h-5 w-12" />
					</ItemActions>
				</Item>
			))}
		</div>
	)
}

// Every port is one bordered chip whose digits end on the same edge: exposed in foreground text opening its endpoint, exposable in muted text opening the Expose dialog, the rest muted and inert.
function Endpoints(props: {free: readonly InventoryItem[]; row: Row}) {
	const expose = useExpose()
	const exposedPorts = HashSet.fromIterable(Array.map(props.row.exposures, exposure => exposure.port))
	const freePorts = Array.groupBy(props.free, port => port.id)
	return (
		<>
			{Array.map(
				Array.dedupeWith(
					Array.filter(
						props.row.listeners,
						listener => listener.address !== 'container' && !HashSet.has(exposedPorts, listener.port)
					),
					(first: InventoryItem, second: InventoryItem) => first.port === second.port
				),
				listener =>
					Option.match(Array.head(freePorts[listener.id] ?? []), {
						onNone: () => (
							<Badge key={listener.id} variant="outline">
								<span className="text-muted-foreground">{listener.port}</span>
							</Badge>
						),
						onSome: port => (
							<Badge
								key={listener.id}
								variant="outline"
								render={
									<button
										type="button"
										className="pointer-events-auto relative z-10"
										aria-label={`Expose ${workloadName(props.row.item)} :${listener.port}`}
										onClick={() => expose(port)}
									/>
								}
							>
								<span className="text-muted-foreground">{listener.port}</span>
							</Badge>
						)
					})
			)}
			{Array.map(props.row.exposures, exposure => (
				<a
					key={exposure.id}
					href={exposure.url}
					target="_blank"
					rel="noreferrer"
					title={exposure.url}
					className="pointer-events-auto relative z-10"
					aria-label={`Open ${exposure.url}`}
				>
					<Badge variant="outline">
						{Option.match(Option.fromUndefinedOr(exposure.port), {
							onNone: () => host(exposure.url),
							onSome: port => `${port}`
						})}
					</Badge>
				</a>
			))}
		</>
	)
}

// A running job's time: it starts counting when its row shows it, once a second, in the column that shows the next start.
const elapsedAtom = Atom.family((_job: string) =>
	Atom.make(Stream.map(Stream.zipWithIndex(Stream.tick('1 second')), tick => tick[1] * 1000))
)

function Elapsed(props: {job: string}) {
	return (
		<span className="text-muted-foreground shrink-0 pr-2 font-mono text-xs whitespace-nowrap tabular-nums">
			{counted(AsyncResult.getOrElse(useAtomValue(elapsedAtom(props.job)), () => 0))}
		</span>
	)
}

// A timer's job, started now at its row's end; it waits, disabled, while the job runs.
function RunNow(props: {disabled: boolean; item: InventoryItem; onRun: () => void}) {
	return (
		<Button
			size="icon-xs"
			variant="ghost"
			className="pointer-events-auto size-5"
			disabled={props.disabled}
			aria-label={`Run ${workloadName(props.item)} now`}
			onClick={props.onRun}
		>
			<PlayIcon className="size-3" />
		</Button>
	)
}

export function RunFailure(props: {item: InventoryItem}) {
	return <ResultError result={useAtomValue(runAtom(props.item.id))} className="mx-4 wrap-anywhere" />
}

// One app or job: its mark, name, ports or reason, and the actions it has at the row's end; the whole row opens its processes.
function AppRow(props: {
	compact: boolean
	free: readonly InventoryItem[]
	now: number
	onSelect: () => void
	row: Row
	selected: boolean
}) {
	const [requested, setRequested] = useState(() => Option.none<number>())
	const [runResult, run] = useAtom(runAtom(props.row.item.id))
	const state = status(props.row.item)
	const light = dot(props.row.item, state)
	const scheduled = props.row.item.scheduled === true
	const reason = reasonOf(props.row)
	const age = failureAge(props.row, props.now)
	const running =
		Option.isSome(String.match(/^(?:activating|deactivating|active · running)/u)(props.row.item.state)) ||
		Option.exists(requested, at => props.now - at < 10_000) ||
		AsyncResult.isWaiting(runResult)
	const fullName = workloadName(props.row.item)
	const name = Boolean.match(props.compact, {onFalse: () => fullName, onTrue: () => middleEllipsis(fullName)})
	const failing = light === 'error' || light === 'warning'
	const next = Boolean.match(running, {
		onFalse: () => nextRun(props.row.item.next ?? props.now, props.now),
		onTrue: () => ''
	})
	const reasonText = Boolean.match(scheduled, {onFalse: () => reasonLine(props.row, props.now), onTrue: () => reason})
	return (
		<>
			<Item size="row" role="listitem" data-selected={props.selected} className="relative">
				{/* The whole row is the hit area; the row itself draws hover, selection and the focus ring. */}
				<Button
					aria-label={`Open ${fullName}`}
					variant="bare"
					className="absolute inset-0 z-0 size-full"
					onClick={props.onSelect}
				/>
				<ItemMedia className="pointer-events-none relative z-10">
					<ApplicationIcon
						name={fullName}
						process={Array.match(props.row.item.processes ?? [], {
							onEmpty: () => undefined,
							onNonEmpty: entries =>
								Array.max(
									entries,
									Order.mapInput(Number.Order, (entry: Process) => entry.memory)
								).name
						})}
						container={props.row.item.kind === 'container'}
					/>
				</ItemMedia>
				<ItemContent className="pointer-events-none relative z-10">
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
				<ItemActions className="pointer-events-none relative z-10 shrink-0">
					<span className="flex min-w-0 items-center justify-end gap-1.5">
						{failing && (
							<span
								title={state}
								aria-label={state}
								role="img"
								className="flex size-3 shrink-0 items-center justify-center"
							>
								<StatusDot status={light} />
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
						onFalse: () => null,
						onTrue: () => (
							<span className="flex size-5 shrink-0 items-center justify-center">
								<RunNow
									disabled={running}
									item={props.row.item}
									onRun={() => {
										setRequested(Option.some(props.now))
										run(runRequest(props.row.item))
									}}
								/>
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
	now: number
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

// The apps on one machine: failures first, then apps by memory, then the jobs a timer starts under their own heading.
export function ListPane(props: {
	className?: string
	compact: boolean
	free: readonly InventoryItem[]
	now: number
	onSelect: (row: Row) => void
	rows: readonly Row[]
	selectedId?: string
}) {
	const apps = Array.filter(props.rows, row => row.item.scheduled !== true)
	const jobs = Array.filter(props.rows, row => row.item.scheduled === true)
	return (
		<div className={cn('flex min-h-0 flex-col', props.className)}>
			<ItemListHeading icon={<StackIcon />}>Processes</ItemListHeading>
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
								{Boolean.match(Array.isReadonlyArrayNonEmpty(apps), {
									onFalse: () => null,
									onTrue: () => (
										<ListRows
											compact={props.compact}
											free={props.free}
											now={props.now}
											onSelect={props.onSelect}
											rows={apps}
											selectedId={props.selectedId}
										/>
									)
								})}
								{Boolean.match(Array.isReadonlyArrayNonEmpty(jobs), {
									onFalse: () => null,
									onTrue: () => (
										<>
											<ItemListHeading icon={<ClockIcon />}>Scheduled</ItemListHeading>
											<ListRows
												compact={props.compact}
												free={props.free}
												now={props.now}
												onSelect={props.onSelect}
												rows={jobs}
												selectedId={props.selectedId}
											/>
										</>
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
