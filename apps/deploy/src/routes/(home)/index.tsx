import {useAtom, useAtomRefresh, useAtomSet, useAtomSuspense, useAtomValue} from '@effect/atom-react'

import {Array, Boolean, Cause, DateTime, HashSet, Number, Option, Order, Record, Schema, String} from 'effect'

import {
	AppWindowIcon,
	CaretRightIcon,
	ChartLineIcon,
	HardDrivesIcon,
	MonitorIcon,
	PlayIcon,
	TerminalWindowIcon
} from '@phosphor-icons/react'
import {CatchBoundary, Link, createFileRoute, getRouteApi} from '@tanstack/react-router'
import {AsyncResult} from 'effect/reactivity'
import {Suspense, useDeferredValue, useState} from 'react'
import type {ReactNode} from 'react'

import {AppBar, AppBarTab, AppBarTabs} from '@deslop/components-web/app-bar'
import {otherApps} from '@deslop/components-web/command-palette'
import {Denied, EmptyState, Error, SignIn} from '@deslop/components-web/fallbacks'
import {ItemListSkeleton} from '@deslop/components-web/item-list'
import {Problem, problemSinceAtom} from '@deslop/components-web/problem'
import {ResultError} from '@deslop/components-web/result-error'
import {StatusDot} from '@deslop/components-web/status-dot'
import {Badge} from '@deslop/components-web/ui/badge'
import {Button} from '@deslop/components-web/ui/button'
import {
	ContextMenu,
	ContextMenuContent,
	ContextMenuItem,
	ContextMenuTrigger
} from '@deslop/components-web/ui/context-menu'
import {Item, ItemActions, ItemContent, ItemDescription, ItemMedia, ItemTitle} from '@deslop/components-web/ui/item'
import {ResizableHandle, ResizablePanel, ResizablePanelGroup} from '@deslop/components-web/ui/resizable'
import {ScrollArea} from '@deslop/components-web/ui/scroll-area'
import {Skeleton} from '@deslop/components-web/ui/skeleton'
import {Spinner} from '@deslop/components-web/ui/spinner'
import {Tabs, TabsList, TabsTrigger} from '@deslop/components-web/ui/tabs'
import {Tooltip, TooltipContent, TooltipProvider, TooltipTrigger} from '@deslop/components-web/ui/tooltip'
import {cn, useMediaQuery} from '@deslop/components-web/utils'
import {isDenied, needsSignIn, signInUrl} from '@deslop/runtime/auth/utils'
import * as WebRuntime from '@deslop/runtime/web'

import {MachineIcon, machineName} from '#lib/components.tsx'
import {exposeTargetAtom, hideAtom, inventoryAtom, metricsAtom, runAtom} from '#lib/utils.ts'
import {RANGES} from '#routes/(home)/-chart.ts'
import {TimeAxis, UsageChart} from '#routes/(home)/-charts.tsx'
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
import type {MachineHistory} from '#services/metrics/schema.ts'

const MACHINE_HOTKEYS = ['1', '2', '3', '4', '5', '6', '7', '8', '9'] as const

// A phone shows the list with the machine's chart above it, or one app's processes full-screen.
type Pane = typeof Pane.Type
const Pane = Schema.Literals(['apps', 'machine', 'process'])

type Metric = typeof Metric.Type
const Metric = Schema.Literals(['memory', 'cpu'])

