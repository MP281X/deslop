import {useAtom, useAtomRefresh, useAtomSuspense, useAtomValue} from '@effect/atom-react'

import {Array, Boolean, Cause, DateTime, HashSet, Number, Option, Order, Record, Schema, String} from 'effect'

import {AppWindowIcon, ChartLineIcon, ClockIcon, PlayIcon, StackIcon, TerminalWindowIcon} from '@phosphor-icons/react'
import {CatchBoundary, Link, createFileRoute, getRouteApi} from '@tanstack/react-router'
import {AsyncResult} from 'effect/reactivity'
import {Suspense, useDeferredValue, useEffect, useState} from 'react'
import type {ReactNode} from 'react'

import {AppBar, AppBarTab, AppBarTabs} from '@deslop/components-web/app-bar'
import {Denied, EmptyState, Error, SignIn} from '@deslop/components-web/fallbacks'
import {ItemListHeading} from '@deslop/components-web/item-list'
import {Problem, problemSinceAtom} from '@deslop/components-web/problem'
import {ResultError} from '@deslop/components-web/result-error'
import {StatusDot} from '@deslop/components-web/status-dot'
import {Badge} from '@deslop/components-web/ui/badge'
import {Button} from '@deslop/components-web/ui/button'
import {Item, ItemActions, ItemContent, ItemDescription, ItemMedia, ItemTitle} from '@deslop/components-web/ui/item'
import {ResizableHandle, ResizablePanel, ResizablePanelGroup} from '@deslop/components-web/ui/resizable'
import {ScrollArea} from '@deslop/components-web/ui/scroll-area'
import {Skeleton} from '@deslop/components-web/ui/skeleton'
import {Tabs, TabsList, TabsTrigger} from '@deslop/components-web/ui/tabs'
import {cn, useMediaQuery} from '@deslop/components-web/utils'
import {isDenied, needsSignIn, signInUrl} from '@deslop/runtime/auth/utils'
import * as WebRuntime from '@deslop/runtime/web'

import {MachineIcon, machineName} from '#lib/components.tsx'
import {inventoryAtom, metricsAtom, runAtom} from '#lib/utils.ts'
import {RANGES} from '#routes/(home)/-chart.ts'
import {TimeAxis, UsageChart} from '#routes/(home)/-charts.tsx'
import type {ChartLayer} from '#routes/(home)/-charts.tsx'
import {useExpose} from '#routes/(home)/-expose.tsx'
import {ApplicationIcon} from '#routes/(home)/-marks.tsx'
import {appUsage, processTree} from '#routes/(home)/-process-tree.ts'
import {Processes} from '#routes/(home)/-processes.tsx'
import {appHue, bands} from '#routes/(home)/-usage.ts'
import type {Band} from '#routes/(home)/-usage.ts'
import icon from '#routes/icon.svg'
import {availablePorts, itemOwner, workloadName, workloads} from '#services/inventory/lib/utils.ts'
import type {InventoryItem, Process, RunRequest} from '#services/inventory/schema.ts'
import {chartWindow} from '#services/metrics/lib/utils.ts'
import {HistoryQuery} from '#services/metrics/schema.ts'
import type {MachineHistory, Sample} from '#services/metrics/schema.ts'

const CHART_LABELS = ['Memory', 'CPU', 'Disk'] as const

// A phone shows the list with the machine's chart above it, or one app's processes full-screen.
type Pane = typeof Pane.Type
const Pane = Schema.Literals(['apps', 'machine', 'process'])

// The view lives in the URL, so a reload, Back or a shared link reopens the same machine, app, pane and range.
type Search = typeof Search.Type
const Search = Schema.Struct({
	app: Schema.optionalKey(Schema.String),
	machine: Schema.optionalKey(Schema.String),
	pane: Schema.optionalKey(Pane),
	range: Schema.optionalKey(HistoryQuery.fields.minutes)
})
const route = getRouteApi('/(home)/')

const untilNext = new Intl.RelativeTimeFormat('en', {numeric: 'auto', style: 'narrow'})
const size = new Intl.NumberFormat(undefined, {maximumFractionDigits: 1})

function status(item: InventoryItem) {
	if (String.startsWith('stale')(item.state)) return 'stale'
	if (String.includes('unhealthy')(item.detail)) return 'unhealthy'
	if (item.kind === 'port') return 'listening'
	if (item.kind === 'exposure' && item.owned === true) return 'configured'
	if (item.kind === 'exposure' && item.publicAccess === true) return 'public permission'
	return String.replace(/^active · /u, '')(String.toLowerCase(item.state))
}

