import {useAtom, useAtomRefresh, useAtomSuspense, useAtomValue} from '@effect/atom-react'

import {Array, Boolean, Cause, HashSet, Match, Number, Option, Order, Record, Schema, String, pipe} from 'effect'

import {CaretRightIcon, ClockIcon, MonitorIcon, PlayIcon, HardDrivesIcon} from '@phosphor-icons/react'
import {CatchBoundary, createFileRoute, getRouteApi} from '@tanstack/react-router'
import {AsyncResult} from 'effect/reactivity'
import {Suspense, useDeferredValue, useState} from 'react'
import type {ReactNode} from 'react'

import {AppBar} from '@deslop/components-web/app-bar'
import {otherApps} from '@deslop/components-web/command-palette'
import {Error, SignIn} from '@deslop/components-web/fallbacks'
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
import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuLabel,
	DropdownMenuRadioGroup,
	DropdownMenuRadioItem,
	DropdownMenuSeparator,
	DropdownMenuTrigger
} from '@deslop/components-web/ui/dropdown-menu'
import {Empty, EmptyHeader, EmptyTitle} from '@deslop/components-web/ui/empty'
import {useIsMobile} from '@deslop/components-web/ui/hooks/use-mobile'
import {Progress, ProgressLabel} from '@deslop/components-web/ui/progress'
import {Skeleton} from '@deslop/components-web/ui/skeleton'
import {Spinner} from '@deslop/components-web/ui/spinner'
import {ToggleGroup, ToggleGroupItem} from '@deslop/components-web/ui/toggle-group'
import {cn} from '@deslop/components-web/utils'
import {isDenied, needsSignIn, signInUrl} from '@deslop/runtime/auth/utils'
import * as WebRuntime from '@deslop/runtime/web'

import {MachineIcon, machineName} from '#lib/components.tsx'
import {hideAtom, inventoryAtom, metricsAtom, runAtom} from '#lib/utils.ts'
import {RANGES} from '#routes/(home)/-chart.ts'
import {Cores, TimeAxis, UsageChart} from '#routes/(home)/-charts.tsx'
import {useExpose} from '#routes/(home)/-expose.tsx'
import {ApplicationIcon} from '#routes/(home)/-marks.tsx'
import {appUsage, processTree} from '#routes/(home)/-process-tree.ts'
import {Processes} from '#routes/(home)/-processes.tsx'
import {bands} from '#routes/(home)/-usage.ts'
import type {Band} from '#routes/(home)/-usage.ts'
import icon from '#routes/icon.svg'
import {availablePorts, itemOwner, workloadName, workloads} from '#services/inventory/lib/utils.ts'
import type {InventoryItem, Process} from '#services/inventory/schema.ts'
import {chartWindow} from '#services/metrics/lib/utils.ts'
import {HistoryQuery} from '#services/metrics/schema.ts'
import type {MachineHistory} from '#services/metrics/schema.ts'

// A phone shows one pane at a time; a wide screen shows all three and ignores it.
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