// The view lives in the URL, so a reload, Back or a shared link reopens the same machine, app, pane, range and metric.
type Search = typeof Search.Type
const Search = Schema.Struct({
	app: Schema.optionalKey(Schema.String),
	machine: Schema.optionalKey(Schema.String),
	metric: Schema.optionalKey(Metric),
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

function needsAttention(row: ReturnType<typeof workloads>[number]) {
	const light = dot(row.item, status(row.item))
	return light === 'error' || light === 'warning'
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

function text(row: ReturnType<typeof workloads>[number]) {
	return String.toLowerCase(
		`${row.item.worker} ${row.item.name} ${Array.join(
			Array.map(row.listeners, listener => `${listener.port}`),
			' '
		)} ${Array.join(
			Array.map(row.exposures, exposure => exposure.url),
			' '
		)}`
	)
}

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

function MetricTabs(props: {metric: Metric; onChange: (metric: Metric) => void}) {
	return (
		<Tabs
			value={props.metric}
			onValueChange={(value: string) => {
				if (value === 'memory' || value === 'cpu') props.onChange(value)
			}}
		>
			<TabsList aria-label="Metric">
				<TabsTrigger value="memory">Memory</TabsTrigger>
				<TabsTrigger value="cpu">CPU</TabsTrigger>
			</TabsList>
		</Tabs>
	)
}

// The two machines as the bar's section control: its icon in the machine's colour and its name; an unreachable one keeps a dot.
function MachineTabs(props: {
	active?: string
	histories: readonly MachineHistory[]
	inventoryFailure: boolean
	onChoose: () => void
	sources: readonly {error: string; name: string}[]
	workers: readonly string[]
}) {
	return Array.match(props.workers, {
		onEmpty: () => null,
		onNonEmpty: workers => (
			<AppBarTabs value={props.active ?? workers[0]}>
				{Array.map(workers, worker => {
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
	})
}

// Ports of one least size: exposed in a solid badge that opens its endpoint, exposable in an outline that opens its dialog, the rest quiet.
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
							<Badge key={listener.id} variant="ghost">
								{listener.port}
							</Badge>
						),
						onSome: port => (
							<button
								key={listener.id}
								type="button"
								className="pointer-events-auto relative z-10"
								aria-label={`Expose ${workloadName(props.row.item)} :${listener.port}`}
								onClick={() => expose(port)}
							>
								<Badge variant="outline">{listener.port}</Badge>
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
					<Badge variant="secondary">
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

// The first port the row could expose, as its first outline badge offers.
function exposablePort(row: ReturnType<typeof workloads>[number], free: readonly InventoryItem[]) {
	const exposedPorts = HashSet.fromIterable(Array.map(row.exposures, exposure => exposure.port))
	const freePorts = Array.groupBy(free, port => port.id)
	return Array.head(
		Array.flatMap(
			Array.dedupeWith(
				Array.filter(
					row.listeners,
					listener => listener.address !== 'container' && !HashSet.has(exposedPorts, listener.port)
				),
				(first: InventoryItem, second: InventoryItem) => first.port === second.port
			),
			(listener: InventoryItem) => Array.take(freePorts[listener.id] ?? [], 1)
		)
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

// A timer's job, started now from where other rows keep their chevron.
function RunNow(props: {item: InventoryItem; onRun: () => void}) {
	return (
		<Button
			size="icon-sm"
			variant="ghost"
			className="pointer-events-auto"
			aria-label={`Run ${workloadName(props.item)} now`}
			onClick={props.onRun}
		>
			<PlayIcon />
		</Button>
	)
}

function RunFailure(props: {item: InventoryItem}) {
	return <ResultError result={useAtomValue(runAtom(props.item.id))} className="wrap-anywhere" />
}

function hideTarget(item: InventoryItem) {
	if (String.startsWith('remote:')(item.id)) return item.worker
	return ''
}

function RemoveExposure(props: {item: InventoryItem}) {
	const [result, hide] = useAtom(hideAtom(hideTarget(props.item))(props.item.name))
	return (
		<ContextMenuItem
			variant="destructive"
			className="max-sm:h-11"
			disabled={AsyncResult.isWaiting(result)}
			onClick={() => hide()}
		>
			Remove {host(props.item.url)}
		</ContextMenuItem>
	)
}

function RemoveFailure(props: {item: InventoryItem}) {
	return (
		<ResultError result={useAtomValue(hideAtom(hideTarget(props.item))(props.item.name))} className="wrap-anywhere" />
	)
}

// One app or job: its mark, name, ports or reason, and its one end action; the whole row opens its processes.
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
	const owned = Array.filter(props.row.exposures, exposure => exposure.owned === true)
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
			<ContextMenu disabled={Array.isArrayEmpty(owned)}>
				{/* Right-click or long-press removes an endpoint this app exposed. */}
				<ContextMenuTrigger
					render={
						<Item
							size="row"
							role="listitem"
							data-selected={props.selected}
							className="relative"
							onPointerEnter={() => props.onHover(Option.getOrUndefined(band))}
							onPointerLeave={() => props.onHover()}
						/>
					}
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
						<ItemTitle className="w-full" title={fullName}>
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
													<span className="text-muted-foreground shrink-0 font-mono text-xs whitespace-nowrap tabular-nums">
														{next}
													</span>
												),
												onTrue: () => (
													<span className="text-muted-foreground shrink-0 font-mono text-xs whitespace-nowrap tabular-nums">
														{Option.getOrElse(age, () => next)}
													</span>
												)
											}),
										onTrue: () => null
									})
							})}
						</span>
						<span className="flex w-7 shrink-0 items-center justify-center">
							{Boolean.match(scheduled, {
								onFalse: () => <CaretRightIcon className="text-muted-foreground size-3.5" />,
								onTrue: () =>
									Boolean.match(running, {
										onFalse: () => (
											<RunNow
												item={props.row.item}
												onRun={() => {
													setRequested(Option.some(props.now))
													run(runRequest(props.row.item))
												}}
											/>
										),
										onTrue: () => <Spinner className="size-3.5" />
									})
							})}
						</span>
					</ItemActions>
				</ContextMenuTrigger>
				<ContextMenuContent className="w-auto min-w-36">
					{Array.map(owned, exposure => (
						<RemoveExposure key={exposure.id} item={exposure} />
					))}
				</ContextMenuContent>
			</ContextMenu>
			<div className="empty:hidden">
				{scheduled && (
					<div className="px-4 sm:px-6">
						<RunFailure item={props.row.item} />
					</div>
				)}
				{Array.map(owned, exposure => (
					<div key={exposure.id} className="px-4 sm:px-6">
						<RemoveFailure item={exposure} />
					</div>
				))}
			</div>
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

function InventoryProblem() {
	const result = useAtomValue(inventoryAtom)
	const refresh = useAtomRefresh(inventoryAtom)
	const problemSince = Option.getOrUndefined(useAtomValue(problemSinceAtom(inventoryAtom)))
	if (!AsyncResult.isFailure(result) || Option.isNone(AsyncResult.value(result))) return null
	return <Problem label="Inventory out of date" warning reset={refresh} since={problemSince} />
}

function MetricsProblem(props: {minutes: HistoryQuery['minutes']}) {
	const result = useAtomValue(metricsAtom(props.minutes))
	const refresh = useAtomRefresh(metricsAtom(props.minutes))
	const problemSince = Option.getOrUndefined(useAtomValue(problemSinceAtom(metricsAtom(props.minutes))))
	if (!AsyncResult.isFailure(result) || Option.isNone(AsyncResult.value(result))) return null
	return <Problem label="History out of date" warning reset={refresh} since={problemSince} />
}

// The chart's place while it loads; its axis is real.
function ChartSkeleton(props: {minutes: HistoryQuery['minutes']}) {
	return (
		<div aria-busy="true" aria-label="Usage history" role="status" className="flex shrink-0 flex-col px-4 pt-4 sm:px-8">
			<Skeleton className="h-40 w-full sm:h-56" />
			<TimeAxis minutes={props.minutes} now={DateTime.toEpochMillis(DateTime.nowUnsafe())} />
		</div>
	)
}

// The machine's one chart: bands by app, stacked on the whole machine's 0–100% so the height says how loaded it is.
function ChartBlock(props: {
	highlight?: string
	history: MachineHistory
	labels: Record<string, string>
	metric: Metric
	minutes: HistoryQuery['minutes']
	onHover: (id?: string) => void
}) {
	const all = bands(props.history)
	return (
		<div className="flex shrink-0 flex-col px-4 pt-4 sm:px-8">
			<UsageChart
				className="h-40 sm:h-56"
				highlight={props.highlight}
				history={props.history}
				hue={appHue}
				label={Boolean.match(props.metric === 'memory', {onFalse: () => 'CPU', onTrue: () => 'Memory'})}
				layers={Array.map(all, band => ({
					...band,
					values: Boolean.match(props.metric === 'memory', {onFalse: () => band.cpu, onTrue: () => band.memory})
				}))}
				minutes={props.minutes}
				names={id => bandName(id, props.labels)}
				onHover={props.onHover}
				recorded={sample =>
					Boolean.match(props.metric === 'memory', {onFalse: () => sample.cpu !== undefined, onTrue: () => true})
				}
			/>
			<TimeAxis minutes={props.minutes} now={props.history.time} />
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

// The machine's disk as one figure; its used and total wait on the stock tooltip.
function DiskFigure(props: {history?: MachineHistory}) {
	const latest = Option.getOrUndefined(
		Option.flatMap(Option.fromUndefinedOr(props.history), history => Array.last(history.samples))
	)
	const disks = latest?.disks ?? []
	const total = Array.reduce(disks, 0, (sum, disk) => sum + disk.total)
	const used = Array.reduce(disks, 0, (sum, disk) => sum + disk.used)
	if (total === 0) return null
	return (
		<TooltipProvider delay={150}>
			<Tooltip>
				<TooltipTrigger render={<Button variant="ghost" size="sm" />}>
					disk <span className="text-foreground">{Number.round((used / total) * 100, 0)}%</span>
				</TooltipTrigger>
				<TooltipContent>
					{bytes(used)} of {bytes(total)}
				</TooltipContent>
			</Tooltip>
		</TooltipProvider>
	)
}

// The selected app's processes, or one job's, with what the row cannot show: its failure.
function ProcessList(props: {now: number; row: ReturnType<typeof workloads>[number]}) {
	const processes = props.row.item.processes ?? []
	const tree = processTree(processes)
	return (
		<>
			{Boolean.match(props.row.item.scheduled === true, {
				onFalse: () => null,
				onTrue: () => (
					<div className="px-4 pt-2 empty:hidden sm:px-8">
						<RunFailure item={props.row.item} />
					</div>
				)
			})}
			{Array.match(processes, {
				onEmpty: () => <EmptyState icon={<TerminalWindowIcon weight="light" />} label="No processes right now" />,
				onNonEmpty: () => (
					<ScrollArea className="min-h-0 flex-1">
						<Processes tree={tree} />
					</ScrollArea>
				)
			})}
		</>
	)
}

// The processes below the chart, or a phone's pushed pane; nothing selected is one symbol.
function SelectedProcesses(props: {
	app?: string
	now: number
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
								<ItemListSkeleton label="Processes loading" media rows={6} />
							</div>
						)
					}),
				onSome: row => (
					<Suspense
						fallback={
							<div className="min-h-0 flex-1 overflow-hidden">
								<ItemListSkeleton label="Processes loading" media rows={6} />
							</div>
						}
					>
						<InventoryContent>
							<ProcessList now={props.now} row={row} />
						</InventoryContent>
					</Suspense>
				)
			})}
		</div>
	)
}