// Only a problem is marked: a service that runs needs no dot to say so.
function dot(item: InventoryItem, state: string) {
	if (Option.isSome(String.match(/failed|unhealthy|Exited \([1-9]/u)(item.state + item.detail))) return 'error'
	if (state === 'stale' || state === 'public permission' || state === 'restarting') return 'warning'
	return 'quiet'
}

// How long ago a service stopped: minutes within the hour, hours within two days, then days.
function since(at: number, now: number) {
	const minutes = Number.max(0, Number.round((now - at) / 60_000, 0))
	if (minutes < 60) return untilNext.format(-minutes, 'minute')
	if (minutes < 2880) return untilNext.format(-Number.round(minutes / 60, 0), 'hour')
	return untilNext.format(-Number.round(minutes / 1440, 0), 'day')
}

// When a timer next starts the job, against the snapshot's clock: minutes within the hour, then hours.
function nextRun(next: number, now: number) {
	const minutes = Number.max(0, Number.round((next - now) / 60_000, 0))
	if (minutes < 60) return untilNext.format(minutes, 'minute')
	return untilNext.format(Number.round(minutes / 60, 0), 'hour')
}

// A running job's time in its row's column, counting up from its start as m:ss.
function counted(milliseconds: number) {
	const seconds = Number.max(0, Math.floor(milliseconds / 1000))
	return `${Math.floor(seconds / 60)}:${String.padStart(2, '0')(`${seconds % 60}`)}`
}

function bytes(value: number) {
	if (value >= 1024 ** 4) return `${size.format(value / 1024 ** 4)} TiB`
	if (value >= 1024 ** 3) return `${size.format(value / 1024 ** 3)} GiB`
	return `${size.format(value / 1024 ** 2)} MiB`
}

// The process holding the most memory, which names an app's row and its pane.

// The key a service or container's usage history is recorded under; loose ports have none.
function owner(row: ReturnType<typeof workloads>[number]) {
	return Option.map(
		Option.liftPredicate(row.item, item => item.kind === 'service' || item.kind === 'container'),
		itemOwner
	)
}

// Why a row needs a look, and for an app how long ago; a healthy row has none.
function reasonOf(row: ReturnType<typeof workloads>[number]) {
	return Option.match(Option.fromUndefinedOr(row.item.failure), {
		onNone: () => row.item.detail,
		onSome: stop => stop.reason
	})
}

function failureAge(row: ReturnType<typeof workloads>[number], now: number) {
	return Option.map(Option.fromUndefinedOr(row.item.failure?.at), at => since(at, now))
}

function reasonLine(row: ReturnType<typeof workloads>[number], now: number) {
	return Option.match(failureAge(row, now), {onNone: () => reasonOf(row), onSome: age => `${reasonOf(row)} · ${age}`})
}

// Failing rows first, then the apps by memory, then the jobs a timer starts.
function rank(row: ReturnType<typeof workloads>[number]) {
	const light = dot(row.item, status(row.item))
	if (light === 'error') return 0
	if (light === 'warning') return 1
	if (row.item.scheduled === true) return 3
	return 2
}

const order = Order.combine(
	Order.combine(
		Order.mapInput(Order.Number, rank),
		Order.mapInput(
			Order.flip(Order.Number),
			(row: ReturnType<typeof workloads>[number]) => appUsage(row.item.processes ?? []).memory
		)
	),
	Order.mapInput(Order.Number, (row: ReturnType<typeof workloads>[number]) => row.item.next ?? 0)
)

// The range's apps: a service or container that neither ran nor failed in it has no row. A job keeps its row to run it now, and a machine without history shows every app.
function ranged(rows: readonly ReturnType<typeof workloads>[number][], minutes: number, history?: MachineHistory) {
	if (history === undefined) return rows
	const recorded = HashSet.fromIterable(
		Array.flatMap(history.samples, sample => Array.map(sample.apps ?? [], app => app.id))
	)
	const start = chartWindow(minutes, history.time).start
	return Array.filter(
		rows,
		row =>
			row.item.scheduled === true ||
			Option.match(owner(row), {
				onNone: () => true,
				onSome: id => HashSet.has(recorded, id) || (row.item.failure?.at ?? 0) >= start
			})
	)
}

function failedFor(
	worker: string,
	inventoryFailure: boolean,
	sources: readonly {error: string; name: string}[],
	history?: MachineHistory
) {
	return (
		inventoryFailure ||
		history?.stale === true ||
		Array.some(
			sources,
			source => source.error !== '' && (source.name === worker || String.startsWith(`${worker} · `)(source.name))
		)
	)
}

function middle(value: string) {
	if (String.length(value) <= 28) return value
	return `${String.slice(0, 7)(value)}…${String.slice(-7)(value)}`
}

function host(url: string) {
	return Option.getOrElse(Array.head(String.split(String.replace(/^https:\/\//u, '')(url), '/')), () => url)
}

function bandName(id: string, labels: Record<string, string>) {
	if (id === 'other') return 'Small apps'
	if (id === 'system') return 'System'
	return Option.getOrElse(Record.get(labels, id), () =>
		String.replaceAll(/^service:[a-z]+:(?:deslop-)?|\.service$/gu, '')(String.replace(/^container:/u, 'container ')(id))
	)
}

// The range as one stock control: a line of tabs in the bar, the short set on a phone.
function RangeTabs(props: {
	minutes: HistoryQuery['minutes']
	onChange: (minutes: HistoryQuery['minutes']) => void
	ranges: readonly {label: string; minutes: HistoryQuery['minutes']; name: string}[]
}) {
	return (
		<Tabs
			value={`${props.minutes}`}
			onValueChange={(value: string) => {
				Option.map(
					Array.findFirst(props.ranges, range => `${range.minutes}` === value),
					range => props.onChange(range.minutes)
				)
			}}
		>
			<TabsList aria-label="History range">
				{Array.map(props.ranges, range => (
					<TabsTrigger key={range.minutes} value={`${range.minutes}`}>
						{range.label}
					</TabsTrigger>
				))}
			</TabsList>
		</Tabs>
	)
}

// The machines as the bar's section control: its icon in the machine's colour and its name; an unreachable one keeps a dot. One machine needs no control.
function MachineTabs(props: {
	active?: string
	histories: readonly MachineHistory[]
	inventoryFailure: boolean
	onChoose: () => void
	sources: readonly {error: string; name: string}[]
	workers: readonly string[]
}) {
	if (props.workers.length < 2) return null
	return (
		<AppBarTabs value={props.active ?? props.workers[0] ?? ''}>
			{Array.map(props.workers, worker => {
				const failed = failedFor(
					worker,
					props.inventoryFailure,
					props.sources,
					Option.getOrUndefined(Array.findFirst(props.histories, machine => machine.worker === worker))
				)
				return (
					<AppBarTab
						key={worker}
						value={worker}
						render={
							<Link
								to="/"
								onClick={props.onChoose}
								search={previous => ({...previous, app: undefined, machine: worker, pane: 'apps'})}
							/>
						}
					>
						<MachineIcon worker={worker} />
						<span className="max-w-32 truncate">{machineName(worker)}</span>
						{/* Only an unreachable machine is marked; one that answers needs no dot. */}
						{failed && (
							<span role="img" aria-label="Unavailable" className="flex size-3 shrink-0 items-center justify-center">
								<StatusDot status="off" />
							</span>
						)}
					</AppBarTab>
				)
			})}
		</AppBarTabs>
	)
}

// Ports of one least size, all in one badge box so their digits end on one edge: exposed in an outline badge that opens its endpoint, exposable as a clickable ghost, the rest plain muted text.
function Endpoints(props: {free: readonly InventoryItem[]; row: ReturnType<typeof workloads>[number]}) {
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
							<span
								key={listener.id}
								className="text-muted-foreground inline-flex h-5 w-fit shrink-0 items-center justify-center overflow-hidden border border-transparent px-2 py-0.5 text-xs font-medium whitespace-nowrap tabular-nums"
							>
								{listener.port}
							</span>
						),
						onSome: port => (
							<button
								key={listener.id}
								type="button"
								className="pointer-events-auto relative z-10"
								aria-label={`Expose ${workloadName(props.row.item)} :${listener.port}`}
								onClick={() => expose(port)}
							>
								<Badge variant="ghost">{listener.port}</Badge>
							</button>
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

function runRequest(item: InventoryItem) {
	return {
		name: item.name,
		scope: item.scope ?? 'system',
		...Boolean.match(String.startsWith('remote:')(item.id), {
			onFalse: () => ({}),
			onTrue: () => ({target: item.worker})
		})
	} satisfies RunRequest
}

// A running job's time: it starts counting when its row shows it, once a second, in the column that shows the next start.
function Elapsed() {
	const [clock, setClock] = useState(() => {
		const at = Date.now()
		return {now: at, started: at}
	})
	useEffect(() => {
		const timer = setInterval(() => setClock(previous => ({...previous, now: Date.now()})), 1000)
		return () => clearInterval(timer)
	}, [])
	return (
		<span className="text-muted-foreground shrink-0 pr-2 font-mono text-xs whitespace-nowrap tabular-nums">
			{counted(clock.now - clock.started)}
		</span>
	)
}

// A timer's job, started now at its row's end; it waits, disabled, while the job runs.
function RunNow(props: {disabled: boolean; item: InventoryItem; onRun: () => void}) {
	return (
		<Button
			size="icon-xs"
			variant="ghost"
			className="pointer-events-auto"
			disabled={props.disabled}
			aria-label={`Run ${workloadName(props.item)} now`}
			onClick={props.onRun}
		>
			<PlayIcon className="size-4" />
		</Button>
	)
}

function RunFailure(props: {item: InventoryItem}) {
	return <ResultError result={useAtomValue(runAtom(props.item.id))} className="mx-4 wrap-anywhere" />
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

// The processes' loading rows: the real mark and name and detail bars, and its memory figure right-aligned in the same column.
function ProcessRowsSkeleton(props: {label: string; rows: number}) {
	return (
		<div aria-busy="true" aria-label={props.label} role="status">
			{Array.map(Array.range(1, props.rows), row => (
				<Item key={row} aria-hidden size="row">
					<ItemMedia>
						<Skeleton className="size-4" />
					</ItemMedia>
					<ItemContent>
						<div className="flex min-w-0 flex-1 items-baseline gap-2">
							<Skeleton className="h-3 w-24" />
							<Skeleton className="h-3 w-2/5" />
						</div>
					</ItemContent>
					<ItemActions>
						<div className="flex w-12 justify-end">
							<Skeleton className="h-3 w-8" />
						</div>
					</ItemActions>
				</Item>
			))}
		</div>
	)
}

// One app or job: its mark, name, ports or reason, and the actions it has at the row's end; the whole row opens its processes.
function AppRow(props: {
	bandOf: Record<string, string>
	compact: boolean
	free: readonly InventoryItem[]
	hovered?: string
	now: number
	onHover: (id?: string) => void
	onSelect: () => void
	row: ReturnType<typeof workloads>[number]
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
	const band = Option.filter(
		Option.flatMap(owner(props.row), id => Record.get(props.bandOf, id)),
		() => !scheduled
	)
	const linked = Option.match(band, {onNone: () => false, onSome: id => props.hovered === id})
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
			<Item
				size="row"
				variant={Boolean.match(linked, {onFalse: () => 'default', onTrue: () => 'muted'})}
				role="listitem"
				data-selected={props.selected}
				className="relative"
				onPointerEnter={() => props.onHover(Option.getOrUndefined(band))}
				onPointerLeave={() => props.onHover()}
			>
				{/* The whole row is the hit area; the row itself draws hover, selection and the focus ring. */}
				<Button
					aria-label={`Open ${fullName}`}
					variant="ghost"
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
									onTrue: () => <Elapsed />
								})
						})}
					</span>
					{/* An endpoint this app exposed is hidden through Deploy's hide_exposure tool, not this page. */}
					{Boolean.match(scheduled, {
						onFalse: () => null,
						onTrue: () => (
							<span className="flex size-6 shrink-0 items-center justify-center">
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

function FailureContent(props: {error: unknown; reset: () => void}) {
	if (needsSignIn(props.error)) return <SignIn href={signInUrl(location.href)} />
	if (isDenied(props.error)) return <Denied />
	return <Error error={props.error} reset={props.reset} />
}

function InventoryContent(props: {children: ReactNode}) {
	const result = useAtomSuspense(inventoryAtom, {includeFailure: true})
	const refresh = useAtomRefresh(inventoryAtom)
	if (AsyncResult.isFailure(result) && Option.isNone(AsyncResult.value(result))) {
		return <FailureContent error={Cause.squash(result.cause)} reset={refresh} />
	}
	return (
		<CatchBoundary getResetKey={() => 'inventory'} errorComponent={FailureContent}>
			{props.children}
		</CatchBoundary>
	)
}

function MetricsContent(props: {children: ReactNode; minutes: HistoryQuery['minutes']}) {
	const result = useAtomSuspense(metricsAtom(props.minutes), {includeFailure: true})
	const refresh = useAtomRefresh(metricsAtom(props.minutes))
	if (AsyncResult.isFailure(result) && Option.isNone(AsyncResult.value(result))) {
		return <FailureContent error={Cause.squash(result.cause)} reset={refresh} />
	}
	return (
		<CatchBoundary getResetKey={() => 'metrics'} errorComponent={FailureContent}>
			{props.children}
		</CatchBoundary>
	)
}

// Retained inventory or history that has gone stale: one mark in the bar, aged from the older reader, retried together.
function DataProblem(props: {minutes: HistoryQuery['minutes']}) {
	const inventory = useAtomValue(inventoryAtom)
	const metrics = useAtomValue(metricsAtom(props.minutes))
	const inventorySince = useAtomValue(problemSinceAtom(inventoryAtom))
	const metricsSince = useAtomValue(problemSinceAtom(metricsAtom(props.minutes)))
	const refreshInventory = useAtomRefresh(inventoryAtom)
	const refreshMetrics = useAtomRefresh(metricsAtom(props.minutes))
	const denied =
		Option.isSome(Option.filter(AsyncResult.error(inventory), isDenied)) ||
		Option.isSome(Option.filter(AsyncResult.error(metrics), isDenied))
	const stale =
		(AsyncResult.isFailure(inventory) && Option.isSome(AsyncResult.value(inventory))) ||
		(AsyncResult.isFailure(metrics) && Option.isSome(AsyncResult.value(metrics)))
	const oldest = Option.getOrUndefined(
		Array.head(Array.sort(Array.getSomes([inventorySince, metricsSince]), Order.Number))
	)
	function retry() {
		refreshInventory()
		refreshMetrics()
	}
	if (denied || !stale) return null
	return <Problem label="Data out of date" warning reset={retry} since={oldest} />
}

// One loading chart title: its static name, with only the server's figure left to load.
function ChartTitleSkeleton(props: {label: string}) {
	return (
		<div className="flex w-full items-center justify-between gap-2 text-xs">
			<span>{props.label}</span>
			<Skeleton className="h-4 w-10" />
		</div>
	)
}

function ChartSkeleton(props: {isPhone: boolean; minutes: HistoryQuery['minutes']}) {
	const now = DateTime.toEpochMillis(DateTime.nowUnsafe())
	return (
		<div aria-busy="true" aria-label="Usage history" role="status" className="flex shrink-0 flex-col border-b">
			{Boolean.match(props.isPhone, {
				onFalse: () => (
					<div className="grid h-8 grid-cols-3 items-center gap-6 border-b px-4">
						{Array.map(CHART_LABELS, label => (
							<ChartTitleSkeleton key={label} label={label} />
						))}
					</div>
				),
				onTrue: () => null
			})}
			<div className="grid grid-cols-1 gap-3 px-4 py-3 sm:grid-cols-3 sm:gap-6">
				{Array.map(CHART_LABELS, (label, index) => (
					<div key={label} className="flex min-w-0 flex-col gap-1">
						{Boolean.match(props.isPhone, {
							onFalse: () => null,
							onTrue: () => (
								<div className="flex h-8 items-center border-b">
									<ChartTitleSkeleton label={label} />
								</div>
							)
						})}
						<Skeleton className="h-16 w-full sm:h-32" />
						{Boolean.match(props.isPhone, {
							onFalse: () => <TimeAxis minutes={props.minutes} now={now} />,
							onTrue: () =>
								Boolean.match(index === 2, {
									onFalse: () => null,
									onTrue: () => <TimeAxis minutes={props.minutes} now={now} />
								})
						})}
					</div>
				))}
			</div>
		</div>
	)
}

function rate(value: number) {
	return `${size.format(value)}%`
}

// The machine's used disk space: its recorded total, or the sum of its mounts for a sample from before that field.
function usedStorage(sample: Sample) {
	return Option.getOrElse(Option.fromUndefinedOr(sample.storageUsed), () =>
		Array.reduce(sample.disks, 0, (sum, disk) => sum + disk.used)
	)
}

function ChartTitle(props: {figure: string; label: string}) {
	return (
		<div className="flex w-full items-baseline justify-between gap-2 text-xs">
			<span>{props.label}</span>
			<span className="tabular-nums">{props.figure}</span>
		</div>
	)
}

// The machine's three readings over time: apps stacked on the whole machine's 0–100%, and disk used as one band.
function ChartBlock(props: {
	highlight?: string
	history: MachineHistory
	isPhone: boolean
	labels: Record<string, string>
	minutes: HistoryQuery['minutes']
	onHover: (id?: string) => void
}) {
	const all = bands(props.history)
	const latest = Option.getOrUndefined(Array.last(props.history.samples))
	const total = Array.reduce(latest?.disks ?? [], 0, (sum, disk) => sum + disk.total)
	const disk = Array.map(props.history.samples, sample =>
		Boolean.match(total > 0, {
			onFalse: () => 0,
			onTrue: () => Number.clamp((usedStorage(sample) / total) * 100, {maximum: 100, minimum: 0})
		})
	)
	const charts: readonly {
		figure: string
		format: (value: number) => string
		label: string
		layers: readonly ChartLayer[]
		linked: boolean
		recorded: (sample: Sample) => boolean
	}[] = [
		{
			figure: Boolean.match(latest === undefined, {onFalse: () => bytes(latest?.memoryUsed ?? 0), onTrue: () => '—'}),
			format: bytes,
			label: 'Memory',
			layers: Array.map(all, band => ({...band, readings: band.memoryBytes, values: band.memory})),
			linked: true,
			recorded: () => true
		},
		{
			figure: Boolean.match(latest?.cpu === undefined, {onFalse: () => rate(latest?.cpu ?? 0), onTrue: () => '—'}),
			format: rate,
			label: 'CPU',
			layers: Array.map(all, band => ({...band, readings: band.cpu, values: band.cpu})),
			linked: true,
			recorded: sample => sample.cpu !== undefined
		},
		{
			figure: Option.match(Option.fromUndefinedOr(latest), {
				onNone: () => '—',
				onSome: sample =>
					Boolean.match(total > 0, {
						onFalse: () => '—',
						onTrue: () => `${Number.round((usedStorage(sample) / total) * 100, 0)}%`
					})
			}),
			format: rate,
			label: 'Disk',
			layers: [{id: 'disk', kind: 'disk', opacity: 1, readings: disk, values: disk}],
			linked: false,
			recorded: sample => sample.storageUsed !== undefined || Array.isReadonlyArrayNonEmpty(sample.disks)
		}
	]
	return (
		<div className="flex shrink-0 flex-col border-b">
			{Boolean.match(props.isPhone, {
				onFalse: () => (
					<div className="grid h-8 shrink-0 grid-cols-3 items-center gap-6 border-b px-4">
						{Array.map(charts, chart => (
							<ChartTitle key={chart.label} figure={chart.figure} label={chart.label} />
						))}
					</div>
				),
				onTrue: () => null
			})}
			<div className="grid grid-cols-1 gap-3 px-4 py-3 sm:grid-cols-3 sm:gap-6">
				{Array.map(charts, (chart, index) => (
					<div key={chart.label} className="flex min-w-0 flex-col gap-1">
						{Boolean.match(props.isPhone, {
							onFalse: () => null,
							onTrue: () => (
								<div className="flex h-8 items-center border-b">
									<ChartTitle figure={chart.figure} label={chart.label} />
								</div>
							)
						})}
						<UsageChart
							className="h-16 sm:h-32"
							cover={!chart.linked}
							format={chart.format}
							highlight={Boolean.match(chart.linked, {onFalse: () => undefined, onTrue: () => props.highlight})}
							history={props.history}
							hue={appHue}
							label={chart.label}
							layers={chart.layers}
							minutes={props.minutes}
							names={id =>
								Boolean.match(chart.label === 'Disk', {onFalse: () => bandName(id, props.labels), onTrue: () => 'Disk'})
							}
							onHover={Boolean.match(chart.linked, {onFalse: () => () => props.onHover(), onTrue: () => props.onHover})}
							recorded={chart.recorded}
						/>
						{Boolean.match(props.isPhone, {
							onFalse: () => <TimeAxis minutes={props.minutes} now={props.history.time} />,
							onTrue: () =>
								Boolean.match(index === charts.length - 1, {
									onFalse: () => null,
									onTrue: () => <TimeAxis minutes={props.minutes} now={props.history.time} />
								})
						})}
					</div>
				))}
			</div>
		</div>
	)
}

function EmptyChart(props: {worker?: string}) {
	return (
		<div className="flex h-44 shrink-0 items-center justify-center sm:h-64">
			<EmptyState
				icon={<ChartLineIcon weight="light" />}
				label={Boolean.match(props.worker === undefined, {
					onFalse: () => 'No readings in this range',
					onTrue: () => 'No machine'
				})}
			/>
		</div>
	)
}

// The selected app's processes, or one job's, with what the row cannot show: its failure.
function ProcessList(props: {
	bandOf: Record<string, string>
	now: number
	onHover: (id?: string) => void
	row: ReturnType<typeof workloads>[number]
}) {
	const processes = props.row.item.processes ?? []
	const tree = processTree(processes)
	const band = Option.getOrUndefined(Option.flatMap(owner(props.row), id => Record.get(props.bandOf, id)))
	return (
		<>
			{Boolean.match(props.row.item.scheduled === true, {
				onFalse: () => null,
				onTrue: () => (
					<div className="px-4 pt-2 empty:hidden">
						<RunFailure item={props.row.item} />
					</div>
				)
			})}
			{Array.match(processes, {
				onEmpty: () => <EmptyState icon={<TerminalWindowIcon weight="light" />} label="No processes right now" />,
				onNonEmpty: () => (
					<ScrollArea className="min-h-0 flex-1">
						<Processes band={band} onHover={props.onHover} tree={tree} />
					</ScrollArea>
				)
			})}
		</>
	)
}

// The processes below the chart, or a phone's pushed pane; nothing selected is one symbol.
function SelectedProcesses(props: {
	app?: string
	bandOf: Record<string, string>
	now: number
	onHover: (id?: string) => void
	pending: boolean
	row?: ReturnType<typeof workloads>[number]
}) {
	return (
		<div className="flex min-h-0 flex-1 flex-col">
			{Option.match(Option.fromUndefinedOr(props.row), {
				onNone: () =>
					Boolean.match(props.pending && props.app !== undefined, {
						onFalse: () => <EmptyState icon={<TerminalWindowIcon weight="light" />} label="Select an app" />,
						onTrue: () => (
							<div className="min-h-0 flex-1 overflow-hidden">
								<ProcessRowsSkeleton label="Processes loading" rows={6} />
							</div>
						)
					}),
				onSome: row => (
					<Suspense
						fallback={
							<div className="min-h-0 flex-1 overflow-hidden">
								<ProcessRowsSkeleton label="Processes loading" rows={6} />
							</div>
						}
					>
						<InventoryContent>
							<ProcessList bandOf={props.bandOf} now={props.now} onHover={props.onHover} row={row} />
						</InventoryContent>
					</Suspense>
				)
			})}
		</div>
	)
}

function ListRows(props: {
	bandOf: Record<string, string>
	compact: boolean
	free: readonly InventoryItem[]
	hovered?: string
	now: number
	onHover: (id?: string) => void
	onSelect: (row: ReturnType<typeof workloads>[number]) => void
	rows: readonly ReturnType<typeof workloads>[number][]
	selectedId?: string
}) {
	return (
		<div role="list">
			{Array.map(props.rows, row => (
				<AppRow
					key={row.item.id}
					bandOf={props.bandOf}
					compact={props.compact}
					free={props.free}
					hovered={props.hovered}
					now={props.now}
					onHover={props.onHover}
					onSelect={() => props.onSelect(row)}
					row={row}
					selected={props.selectedId === row.item.id}
				/>
			))}
		</div>
	)
}

// The apps on one machine: failures first, then apps by memory, then the jobs a timer starts under their own heading.
function ListPane(props: {
	bandOf: Record<string, string>
	className?: string
	compact: boolean
	free: readonly InventoryItem[]
	hovered?: string
	now: number
	onHover: (id?: string) => void
	onSelect: (row: ReturnType<typeof workloads>[number]) => void
	rows: readonly ReturnType<typeof workloads>[number][]
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
											bandOf={props.bandOf}
											compact={props.compact}
											free={props.free}
											hovered={props.hovered}
											now={props.now}
											onHover={props.onHover}
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
												bandOf={props.bandOf}
												compact={props.compact}
												free={props.free}
												hovered={props.hovered}
												now={props.now}
												onHover={props.onHover}
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

// The desktop detail: the three charts, then the chosen processes.
function DetailPane(props: {
	app?: string
	bandOf: Record<string, string>
	history?: MachineHistory
	hovered?: string
	labels: Record<string, string>
	minutes: HistoryQuery['minutes']
	now: number
	onHover: (id?: string) => void
	pending: boolean
	row?: ReturnType<typeof workloads>[number]
	worker?: string
}) {
	return (
		<div className="flex h-full min-h-0 flex-col">
			<Suspense fallback={<ChartSkeleton isPhone={false} minutes={props.minutes} />}>
				<MetricsContent minutes={props.minutes}>
					{Option.match(
						Option.filter(Option.fromUndefinedOr(props.history), history =>
							Array.isReadonlyArrayNonEmpty(history.samples)
						),
						{
							onNone: () => <EmptyChart worker={props.worker} />,
							onSome: history => (
								<ChartBlock
									highlight={props.hovered}
									history={history}
									isPhone={false}
									labels={props.labels}
									minutes={props.minutes}
									onHover={props.onHover}
								/>
							)
						}
					)}
				</MetricsContent>
			</Suspense>
			<div className="flex min-h-0 flex-1 flex-col">
				<SelectedProcesses
					app={props.app}
					bandOf={props.bandOf}
					now={props.now}
					onHover={props.onHover}
					pending={props.pending}
					row={props.row}
				/>
			</div>
		</div>
	)
}

// A phone's list view: the three short charts, then the rows edge to edge.
function PhoneList(props: {
	bandOf: Record<string, string>
	free: readonly InventoryItem[]
	history?: MachineHistory
	hovered?: string
	labels: Record<string, string>
	minutes: HistoryQuery['minutes']
	now: number
	onHover: (id?: string) => void
	onSelect: (row: ReturnType<typeof workloads>[number]) => void
	rows: readonly ReturnType<typeof workloads>[number][]
	selectedId?: string
}) {
	return (
		<div className="flex min-h-0 flex-1 flex-col">
			<Suspense fallback={<ChartSkeleton isPhone minutes={props.minutes} />}>
				<MetricsContent minutes={props.minutes}>
					{Option.match(
						Option.filter(Option.fromUndefinedOr(props.history), history =>
							Array.isReadonlyArrayNonEmpty(history.samples)
						),
						{
							onNone: () => <EmptyChart />,
							onSome: history => (
								<ChartBlock
									highlight={props.hovered}
									history={history}
									isPhone
									labels={props.labels}
									minutes={props.minutes}
									onHover={props.onHover}
								/>
							)
						}
					)}
				</MetricsContent>
			</Suspense>
			<ListPane
				bandOf={props.bandOf}
				className="min-h-0 flex-1"
				compact
				free={props.free}
				hovered={props.hovered}
				now={props.now}
				onHover={props.onHover}
				onSelect={props.onSelect}
				rows={props.rows}
				selectedId={props.selectedId}
			/>
		</div>
	)
}

// What the bar opens onto: the two panes on a wide screen, the chart and list on a phone, or the pushed processes.
function Workspace(props: {
	active?: string
	authFailure: Option.Option<unknown>
	bandOf: Record<string, string>
	free: readonly InventoryItem[]
	history?: MachineHistory
	highlight?: string
	isPhone: boolean
	labels: Record<string, string>
	minutes: HistoryQuery['minutes']
	now: number
	onHover: (id?: string) => void
	onSelect: (row: ReturnType<typeof workloads>[number]) => void
	pending: boolean
	pushed: boolean
	refreshing: boolean
	retryFailed: () => void
	rows: readonly ReturnType<typeof workloads>[number][]
	selectedApp?: string
	selectedRow?: ReturnType<typeof workloads>[number]
	workers: readonly string[]
}) {
	return Option.match(props.authFailure, {
		onNone: () => (
			<div className="flex min-h-0 flex-1 flex-col">
				<h1 className="sr-only">Deploy</h1>
				<div className={cn('flex min-h-0 flex-1 flex-col', props.refreshing && 'opacity-60 transition-opacity')}>
					{Boolean.match(props.isPhone, {
						onFalse: () => (
							<ResizablePanelGroup className="min-h-0 flex-1" orientation="horizontal">
								<ResizablePanel
									className="min-h-0"
									defaultSize={340}
									groupResizeBehavior="preserve-pixel-size"
									minSize={260}
									maxSize={480}
								>
									<ListPane
										bandOf={props.bandOf}
										className="h-full min-w-0"
										compact={false}
										free={props.free}
										hovered={props.highlight}
										now={props.now}
										onHover={props.onHover}
										onSelect={props.onSelect}
										rows={props.rows}
										selectedId={props.selectedRow?.item.id}
									/>
								</ResizablePanel>
								<ResizableHandle />
								<ResizablePanel className="min-h-0">
									<DetailPane
										app={props.selectedApp}
										bandOf={props.bandOf}
										history={props.history}
										hovered={props.highlight}
										labels={props.labels}
										minutes={props.minutes}
										now={props.now}
										onHover={props.onHover}
										pending={props.pending}
										row={props.selectedRow}
										worker={props.active}
									/>
								</ResizablePanel>
							</ResizablePanelGroup>
						),
						onTrue: () =>
							Boolean.match(props.pushed, {
								onFalse: () => (
									<PhoneList
										bandOf={props.bandOf}
										free={props.free}
										history={props.history}
										hovered={props.highlight}
										labels={props.labels}
										minutes={props.minutes}
										now={props.now}
										onHover={props.onHover}
										onSelect={props.onSelect}
										rows={props.rows}
										selectedId={props.selectedRow?.item.id}
									/>
								),
								onTrue: () => (
									<SelectedProcesses
										app={props.selectedApp}
										bandOf={props.bandOf}
										now={props.now}
										onHover={props.onHover}
										pending={props.pending}
										row={props.selectedRow}
									/>
								)
							})
					})}
				</div>
			</div>
		),
		onSome: error => <FailureContent error={error} reset={props.retryFailed} />
	})
}

// The phoned range keeps the current range in view beside the three worth carrying.
function rangeSet(isPhone: boolean, minutes: HistoryQuery['minutes']) {
	if (!isPhone) return RANGES
	return Array.filter(RANGES, range => range.minutes === minutes || Array.contains([60, 1440, 10_080], range.minutes))
}

function phoneTitle(pushed: boolean, row?: ReturnType<typeof workloads>[number]) {
	if (!pushed) return undefined
	return Option.match(Option.fromUndefinedOr(row), {
		onNone: () => 'Processes',
		onSome: entry => workloadName(entry.item)
	})
}

function phoneBack(pushed: boolean, onBack: () => void) {
	if (!pushed) return undefined
	return {label: 'Back', onClick: onBack}
}

// The bar's one staleness mark before the range; the phone uses its shorter range in the same place.
function RangeControls(props: {
	minutes: HistoryQuery['minutes']
	onChange: (minutes: HistoryQuery['minutes']) => void
	ranges: readonly {label: string; minutes: HistoryQuery['minutes']; name: string}[]
}) {
	return (
		<div className="flex items-center gap-1">
			<DataProblem minutes={props.minutes} />
			<RangeTabs minutes={props.minutes} onChange={props.onChange} ranges={props.ranges} />
		</div>
	)
}

function Home() {
	const isPhone = useMediaQuery('(width < 40rem)')
	const search = route.useSearch()
	const navigate = route.useNavigate()
	function view(next: Partial<Search>) {
		navigate({search: previous => ({...previous, ...next})})
	}
	const minutes = search.range ?? 60
	// The charts keep the last loaded range, dimmed, until the one the URL asks for arrives.
	const shownMinutes = useDeferredValue(minutes)
	const pane = search.pane ?? 'apps'
	const [hovered, setHovered] = useState<string>()
	const inventory = useAtomValue(inventoryAtom)
	const metrics = useAtomValue(metricsAtom(shownMinutes))
	const refreshInventory = useAtomRefresh(inventoryAtom)
	const refreshMetrics = useAtomRefresh(metricsAtom(shownMinutes))
	function retryFailed() {
		if (AsyncResult.isFailure(inventory)) refreshInventory()
		if (AsyncResult.isFailure(metrics)) refreshMetrics()
	}
	const snapshot = AsyncResult.value(inventory)
	const shownHistories = AsyncResult.getOrElse(metrics, () => [])
	const inventoryFailure = AsyncResult.isFailure(inventory)
	// A revoked session shows the sign-in even while a cached snapshot remains.
	const authFailure = Option.orElse(Option.filter(AsyncResult.error(inventory), isDenied), () =>
		Option.filter(AsyncResult.error(metrics), isDenied)
	)
	const refreshing = shownMinutes !== minutes
	const inventoryPending = AsyncResult.isInitial(inventory)
	const workers = Array.dedupe([
		...Option.getOrElse(
			Option.map(snapshot, value => value.workers ?? Array.map(value.items, item => item.worker)),
			() => []
		),
		...Array.map(shownHistories, machine => machine.worker)
	])
	const active = Option.getOrElse(Option.fromUndefinedOr(search.machine), () =>
		Option.getOrUndefined(Array.head(workers))
	)
	const history = Option.flatMap(Option.fromUndefinedOr(active), current =>
		Array.findFirst(shownHistories, machine => machine.worker === current)
	)
	// A row lights its own band, or the one band every small app joins; a selected row stays lit.
	const bandOf = Record.fromEntries(
		Array.flatMap(
			Option.getOrElse(
				Option.map(history, machine => bands(machine)),
				() => Array.empty<Band>()
			),
			(band: Band) => Array.map(band.members, member => [member, band.id] as const)
		)
	) satisfies Record<string, string>
	const rows = Option.getOrElse(
		Option.map(snapshot, value => workloads(value.items)),
		() => []
	)
	const free = Option.getOrElse(
		Option.map(snapshot, value => availablePorts(value.items)),
		() => []
	)
	const sources = Option.getOrElse(
		Option.map(snapshot, value => value.sources),
		() => []
	)
	const now = Option.getOrElse(
		Option.map(snapshot, value => value.time),
		() => 0
	)
	const activeRows = Option.match(Option.fromUndefinedOr(active), {
		onNone: () => [],
		onSome: current => Array.filter(rows, row => row.item.worker === current)
	})
	const bandNames = Record.fromEntries(
		Array.flatMap(activeRows, row =>
			Option.match(owner(row), {onNone: () => [], onSome: id => [[id, workloadName(row.item)] as const]})
		)
	) satisfies Record<string, string>
	const searchable = Array.sort(activeRows, order)
	const sorted = Array.sort(ranged(activeRows, shownMinutes, Option.getOrUndefined(history)), order)
	const selectedRow = Option.getOrUndefined(
		Option.flatMap(Option.fromUndefinedOr(search.app), current =>
			Array.findFirst(searchable, row => row.item.id === current)
		)
	)
	const selectedBand = Option.flatMap(Option.fromUndefinedOr(selectedRow), row =>
		Option.flatMap(owner(row), id => Record.get(bandOf, id))
	)
	const highlight = Option.getOrElse(Option.fromUndefinedOr(hovered), () => Option.getOrUndefined(selectedBand))
	const ranges = rangeSet(isPhone, minutes)

	function selectRow(row: ReturnType<typeof workloads>[number]) {
		view({app: row.item.id, pane: 'process'})
	}

	function backToList() {
		setHovered(undefined)
		view({pane: 'apps'})
	}

	const pushed = Boolean.match(isPhone, {onFalse: () => false, onTrue: () => pane === 'process'})

	// A phone's bar names the pushed app and backs out to the list; wider screens keep the wordmark.
	const mobileTitle = phoneTitle(pushed, selectedRow)
	return (
		<div className="flex min-h-0 flex-1 flex-col">
			<AppBar
				back={phoneBack(pushed, backToList)}
				icon={icon}
				name="deploy"
				title={mobileTitle}
				controls={<RangeControls minutes={minutes} onChange={range => view({range})} ranges={ranges} />}
				tabs={
					<MachineTabs
						active={active}
						histories={shownHistories}
						inventoryFailure={inventoryFailure}
						onChoose={() => setHovered(undefined)}
						sources={sources}
						workers={workers}
					/>
				}
			/>
			<Workspace
				active={active}
				authFailure={authFailure}
				bandOf={bandOf}
				free={free}
				history={Option.getOrUndefined(history)}
				highlight={highlight}
				isPhone={isPhone}
				labels={bandNames}
				minutes={shownMinutes}
				now={now}
				onHover={setHovered}
				onSelect={selectRow}
				pending={inventoryPending}
				pushed={pushed}
				refreshing={refreshing}
				retryFailed={retryFailed}
				rows={sorted}
				selectedApp={search.app}
				selectedRow={selectedRow}
				workers={workers}
			/>
		</div>
	)
}

export const Route = createFileRoute('/(home)/')({component: Home, validateSearch: WebRuntime.searchOf(Search)})