function dot(item: InventoryItem, state: string) {
	if (Option.isSome(String.match(/failed|unhealthy|Exited \([1-9]/u)(item.state + item.detail))) return 'error'
	if (state === 'stale' || state === 'public permission' || state === 'restarting') return 'warning'
	if (Option.isSome(String.match(/running|online|listening|activating/u)(state))) return 'live'
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

function bytes(value: number) {
	if (value >= 1024 ** 4) return `${size.format(value / 1024 ** 4)} TiB`
	if (value >= 1024 ** 3) return `${size.format(value / 1024 ** 3)} GiB`
	return `${size.format(value / 1024 ** 2)} MiB`
}

// The highest total of one metric's stacked bands over the range, in the same percentage the chart draws.
function peakOf(layers: readonly {values: readonly number[]}[]) {
	return Array.reduce(
		Array.makeBy(
			Array.reduce(layers, 0, (longest, layer) => Number.max(longest, layer.values.length)),
			index => Array.reduce(layers, 0, (sum, layer) => sum + (layer.values[index] ?? 0))
		),
		0,
		(highest, value) => Number.max(highest, value)
	)
}

// The key a service or container's usage history is recorded under; loose ports have none.
function owner(row: ReturnType<typeof workloads>[number]) {
	return Option.map(
		Option.liftPredicate(row.item, item => item.kind === 'service' || item.kind === 'container'),
		itemOwner
	)
}

// The reason a row needs a look, or null for a healthy one.
function reasonOf(row: ReturnType<typeof workloads>[number], now: number) {
	return Option.match(Option.fromUndefinedOr(row.item.failure), {
		onNone: () => row.item.detail,
		onSome: stop =>
			Option.match(Option.fromUndefinedOr(stop.at), {
				onNone: () => stop.reason,
				onSome: at => `${stop.reason} · ${since(at, now)}`
			})
	})
}

// An app or job in trouble leads; then the apps, heaviest first; what a timer starts follows the apps it serves.
const order = Order.combine(
	Order.combine(
		Order.mapInput(Order.Number, (row: ReturnType<typeof workloads>[number]) =>
			pipe(
				Match.value(dot(row.item, status(row.item))),
				Match.when('error', () => 0),
				Match.when('warning', () => 1),
				Match.orElse(() => 2)
			)
		),
		Order.mapInput(Order.Boolean, (row: ReturnType<typeof workloads>[number]) => row.item.scheduled === true)
	),
	Order.mapInput(
		Order.flip(Order.Number),
		(row: ReturnType<typeof workloads>[number]) => appUsage(row.item.processes ?? []).memory
	)
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

// Port chips of one least width: exposed filled in the machine's hue, unexposed neutral; a public endpoint reads as its whole hostname.
function Endpoint(props: {item: InventoryItem}) {
	return (
		<Badge
			variant="default"
			className="machine-metric min-w-port relative font-mono tabular-nums max-sm:overflow-visible"
			render={
				<a
					href={props.item.url}
					aria-label={`${Boolean.match(props.item.publicAccess === true, {onFalse: () => 'Tailnet', onTrue: () => 'Public'})} ${props.item.url}`}
					target="_blank"
					rel="noreferrer"
					title={props.item.url}
				/>
			}
		>
			<span aria-hidden className="absolute inset-x-0 -inset-y-3 sm:hidden" />
			<span>
				{Boolean.match(props.item.publicAccess === true, {
					onFalse: () => `:${props.item.port}`,
					onTrue: () => String.replace(/^https:\/\//u, '')(props.item.url)
				})}
			</span>
		</Badge>
	)
}

// A row's ports: an unexposed reachable one opens its Expose dialog, and every exposure leads to its endpoint.
function Endpoints(props: {free: readonly InventoryItem[]; row: ReturnType<typeof workloads>[number]}) {
	const expose = useExpose()
	return (
		<>
			{Array.map(
				Array.dedupeWith(
					Array.filter(
						props.row.listeners,
						listener =>
							listener.address !== 'container' &&
							!Array.some(props.row.exposures, exposure => exposure.port === listener.port)
					),
					(first: InventoryItem, second: InventoryItem) => first.port === second.port
				),
				listener =>
					Option.match(
						Array.findFirst(props.free, port => port.id === listener.id),
						{
							onNone: () => (
								<Badge key={listener.id} variant="secondary" className="min-w-port font-mono tabular-nums">
									:{listener.port}
								</Badge>
							),
							onSome: port => (
								<Badge
									key={listener.id}
									variant="secondary"
									className="min-w-port relative font-mono tabular-nums max-sm:overflow-visible"
									render={
										<button
											type="button"
											aria-label={`Expose ${workloadName(props.row.item)} :${listener.port}`}
											onClick={() => expose(port)}
										/>
									}
								>
									<span aria-hidden className="absolute inset-x-0 -inset-y-3 sm:hidden" />:{listener.port}
								</Badge>
							)
						}
					)
			)}
			{Array.map(props.row.exposures, exposure => (
				<Endpoint key={exposure.id} item={exposure} />
			))}
		</>
	)
}

// A timer's job, started now from where other rows keep their chevron; its failure shows on the row.
function RunNow(props: {busy: boolean; item: InventoryItem; onRun: () => void}) {
	const [result, run] = useAtom(runAtom(props.item.id))
	const working = props.busy || AsyncResult.isWaiting(result)
	return (
		<Button
			size="icon-xs"
			variant="ghost"
			className="relative shrink-0 max-sm:size-11"
			aria-label={Boolean.match(working, {
				onFalse: () => `Run ${workloadName(props.item)} now`,
				onTrue: () => `${workloadName(props.item)} is running`
			})}
			disabled={working}
			onClick={() => {
				props.onRun()
				run({
					name: props.item.name,
					scope: props.item.scope ?? 'system',
					...Boolean.match(String.startsWith('remote:')(props.item.id), {
						onFalse: () => ({}),
						onTrue: () => ({target: props.item.worker})
					})
				})
			}}
		>
			{Boolean.match(working, {onFalse: () => <PlayIcon />, onTrue: () => <Spinner />})}
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

// The row's menu item for one exposure this app made; its failure shows on the row.
function RemoveExposure(props: {item: InventoryItem}) {
	const [result, hide] = useAtom(hideAtom(hideTarget(props.item))(props.item.name))
	return (
		<ContextMenuItem variant="destructive" disabled={AsyncResult.isWaiting(result)} onClick={() => hide()}>
			Remove {String.replace(/^https:\/\//u, '')(props.item.url)}
		</ContextMenuItem>
	)
}

function RemoveFailure(props: {item: InventoryItem}) {
	return (
		<ResultError result={useAtomValue(hideAtom(hideTarget(props.item))(props.item.name))} className="wrap-anywhere" />
	)
}

// A long container name keeps its distinguishing end on a phone, short enough to fit the row.
function middle(value: string) {
	if (String.length(value) <= 28) return value
	return `${String.slice(0, 7)(value)}…${String.slice(-7)(value)}`
}

// One app in the list: its mark, name, ports or reason, its memory, its chart swatch and light, and the whole row opens.
function AppListRow(props: {
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
	const processes = props.row.item.processes ?? []
	const state = status(props.row.item)
	const light = dot(props.row.item, state)
	const scheduled = props.row.item.scheduled === true
	const owned = Array.filter(props.row.exposures, exposure => exposure.owned === true)
	const reason = reasonOf(props.row, props.now)
	const running =
		Option.isSome(String.match(/^(?:activating|deactivating|active · running)/u)(props.row.item.state)) ||
		Option.exists(requested, at => props.now - at < 10_000)
	const process = Option.getOrUndefined(
		Option.map(
			Array.head(
				Array.sort(
					processes,
					Order.mapInput(Order.flip(Order.Number), (entry: Process) => entry.memory)
				)
			),
			entry => entry.name
		)
	)
	// A job is no chart band of its own, so hovering the shared band of small apps never lights the jobs.
	const band = Option.filter(
		Option.flatMap(owner(props.row), id => Record.get(props.bandOf, id)),
		() => !scheduled
	)
	const highlighted = Option.exists(band, id => props.hovered === id)
	const fullName = workloadName(props.row.item)
	const name = Boolean.match(props.compact, {onFalse: () => fullName, onTrue: () => middle(fullName)})
	const next = Boolean.match(running, {
		onFalse: () => nextRun(props.row.item.next ?? props.now, props.now),
		onTrue: () => 'running'
	})
	return (
		<>
			<ContextMenu disabled={Array.isArrayEmpty(owned)}>
				{/* Right-click or long-press removes an endpoint this app exposed. */}
				<ContextMenuTrigger
					render={
						<div
							role="listitem"
							className={cn(
								'hover:bg-muted/50 focus-within:ring-ring/30 relative flex h-8 min-w-0 items-center gap-2 overflow-hidden border-b px-3 focus-within:ring-2 focus-within:ring-inset max-sm:h-11',
								highlighted && 'bg-muted/60',
								props.selected && 'bg-secondary'
							)}
							onPointerEnter={() => props.onHover(Option.getOrUndefined(band))}
							onPointerLeave={() => props.onHover()}
						/>
					}
				>
					<Button
						variant="ghost"
						size="sm"
						aria-label={`Open ${fullName}`}
						className="absolute inset-0 h-full w-full rounded-sm p-0"
						onClick={props.onSelect}
					/>
					<span
						className={cn(
							'pointer-events-none relative z-10 flex min-w-0 flex-1 items-center gap-2',
							scheduled && 'opacity-60'
						)}
					>
						<ApplicationIcon name={fullName} process={process} container={props.row.item.kind === 'container'} />
						<span className="min-w-0 flex-1 truncate text-sm font-medium" title={fullName}>
							{name}
						</span>
						{scheduled && (
							<span className="text-muted-foreground flex shrink-0 items-center gap-1 font-mono text-xs">
								<ClockIcon className="size-3" />
								{next}
							</span>
						)}
						<span
							className={cn(
								'pointer-events-auto flex max-w-1/2 shrink-0 items-center justify-end gap-1 max-sm:h-11',
								props.row.item.scheduled === true && 'text-muted-foreground'
							)}
						>
							{Boolean.match(light === 'error' || light === 'warning', {
								onFalse: () => <Endpoints free={props.free} row={props.row} />,
								onTrue: () => (
									<span
										className={cn(
											'truncate text-xs',
											Boolean.match(light === 'error', {
												onFalse: () => 'text-warning',
												onTrue: () => 'text-destructive'
											})
										)}
										title={reason}
									>
										{reason}
									</span>
								)
							})}
						</span>
						{/* Only a problem earns a dot; a healthy row says nothing more. */}
						{(light === 'error' || light === 'warning') && (
							<span
								title={state}
								aria-label={state}
								role="img"
								className="flex size-3 shrink-0 items-center justify-center"
							>
								<StatusDot status={light} />
							</span>
						)}
					</span>
					<span
						className={cn(
							'pointer-events-auto relative z-10 flex size-4 shrink-0 items-center justify-center',
							scheduled && 'max-sm:size-11'
						)}
					>
						{Boolean.match(scheduled, {
							onFalse: () => <CaretRightIcon className="text-muted-foreground size-3.5" />,
							onTrue: () => (
								<RunNow busy={running} item={props.row.item} onRun={() => setRequested(Option.some(props.now))} />
							)
						})}
					</span>
				</ContextMenuTrigger>
				<ContextMenuContent className="w-auto min-w-36">
					{Array.map(owned, exposure => (
						<RemoveExposure key={exposure.id} item={exposure} />
					))}
				</ContextMenuContent>
			</ContextMenu>
			<div className="pl-9 empty:hidden">
				{scheduled && <RunFailure item={props.row.item} />}
				{Array.map(owned, exposure => (
					<RemoveFailure key={exposure.id} item={exposure} />
				))}
			</div>
		</>
	)
}

// Sign-in or an error replaces content, never the bar.
function FailureContent(props: {error: unknown; reset: () => void}) {
	if (needsSignIn(props.error)) return <SignIn href={signInUrl(location.href)} />
	if (isDenied(props.error)) return <Error error={props.error} label="Access denied" reset={props.reset} />
	return <Error error={props.error} reset={props.reset} />
}

// Readers suspend below real headers. A partial outage keeps its last data; first-read errors stay local.
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
	return <Problem className="ml-auto" label="Inventory out of date" warning reset={refresh} since={problemSince} />
}

function MetricsProblem(props: {minutes: HistoryQuery['minutes']}) {
	const result = useAtomValue(metricsAtom(props.minutes))
	const refresh = useAtomRefresh(metricsAtom(props.minutes))
	const problemSince = Option.getOrUndefined(useAtomValue(problemSinceAtom(metricsAtom(props.minutes))))
	if (!AsyncResult.isFailure(result) || Option.isNone(AsyncResult.value(result))) return null
	return <Problem className="ml-auto" label="History out of date" warning reset={refresh} since={problemSince} />
}

function ChartSkeleton() {
	return (
		<div aria-busy="true" role="status" aria-label="Usage history" className="flex min-h-0 flex-1 flex-col gap-4 p-3">
			<Skeleton className="h-4 w-1/3" />
			<Skeleton className="min-h-40 flex-1" />
			<Skeleton className="min-h-36 flex-1" />
			<Skeleton className="h-3 w-full" />
		</div>
	)
}

// The apps on one machine, failures first; jobs keep their row at the end.
function AppsPane(props: {
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
		<section
			aria-label="Apps"
			className={cn('pb-safe-bottom flex min-h-0 flex-col overflow-x-hidden overflow-y-auto', props.className)}
		>
			<header className="bg-background sticky top-0 z-20 flex h-8 shrink-0 items-center gap-2 border-b px-3 max-sm:h-11">
				<span className="text-sm font-semibold">Apps</span>
				<InventoryProblem />
			</header>
			<Suspense fallback={<ItemListSkeleton label="Apps" media rowClassName="gap-2 px-3" rows={8} />}>
				<InventoryContent>
					{Array.match(props.rows, {
						onEmpty: () => (
							<Empty>
								<EmptyHeader>
									<EmptyTitle>No apps in this range</EmptyTitle>
								</EmptyHeader>
							</Empty>
						),
						onNonEmpty: () => (
							<div role="list">
								{Array.map(apps, row => (
									<AppListRow
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
								{Array.isReadonlyArrayNonEmpty(jobs) && (
									<div className="bg-background text-muted-foreground sticky top-8 z-10 flex h-8 shrink-0 items-center border-b px-3 text-xs max-sm:top-11">
										Scheduled
									</div>
								)}
								{Array.map(jobs, row => (
									<AppListRow
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
					})}
				</InventoryContent>
			</Suspense>
		</section>
	)
}

// The selected app's processes, or a job's, with what the row cannot show: its state, ports and memory.
function ProcessPane(props: {
	className?: string
	now: number
	row?: ReturnType<typeof workloads>[number]
	showName?: boolean
}) {
	const state = Option.match(Option.fromUndefinedOr(props.row), {
		onNone: () => '',
		onSome: current => status(current.item)
	})
	const light = Option.match(Option.fromUndefinedOr(props.row), {
		onNone: () => 'quiet' as const,
		onSome: current => dot(current.item, state)
	})
	const processes = props.row?.item.processes ?? []
	const process = Option.getOrUndefined(
		Option.map(
			Array.head(
				Array.sort(
					processes,
					Order.mapInput(Order.flip(Order.Number), (entry: Process) => entry.memory)
				)
			),
			entry => entry.name
		)
	)
	return (
		<section
			aria-label="Processes"
			className={cn('pb-safe-bottom flex min-h-0 flex-col overflow-y-auto', props.className)}
		>
			<header className="bg-background sticky top-0 z-20 flex h-8 shrink-0 items-center gap-2 border-b px-3 max-sm:h-11">
				{Option.match(
					Option.filter(Option.fromUndefinedOr(props.row), () => props.showName !== false),
					{
						onNone: () => <span className="flex-1 text-sm font-semibold">Processes</span>,
						onSome: current => (
							<>
								<ApplicationIcon
									name={workloadName(current.item)}
									process={process}
									container={current.item.kind === 'container'}
								/>
								<span className="min-w-0 flex-1 truncate text-sm font-semibold">{workloadName(current.item)}</span>
							</>
						)
					}
				)}
				{props.row !== undefined && (
					<>
						{(light === 'error' || light === 'warning') && (
							<span
								title={state}
								aria-label={state}
								role="img"
								className="flex size-3 shrink-0 items-center justify-center"
							>
								<StatusDot status={light} />
							</span>
						)}
						{props.row.item.scheduled === true && (
							<span className="text-muted-foreground shrink-0 font-mono text-xs whitespace-nowrap">
								{nextRun(props.row.item.next ?? props.now, props.now)}
							</span>
						)}
					</>
				)}
				<InventoryProblem />
			</header>
			<Suspense fallback={<ItemListSkeleton label="Processes" media rowClassName="gap-2 px-3" rows={5} />}>
				<InventoryContent>
					{Option.match(Option.fromUndefinedOr(props.row), {
						onNone: () => (
							<Empty>
								<EmptyHeader>
									<EmptyTitle>Select an app</EmptyTitle>
								</EmptyHeader>
							</Empty>
						),
						onSome: current => (
							<>
								{current.item.scheduled === true && (
									<div className="px-3 pt-2">
										<RunFailure item={current.item} />
									</div>
								)}
								{Array.match(processes, {
									onEmpty: () => (
										<Empty>
											<EmptyHeader>
												<EmptyTitle>No processes right now</EmptyTitle>
											</EmptyHeader>
										</Empty>
									),
									onNonEmpty: () => <Processes tree={processTree(processes)} />
								})}
							</>
						)
					})}
				</InventoryContent>
			</Suspense>
		</section>
	)
}

// A machine's graphs, on its own hue, at the range the bar carries.
function MachinePane(props: {
	available: boolean
	className?: string
	history?: MachineHistory
	hovered?: string
	labels: Record<string, string>
	minutes: HistoryQuery['minutes']
	onHover: (id?: string) => void
	worker?: string
}) {
	return (
		<section
			aria-label="Machine"
			className={cn('pb-safe-bottom flex min-h-0 flex-col overflow-y-auto', props.className)}
		>
			<header className="bg-background sticky top-0 z-20 flex h-8 shrink-0 items-center gap-2 border-b px-3 max-sm:h-11">
				{props.worker !== undefined && <MachineIcon worker={props.worker} />}
				<span className="text-sm font-semibold">Machine</span>
				<MetricsProblem minutes={props.minutes} />
				{props.worker !== undefined && !props.available && (
					<span role="img" aria-label="Unavailable" className="flex size-3 items-center justify-center">
						<StatusDot status="off" />
					</span>
				)}
			</header>
			<Suspense fallback={<ChartSkeleton />}>
				<MetricsContent minutes={props.minutes}>
					{Option.match(Option.fromUndefinedOr(props.history), {
						onNone: () => (
							<Empty>
								<EmptyHeader>
									<EmptyTitle>
										{Option.match(Option.fromUndefinedOr(props.worker), {
											onNone: () => 'No machine',
											onSome: () => 'No readings in this range'
										})}
									</EmptyTitle>
								</EmptyHeader>
							</Empty>
						),
						onSome: history => {
							const latest = Option.getOrUndefined(Array.last(history.samples))
							const all = bands(history)
							const storage = {
								total: Array.reduce(latest?.disks ?? [], 0, (sum, disk) => sum + disk.total),
								used: Array.reduce(latest?.disks ?? [], 0, (sum, disk) => sum + disk.used)
							}
							const names = Record.fromEntries([['other', 'Small apps'] as const, ['system', 'System'] as const])
							const memoryTotal = latest?.memoryTotal ?? 0
							const memoryPeak = peakOf(Array.map(all, band => ({values: band.memory})))
							const cpuPeak = peakOf(Array.map(all, band => ({values: band.cpu})))
							const memory = Option.map(Option.fromUndefinedOr(latest?.memoryUsed), value =>
								Boolean.match(memoryTotal > 0, {
									onFalse: () => bytes(value),
									onTrue: () => `${bytes(value)} · peak ${bytes((memoryPeak / 100) * memoryTotal)}`
								})
							)
							const cpu = Option.map(
								Option.fromUndefinedOr(latest?.cpu),
								value => `${size.format(value)}% · peak ${size.format(cpuPeak)}%`
							)
							const memoryTop = Array.take(
								Array.sort(
									Array.filter(all, band => band.kind === 'app'),
									Order.mapInput(Order.flip(Order.Number), (band: Band) =>
										Option.getOrElse(Array.last(band.memory), () => 0)
									)
								),
								3
							)
							function bandName(id: string) {
								return (
									names[id] ??
									props.labels[id] ??
									String.replaceAll(
										/^service:[a-z]+:(?:deslop-)?|\.service$/gu,
										''
									)(String.replace(/^container:/u, 'container ')(id))
								)
							}
							return (
								<div className="flex min-h-0 flex-1 flex-col gap-4 px-3 pt-3 pb-3">
									<div className="flex flex-wrap gap-x-3 gap-y-1 text-xs">
										{Array.map([...memoryTop, ...Array.filter(all, band => band.kind !== 'app')], band => (
											<span key={band.id} className="flex min-w-0 items-center gap-1.5">
												<span
													className="size-2 shrink-0 rounded-sm bg-(--machine) opacity-(--swatch-opacity)"
													style={{'--swatch-opacity': band.opacity}}
												/>
												<span className="text-muted-foreground max-w-40 truncate" title={bandName(band.id)}>
													{bandName(band.id)}
												</span>
												<span className="font-mono tabular-nums">
													{size.format(Option.getOrElse(Array.last(band.memory), () => 0))}%
												</span>
											</span>
										))}
									</div>
									<UsageChart
										className="min-h-40 flex-1"
										history={history}
										minutes={props.minutes}
										hovered={props.hovered}
										label="Memory"
										layers={Array.map(all, band => ({...band, values: band.memory}))}
										names={bandName}
										onHover={props.onHover}
										recorded={() => true}
										value={Option.getOrUndefined(memory)}
									/>
									<UsageChart
										className="min-h-36 flex-1"
										history={history}
										minutes={props.minutes}
										hovered={props.hovered}
										label="CPU"
										layers={Array.map(all, band => ({...band, values: band.cpu}))}
										names={bandName}
										onHover={props.onHover}
										recorded={sample => sample.cpu !== undefined}
										value={Option.getOrUndefined(cpu)}
									/>
									<TimeAxis history={history} minutes={props.minutes} />
									{Boolean.match(storage.total > 0, {
										onFalse: () => null,
										onTrue: () => (
											// The bar alone says how full the disks are; the figures wait on hover.
											<div className="machine-metric" title={`${bytes(storage.used)} of ${bytes(storage.total)}`}>
												<Progress value={(storage.used / storage.total) * 100}>
													<ProgressLabel>Disk</ProgressLabel>
												</Progress>
											</div>
										)
									})}
									<Cores history={history} />
								</div>
							)
						}
					})}
				</MetricsContent>
			</Suspense>
		</section>
	)
}

// The two machines as one split at the top: their names, their size, and whether they answer.
function MachineStrip(props: {
	active?: string
	histories: readonly MachineHistory[]
	inventoryFailure: boolean
	onSelect: (worker: string) => void
	pending: boolean
	sources: readonly {error: string; name: string}[]
	workers: readonly string[]
}) {
	return Array.match(props.workers, {
		onEmpty: () => (
			<div className="flex h-12 shrink-0 items-center gap-3 border-b px-3">
				{props.pending && (
					<>
						<Skeleton className="size-4" />
						<Skeleton className="h-4 w-24" />
						<Skeleton className="h-3 w-32" />
					</>
				)}
			</div>
		),
		onNonEmpty: workers => (
			<ToggleGroup
				aria-label="Machines"
				className="border-border h-12 w-full shrink-0 rounded-none border-b"
				spacing={0}
				value={Option.toArray(Option.fromUndefinedOr(props.active))}
				onValueChange={values => props.onSelect(values[0] ?? props.active ?? workers[0])}
			>
				{Array.map(workers, worker => {
					const history = Array.findFirst(props.histories, machine => machine.worker === worker)
					const latest = Option.getOrUndefined(Option.flatMap(history, machine => Array.last(machine.samples)))
					const failed = failedFor(worker, props.inventoryFailure, props.sources, Option.getOrUndefined(history))
					return (
						<ToggleGroupItem
							key={worker}
							value={worker}
							data-machine={machineName(worker)}
							className={cn(
								'machine flex h-full min-w-0 flex-1 items-center justify-start gap-2 rounded-none border-b-2 px-3 text-left',
								Boolean.match(props.active === worker && workers.length > 1, {
									onFalse: () => 'border-transparent hover:bg-muted/40',
									onTrue: () => 'border-b-(--machine) bg-muted/40'
								})
							)}
						>
							<MachineIcon worker={worker} />
							<span className="max-w-1/2 shrink-0 truncate text-sm font-medium">{machineName(worker)}</span>
							{/* Only an unreachable machine is marked; one that answers needs no dot. */}
							{failed && (
								<span role="img" aria-label="Unavailable" className="flex size-3 shrink-0 items-center justify-center">
									<StatusDot status="off" />
								</span>
							)}
							<span className="text-muted-foreground min-w-0 flex-1 truncate font-mono text-xs">
								{Array.join(
									[
										...Boolean.match(Array.isReadonlyArrayNonEmpty(latest?.cores ?? []), {
											onFalse: () => [],
											onTrue: () => [`${latest?.cores?.length} cores`]
										}),
										...Boolean.match(latest === undefined, {
											onFalse: () => [bytes(latest?.memoryTotal ?? 0)],
											onTrue: () => []
										})
									],
									' · '
								)}
							</span>
						</ToggleGroupItem>
					)
				})}
			</ToggleGroup>
		)
	})
}

// The bar's range: one chip, the five ranges, the page's one control for both lists.
function RangeMenu(props: {
	minutes: HistoryQuery['minutes']
	onChange: (minutes: HistoryQuery['minutes']) => void
	pending: boolean
}) {
	const label = Option.match(
		Array.findFirst(RANGES, range => range.minutes === props.minutes),
		{onNone: () => '', onSome: range => range.label}
	)
	return (
		<DropdownMenu>
			<DropdownMenuTrigger
				render={<Button variant="ghost" size="sm" className="font-mono max-sm:h-11" />}
				aria-label="History range"
			>
				{Boolean.match(props.pending, {onFalse: () => <ClockIcon className="size-3.5" />, onTrue: () => <Spinner />})}
				{label}
			</DropdownMenuTrigger>
			<DropdownMenuContent align="end" className="w-auto min-w-32">
				<DropdownMenuRadioGroup
					value={`${props.minutes}`}
					onValueChange={value =>
						Option.match(
							Array.findFirst(RANGES, range => `${range.minutes}` === value),
							{onNone: () => undefined, onSome: range => props.onChange(range.minutes)}
						)
					}
				>
					<DropdownMenuLabel>History range</DropdownMenuLabel>
					<DropdownMenuSeparator />
					{Array.map(RANGES, range => (
						<DropdownMenuRadioItem key={range.minutes} value={`${range.minutes}`} closeOnClick>
							{range.label}
						</DropdownMenuRadioItem>
					))}
				</DropdownMenuRadioGroup>
			</DropdownMenuContent>
		</DropdownMenu>
	)
}

function Home() {
	const isMobile = useIsMobile()
	const search = route.useSearch()
	const navigate = route.useNavigate()
	function view(next: Partial<Search>) {
		navigate({search: previous => ({...previous, ...next})})
	}
	const minutes = search.range ?? 60
	// The charts keep the last loaded range, dimmed, until the one the URL asks for arrives.
	const shownMinutes = useDeferredValue(minutes)
	const pane = search.pane ?? 'apps'
	const [machineBack, setMachineBack] = useState<Pane>('apps')
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
	// A revoked session must show the sign-in even while the last snapshot is still cached; only other errors keep the panes.
	const authFailure = Option.orElse(Option.filter(AsyncResult.error(inventory), isDenied), () =>
		Option.filter(AsyncResult.error(metrics), isDenied)
	)
	const refreshing = shownMinutes !== minutes

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
	// A row lights its own band, or the one band every small app joins.
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
	const selectedRow = Option.getOrElse(
		Option.orElse(
			Option.flatMap(Option.fromUndefinedOr(search.app), current =>
				Array.findFirst(searchable, row => row.item.id === current)
			),
			() => Array.head(sorted)
		),
		() => undefined
	)
	const activeAvailable = Option.match(Option.fromUndefinedOr(active), {
		onNone: () => false,
		onSome: current => !failedFor(current, inventoryFailure, sources, Option.getOrUndefined(history))
	})

	function selectRow(row: ReturnType<typeof workloads>[number]) {
		view({app: row.item.id, pane: 'process'})
	}

	function selectWorker(next: string) {
		setHovered(undefined)
		view({
			app: undefined,
			machine: next,
			pane: Boolean.match(pane === 'machine', {onFalse: () => 'apps' as const, onTrue: () => 'machine' as const})
		})
	}

	function showMachine() {
		setMachineBack(Boolean.match(pane === 'machine', {onFalse: () => pane, onTrue: () => machineBack}))
		view({pane: 'machine'})
	}

	return (
		<div className="flex min-h-0 flex-1 flex-col">
			<AppBar
				icon={icon}
				name="deploy"
				title={Boolean.match(isMobile, {
					onFalse: () => undefined,
					onTrue: () =>
						pipe(
							Match.value(pane),
							Match.when('process', () =>
								Option.match(Option.fromUndefinedOr(selectedRow), {
									onNone: () => 'Processes',
									onSome: row => workloadName(row.item)
								})
							),
							Match.when('machine', () =>
								Option.match(Option.fromUndefinedOr(active), {onNone: () => 'Machine', onSome: machineName})
							),
							Match.orElse(() => 'deploy')
						)
				})}
				back={Boolean.match(isMobile && pane !== 'apps', {
					onFalse: () => undefined,
					onTrue: () => ({
						label: Boolean.match(pane === 'machine', {
							onFalse: () => 'Apps',
							onTrue: () => Boolean.match(machineBack === 'process', {onFalse: () => 'Apps', onTrue: () => 'Processes'})
						}),
						onClick: () =>
							view({
								pane: Boolean.match(pane === 'machine', {onFalse: () => 'apps' as const, onTrue: () => machineBack})
							})
					})
				})}
				palette={Boolean.match(Option.isSome(authFailure), {
					onFalse: () => [
						{
							items: [
								...Option.match(Option.fromUndefinedOr(active), {
									onNone: () => [],
									onSome: current => [
										{icon: <MonitorIcon />, label: `Open ${machineName(current)} graphs`, run: showMachine}
									]
								}),
								...Option.match(Option.fromUndefinedOr(selectedRow), {
									onNone: () => [],
									onSome: row => [
										{
											icon: <HardDrivesIcon />,
											label: `Processes of ${workloadName(row.item)}`,
											run: () => selectRow(row)
										}
									]
								})
							],
							label: 'Actions'
						},
						{
							items: Array.map(
								Array.filter(searchable, row => {
									const light = dot(row.item, status(row.item))
									return light === 'error' || light === 'warning'
								}),
								row => ({
									detail: reasonOf(row, now),
									icon: <ApplicationIcon name={workloadName(row.item)} container={row.item.kind === 'container'} />,
									id: row.item.id,
									keywords: text(row),
									label: workloadName(row.item),
									run: () => selectRow(row)
								})
							),
							label: 'Needs you'
						},
						{
							items: Array.map(
								Array.filter(searchable, row => row.item.scheduled === true),
								row => ({
									detail: nextRun(row.item.next ?? now, now),
									icon: <ApplicationIcon name={workloadName(row.item)} container={row.item.kind === 'container'} />,
									id: row.item.id,
									keywords: text(row),
									label: workloadName(row.item),
									run: () => selectRow(row)
								})
							),
							label: 'Scheduled'
						},
						{
							items: Array.map(
								Array.filter(searchable, row => row.item.scheduled !== true),
								row => ({
									detail: `${machineName(row.item.worker)} · ${bytes(appUsage(row.item.processes ?? []).memory)}`,
									icon: <ApplicationIcon name={workloadName(row.item)} container={row.item.kind === 'container'} />,
									id: row.item.id,
									keywords: text(row),
									label: workloadName(row.item),
									run: () => selectRow(row)
								})
							),
							label: 'Apps'
						},
						otherApps('deploy')
					],
					onTrue: () => [otherApps('deploy')]
				})}
				controls={<RangeMenu minutes={minutes} pending={refreshing} onChange={range => view({range})} />}
			/>
			{Option.match(authFailure, {
				onNone: () => (
					<div className="flex min-h-0 flex-1 flex-col">
						<MachineStrip
							active={active}
							histories={shownHistories}
							inventoryFailure={inventoryFailure}
							onSelect={selectWorker}
							pending={AsyncResult.isInitial(inventory) && AsyncResult.isInitial(metrics)}
							sources={sources}
							workers={workers}
						/>
						<div
							className="machine flex min-h-0 flex-1 flex-col"
							data-machine={Option.match(Option.fromUndefinedOr(active), {onNone: () => '', onSome: machineName})}
						>
							<div className="flex shrink-0 items-center gap-2 px-3 empty:hidden">
								{Array.map(
									Array.filter(sources, source => source.error !== '' && !Array.contains(workers, source.name)),
									source => (
										<div key={source.name} className="flex items-center gap-1">
											<MachineIcon worker={source.name} />
											<Problem label={`${machineName(source.name)} unreachable`} reset={refreshInventory} />
										</div>
									)
								)}
							</div>
							{Boolean.match(isMobile, {
								onFalse: () => (
									<div className="grid-cols-split grid min-h-0 flex-1">
										<AppsPane
											bandOf={bandOf}
											className={cn('min-w-0 border-r', refreshing && 'opacity-60')}
											free={free}
											compact={isMobile}
											hovered={hovered}
											onHover={setHovered}
											now={now}
											onSelect={selectRow}
											rows={sorted}
											selectedId={selectedRow?.item.id}
										/>
										<ProcessPane
											className={cn('min-w-0 border-r', refreshing && 'opacity-60')}
											now={now}
											row={selectedRow}
										/>
										<MachinePane
											available={activeAvailable}
											className={cn('min-w-0', refreshing && 'opacity-60')}
											history={Option.getOrUndefined(history)}
											labels={bandNames}
											minutes={shownMinutes}
											hovered={hovered}
											onHover={setHovered}
											worker={active}
										/>
									</div>
								),
								onTrue: () => (
									<div className="flex min-h-0 flex-1 flex-col">
										{pipe(
											Match.value(pane),
											Match.when('apps', () => (
												<AppsPane
													bandOf={bandOf}
													className={cn('min-h-0 flex-1', refreshing && 'opacity-60')}
													free={free}
													compact={isMobile}
													hovered={hovered}
													onHover={setHovered}
													now={now}
													onSelect={selectRow}
													rows={sorted}
													selectedId={selectedRow?.item.id}
												/>
											)),
											Match.when('process', () => (
												<ProcessPane
													className={cn('min-h-0 flex-1', refreshing && 'opacity-60')}
													now={now}
													row={selectedRow}
													showName={false}
												/>
											)),
											Match.orElse(() => (
												<MachinePane
													available={activeAvailable}
													className={cn('min-h-0 flex-1', refreshing && 'opacity-60')}
													history={Option.getOrUndefined(history)}
													labels={bandNames}
													minutes={shownMinutes}
													hovered={hovered}
													onHover={setHovered}
													worker={active}
												/>
											))
										)}
									</div>
								)
							})}
						</div>
					</div>
				),
				onSome: error => <FailureContent error={error} reset={retryFailed} />
			})}
		</div>
	)
}

export const Route = createFileRoute('/(home)/')({component: Home, validateSearch: WebRuntime.searchOf(Search)})