// The apps on one machine: failures first, then apps by memory, then the jobs a timer starts.
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
	return (
		<div className={cn('flex min-h-0 flex-col', props.className)}>
			<Suspense
				fallback={
					<div className="min-h-0 flex-1 overflow-hidden">
						<ItemListSkeleton label="Apps loading" media rows={8} />
					</div>
				}
			>
				<InventoryContent>
					{Array.match(props.rows, {
						onEmpty: () => <EmptyState icon={<AppWindowIcon weight="light" />} label="No apps in this range" />,
						onNonEmpty: rows => (
							<ScrollArea className="min-h-0 flex-1">
								<div role="list">
									{Array.map(rows, row => (
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
							</ScrollArea>
						)
					})}
				</InventoryContent>
			</Suspense>
		</div>
	)
}

// The desktop detail: the metric choice and the disk in one header, the chart, then the chosen processes.
function DetailPane(props: {
	app?: string
	history?: MachineHistory
	hovered?: string
	labels: Record<string, string>
	metric: Metric
	minutes: HistoryQuery['minutes']
	now: number
	onHover: (id?: string) => void
	onMetric: (metric: Metric) => void
	pending: boolean
	row?: ReturnType<typeof workloads>[number]
	worker?: string
}) {
	return (
		<div className="flex h-full min-h-0 flex-col">
			<div className="flex h-12 shrink-0 items-center gap-3 border-b px-4 sm:px-8">
				<MetricTabs metric={props.metric} onChange={props.onMetric} />
				<div className="ml-auto flex items-center gap-2">
					<DiskFigure history={props.history} />
					<MetricsProblem minutes={props.minutes} />
				</div>
			</div>
			<Suspense fallback={<ChartSkeleton minutes={props.minutes} />}>
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
									labels={props.labels}
									metric={props.metric}
									minutes={props.minutes}
									onHover={props.onHover}
								/>
							)
						}
					)}
				</MetricsContent>
			</Suspense>
			<div className="flex min-h-0 flex-1 flex-col border-t">
				<SelectedProcesses app={props.app} now={props.now} pending={props.pending} row={props.row} />
			</div>
		</div>
	)
}

// A phone's list view: metric and range under the bar, the chart, then the rows edge to edge.
function PhoneList(props: {
	bandOf: Record<string, string>
	free: readonly InventoryItem[]
	history?: MachineHistory
	hovered?: string
	labels: Record<string, string>
	metric: Metric
	minutes: HistoryQuery['minutes']
	now: number
	onHover: (id?: string) => void
	onMetric: (metric: Metric) => void
	onRange: (minutes: HistoryQuery['minutes']) => void
	onSelect: (row: ReturnType<typeof workloads>[number]) => void
	rows: readonly ReturnType<typeof workloads>[number][]
	ranges: readonly {label: string; minutes: HistoryQuery['minutes']; name: string}[]
	selectedId?: string
}) {
	return (
		<div className="flex min-h-0 flex-1 flex-col">
			<div className="flex h-12 shrink-0 items-center justify-between gap-2 border-b px-4">
				<MetricTabs metric={props.metric} onChange={props.onMetric} />
				<div className="flex items-center gap-1">
					<InventoryProblem />
					<MetricsProblem minutes={props.minutes} />
				</div>
				<RangeTabs minutes={props.minutes} onChange={props.onRange} ranges={props.ranges} />
			</div>
			<Suspense fallback={<ChartSkeleton minutes={props.minutes} />}>
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
									labels={props.labels}
									metric={props.metric}
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

function SourceProblems(props: {
	onRetry: () => void
	sources: readonly {error: string; name: string}[]
	workers: readonly string[]
}) {
	return Array.match(
		Array.filter(props.sources, source => source.error !== '' && !Array.contains(props.workers, source.name)),
		{
			onEmpty: () => null,
			onNonEmpty: sources => (
				<div className="flex shrink-0 flex-wrap items-center gap-3 border-b px-4 py-2 sm:px-6">
					{Array.map(sources, source => (
						<div key={source.name} className="flex items-center gap-1.5">
							<MachineIcon worker={source.name} />
							<Problem label={`${machineName(source.name)} unreachable`} reset={props.onRetry} />
						</div>
					))}
				</div>
			)
		}
	)
}

// The palette's records and its page-wide hotkeys: one item per action, shown beside it.
function deployPalette(props: {
	active?: string
	back: () => void
	canStep: boolean
	denied: boolean
	expose: (port: InventoryItem) => void
	exposing: boolean
	free: readonly InventoryItem[]
	machines: readonly string[]
	now: number
	onGraphs: () => void
	onMachine: (worker: string) => void
	onRun: (row: ReturnType<typeof workloads>[number]) => void
	onSelect: (row: ReturnType<typeof workloads>[number]) => void
	onStep: (direction: 1 | -1) => void
	pushed: boolean
	rows: readonly ReturnType<typeof workloads>[number][]
	selectedRow?: ReturnType<typeof workloads>[number]
}) {
	if (props.denied) return [otherApps('deploy')]
	return [
		{
			items: [
				...Boolean.match(props.canStep, {
					onFalse: () => [],
					onTrue: () => [
						{hotkey: 'J' as const, label: 'Next row', run: () => props.onStep(1)},
						{hotkey: 'K' as const, label: 'Previous row', run: () => props.onStep(-1)}
					]
				}),
				...Option.match(Option.fromUndefinedOr(props.selectedRow), {
					onNone: () => [],
					onSome: row => [
						{hotkey: 'Enter' as const, label: `Open ${workloadName(row.item)}`, run: () => props.onSelect(row)}
					]
				}),
				...Boolean.match(props.pushed && !props.exposing, {
					onFalse: () => [],
					onTrue: () => [{hotkey: 'Escape' as const, label: 'Back to the list', run: props.back}]
				}),
				...Option.match(
					Option.filter(Option.fromUndefinedOr(props.selectedRow), row => row.item.scheduled === true),
					{
						onNone: () => [],
						onSome: row => [
							{hotkey: 'R' as const, label: `Run ${workloadName(row.item)} now`, run: () => props.onRun(row)}
						]
					}
				),
				...Option.match(
					Option.filter(Option.fromUndefinedOr(props.selectedRow), row => row.item.scheduled !== true),
					{
						onNone: () => [],
						onSome: row =>
							Option.match(exposablePort(row, props.free), {
								onNone: () => [],
								onSome: port => [
									{
										hotkey: 'E' as const,
										label: `Expose ${workloadName(row.item)} :${port.port}`,
										run: () => props.expose(port)
									}
								]
							})
					}
				),
				...Option.match(Option.fromUndefinedOr(props.active), {
					onNone: () => [],
					onSome: current => [
						{icon: <MonitorIcon />, label: `Open ${machineName(current)} graphs`, run: props.onGraphs}
					]
				}),
				...Option.match(Option.fromUndefinedOr(props.selectedRow), {
					onNone: () => [],
					onSome: row => [
						{icon: <HardDrivesIcon />, label: `Processes of ${workloadName(row.item)}`, run: () => props.onSelect(row)}
					]
				})
			],
			label: 'Actions'
		},
		{
			items: Array.map(Array.take(props.machines, 9), (worker, index) => ({
				hotkey: MACHINE_HOTKEYS[index],
				label: `Open ${machineName(worker)}`,
				run: () => props.onMachine(worker)
			})),
			label: 'Machines'
		},
		{
			items: Array.map(
				Array.filter(props.rows, row => needsAttention(row)),
				row => ({
					detail: reasonLine(row, props.now),
					icon: <ApplicationIcon name={workloadName(row.item)} container={row.item.kind === 'container'} />,
					id: row.item.id,
					keywords: text(row),
					label: workloadName(row.item),
					run: () => props.onSelect(row)
				})
			),
			label: 'Needs you'
		},
		{
			items: Array.map(
				Array.filter(props.rows, row => row.item.scheduled === true),
				row => ({
					detail: nextRun(row.item.next ?? props.now, props.now),
					icon: <ApplicationIcon name={workloadName(row.item)} container={row.item.kind === 'container'} />,
					id: row.item.id,
					keywords: text(row),
					label: workloadName(row.item),
					run: () => props.onSelect(row)
				})
			),
			label: 'Scheduled'
		},
		{
			items: Array.map(
				Array.filter(props.rows, row => row.item.scheduled !== true),
				row => ({
					detail: `${machineName(row.item.worker)} · ${bytes(appUsage(row.item.processes ?? []).memory)}`,
					icon: <ApplicationIcon name={workloadName(row.item)} container={row.item.kind === 'container'} />,
					id: row.item.id,
					keywords: text(row),
					label: workloadName(row.item),
					run: () => props.onSelect(row)
				})
			),
			label: 'Apps'
		},
		otherApps('deploy')
	]
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
	metric: Metric
	minutes: HistoryQuery['minutes']
	now: number
	onHover: (id?: string) => void
	onMetric: (metric: Metric) => void
	onRange: (minutes: HistoryQuery['minutes']) => void
	onSelect: (row: ReturnType<typeof workloads>[number]) => void
	pending: boolean
	pushed: boolean
	refreshing: boolean
	refreshInventory: () => void
	retryFailed: () => void
	rows: readonly ReturnType<typeof workloads>[number][]
	ranges: readonly {label: string; minutes: HistoryQuery['minutes']; name: string}[]
	selectedApp?: string
	selectedRow?: ReturnType<typeof workloads>[number]
	sources: readonly {error: string; name: string}[]
	workers: readonly string[]
}) {
	return Option.match(props.authFailure, {
		onNone: () => (
			<div className="flex min-h-0 flex-1 flex-col">
				<h1 className="sr-only">Deploy</h1>
				<SourceProblems onRetry={props.refreshInventory} sources={props.sources} workers={props.workers} />
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
										history={props.history}
										hovered={props.highlight}
										labels={props.labels}
										metric={props.metric}
										minutes={props.minutes}
										now={props.now}
										onHover={props.onHover}
										onMetric={props.onMetric}
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
										metric={props.metric}
										minutes={props.minutes}
										now={props.now}
										onHover={props.onHover}
										onMetric={props.onMetric}
										onRange={props.onRange}
										onSelect={props.onSelect}
										rows={props.rows}
										ranges={props.ranges}
										selectedId={props.selectedRow?.item.id}
									/>
								),
								onTrue: () => (
									<SelectedProcesses
										app={props.selectedApp}
										now={props.now}
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

// J and K step the list's selection, wrapping at either end.
function nextRow(
	entries: readonly ReturnType<typeof workloads>[number][],
	direction: 1 | -1,
	selected?: ReturnType<typeof workloads>[number]
) {
	const index = Option.getOrUndefined(
		Option.flatMap(Option.fromUndefinedOr(selected), row =>
			Array.findFirstIndex(entries, candidate => candidate.item.id === row.item.id)
		)
	)
	if (index === undefined) {
		return Boolean.match(direction === 1, {onFalse: () => Array.last(entries), onTrue: () => Array.head(entries)})
	}
	return Array.get(entries, (index + direction + entries.length) % entries.length)
}

// The bar's range and the inventory's staleness, on the wide screen where the bar has room for both.
function RangeControls(props: {
	isPhone: boolean
	minutes: HistoryQuery['minutes']
	onChange: (minutes: HistoryQuery['minutes']) => void
}) {
	if (props.isPhone) return null
	return (
		<div className="flex items-center gap-1">
			<RangeTabs minutes={props.minutes} onChange={props.onChange} ranges={RANGES} />
			<InventoryProblem />
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
	const metric = search.metric ?? 'memory'
	// The charts keep the last loaded range, dimmed, until the one the URL asks for arrives.
	const shownMinutes = useDeferredValue(minutes)
	const pane = search.pane ?? 'apps'
	const [hovered, setHovered] = useState<string>()
	const inventory = useAtomValue(inventoryAtom)
	const metrics = useAtomValue(metricsAtom(shownMinutes))
	useAtomValue(problemSinceAtom(inventoryAtom))
	useAtomValue(problemSinceAtom(metricsAtom(shownMinutes)))
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

	function chooseRow(row: ReturnType<typeof workloads>[number]) {
		view({app: row.item.id})
	}

	function backToList() {
		setHovered(undefined)
		view({pane: 'apps'})
	}

	function chooseMachine(worker: string) {
		setHovered(undefined)
		view({app: undefined, machine: worker, pane: 'apps'})
	}

	const expose = useExpose()
	const exposing = Option.isSome(useAtomValue(exposeTargetAtom))
	const runSelected = useAtomSet(
		runAtom(
			Option.getOrElse(
				Option.map(Option.fromUndefinedOr(selectedRow), row => row.item.id),
				() => ''
			)
		)
	)
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
				palette={deployPalette({
					active,
					back: backToList,
					canStep: Array.isArrayNonEmpty(sorted),
					denied: Option.isSome(authFailure),
					expose,
					exposing,
					free,
					machines: workers,
					now,
					onGraphs: () => view({app: undefined, pane: 'machine'}),
					onMachine: chooseMachine,
					onRun: row => runSelected(runRequest(row.item)),
					onSelect: selectRow,
					onStep: direction => {
						Option.match(nextRow(sorted, direction, selectedRow), {onNone: () => undefined, onSome: chooseRow})
					},
					pushed,
					rows: searchable,
					selectedRow
				})}
				controls={<RangeControls isPhone={isPhone} minutes={minutes} onChange={range => view({range})} />}
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
				metric={metric}
				minutes={shownMinutes}
				now={now}
				onHover={setHovered}
				onMetric={next => view({metric: next})}
				onRange={range => view({range})}
				onSelect={selectRow}
				pending={inventoryPending}
				pushed={pushed}
				refreshing={refreshing}
				refreshInventory={refreshInventory}
				retryFailed={retryFailed}
				rows={sorted}
				ranges={ranges}
				selectedApp={search.app}
				selectedRow={selectedRow}
				sources={sources}
				workers={workers}
			/>
		</div>
	)
}

export const Route = createFileRoute('/(home)/')({component: Home, validateSearch: WebRuntime.searchOf(Search)})
