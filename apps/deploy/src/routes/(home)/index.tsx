import {useAtom, useAtomRefresh, useAtomSuspense, useAtomValue} from '@effect/atom-react'

import {Array, Boolean, Cause, HashSet, Match, Number, Option, Order, Record, Schema, String, pipe} from 'effect'

import {
	AppWindowIcon,
	CaretDownIcon,
	CaretRightIcon,
	ChartLineIcon,
	ClockIcon,
	HardDrivesIcon,
	MonitorIcon,
	PlayIcon,
	TerminalWindowIcon
} from '@phosphor-icons/react'
import {CatchBoundary, createFileRoute, getRouteApi} from '@tanstack/react-router'
import {AsyncResult} from 'effect/reactivity'
import {Fragment, Suspense, useDeferredValue, useState} from 'react'
import type {ReactNode} from 'react'

import {AppBar} from '@deslop/components-web/app-bar'
import {otherApps} from '@deslop/components-web/command-palette'
import {EmptyState, Error, SignIn} from '@deslop/components-web/fallbacks'
import {Page, Section} from '@deslop/components-web/page'
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
	DropdownMenuRadioGroup,
	DropdownMenuRadioItem,
	DropdownMenuTrigger
} from '@deslop/components-web/ui/dropdown-menu'
import {Item, ItemContent, ItemMedia} from '@deslop/components-web/ui/item'
import {Progress, ProgressLabel} from '@deslop/components-web/ui/progress'
import {ResizableHandle, ResizablePanel, ResizablePanelGroup} from '@deslop/components-web/ui/resizable'
import {ScrollArea} from '@deslop/components-web/ui/scroll-area'
import {Skeleton} from '@deslop/components-web/ui/skeleton'
import {Spinner} from '@deslop/components-web/ui/spinner'
import {Tabs, TabsList, TabsTrigger} from '@deslop/components-web/ui/tabs'
import {ToggleGroup, ToggleGroupItem} from '@deslop/components-web/ui/toggle-group'
import {cn, useMediaQuery} from '@deslop/components-web/utils'
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

// A phone shows one pane at a time; a wide screen shows all three.
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

// A row that needs a look leads the list, whether it is an app or a job.
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
function ranged(rows: ReturnType<typeof workloads>, minutes: number, history?: MachineHistory) {
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

// The page's one range control: a line of ranges at the same height as every other control.
function RangeToggle(props: {
	minutes: HistoryQuery['minutes']
	onChange: (minutes: HistoryQuery['minutes']) => void
	pending: boolean
}) {
	return (
		<div className="flex items-center gap-2">
			<span aria-hidden={!props.pending} className="flex size-4 shrink-0 items-center justify-center">
				{Boolean.match(props.pending, {onFalse: () => null, onTrue: () => <Spinner className="size-3.5" />})}
			</span>
			<ToggleGroup
				aria-label="History range"
				className="w-fit"
				onValueChange={values => {
					Option.map(
						Option.flatMap(Option.fromUndefinedOr(Option.getOrUndefined(Array.head(values))), current =>
							Array.findFirst(RANGES, range => `${range.minutes}` === current)
						),
						range => props.onChange(range.minutes)
					)
				}}
				size="sm"
				spacing={0}
				value={[`${props.minutes}`]}
				variant="outline"
			>
				{Array.map(RANGES, range => (
					<ToggleGroupItem key={range.minutes} className="max-sm:h-11" value={`${range.minutes}`}>
						{range.label}
					</ToggleGroupItem>
				))}
			</ToggleGroup>
		</div>
	)
}

// A phone's bar keeps the range in the space of a word: the current range opens the five.
function RangeMenu(props: {
	minutes: HistoryQuery['minutes']
	onChange: (minutes: HistoryQuery['minutes']) => void
	pending: boolean
}) {
	const current = Array.findFirst(RANGES, range => range.minutes === props.minutes)
	return (
		<DropdownMenu>
			<DropdownMenuTrigger
				aria-label={Option.match(current, {
					onNone: () => 'History range',
					onSome: range => `History range: ${range.name}`
				})}
				render={<Button variant="ghost" size="sm" className="max-lg:h-11" />}
			>
				{Option.match(current, {onNone: () => '—', onSome: range => range.label})}
				{Boolean.match(props.pending, {onFalse: () => <CaretDownIcon />, onTrue: () => <Spinner />})}
			</DropdownMenuTrigger>
			<DropdownMenuContent align="end" className="w-auto min-w-36">
				<DropdownMenuRadioGroup
					value={`${props.minutes}`}
					onValueChange={value => {
						Option.map(
							Array.findFirst(RANGES, range => `${range.minutes}` === value),
							range => props.onChange(range.minutes)
						)
					}}
				>
					{Array.map(RANGES, range => (
						<DropdownMenuRadioItem key={range.minutes} className="max-lg:h-11" value={`${range.minutes}`}>
							{range.name}
						</DropdownMenuRadioItem>
					))}
				</DropdownMenuRadioGroup>
			</DropdownMenuContent>
		</DropdownMenu>
	)
}

// Port chips of one least width: exposed in Deploy's primary, unexposed neutral; a public endpoint reads as its whole hostname.
function Endpoint(props: {item: InventoryItem}) {
	return (
		<Button
			size="sm"
			className="min-w-port relative max-sm:h-11"
			nativeButton={false}
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
			<span className="block max-w-48 truncate">
				{Boolean.match(props.item.publicAccess === true, {
					onFalse: () => `:${props.item.port}`,
					onTrue: () => String.replace(/^https:\/\//u, '')(props.item.url)
				})}
			</span>
		</Button>
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
								<Button key={listener.id} size="sm" variant="ghost" disabled className="min-w-port max-sm:h-11">
									:{listener.port}
								</Button>
							),
							onSome: port => (
								<Button
									key={listener.id}
									size="sm"
									variant="secondary"
									className="min-w-port relative max-sm:h-11"
									aria-label={`Expose ${workloadName(props.row.item)} :${listener.port}`}
									onClick={() => expose(port)}
								>
									:{listener.port}
								</Button>
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
		<ContextMenuItem
			variant="destructive"
			className="max-sm:h-11"
			disabled={AsyncResult.isWaiting(result)}
			onClick={() => hide()}
		>
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

// One app in the list: its mark, name, ports or reason, memory and light; the whole row opens its processes.
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
	const failing = light === 'error' || light === 'warning'
	const next = Boolean.match(running, {
		onFalse: () => nextRun(props.row.item.next ?? props.now, props.now),
		onTrue: () => 'running'
	})
	const memory = appUsage(processes).memory
	return (
		<>
			<ContextMenu disabled={Array.isArrayEmpty(owned)}>
				{/* Right-click or long-press removes an endpoint this app exposed. */}
				<ContextMenuTrigger
					render={
						<div
							role="listitem"
							data-selected={props.selected}
							className={cn('list-row relative flex h-14 items-center gap-2 pr-3', highlighted && 'bg-muted/50')}
							onPointerEnter={() => props.onHover(Option.getOrUndefined(band))}
							onPointerLeave={() => props.onHover()}
						/>
					}
				>
					{/* The whole row is the hit area; the row itself draws hover, selection and the focus ring. */}
					<Button
						aria-label={`Open ${fullName}`}
						variant={Boolean.match(props.selected, {
							onFalse: () => 'ghost' as const,
							onTrue: () => 'secondary' as const
						})}
						className="absolute inset-0 z-0 size-full"
						onClick={props.onSelect}
					/>
					<Item className="pointer-events-none relative z-10 h-full min-w-0 flex-1">
						<ItemMedia variant="icon">
							<ApplicationIcon name={fullName} process={process} container={props.row.item.kind === 'container'} />
						</ItemMedia>
						<ItemContent className="min-w-0">
							<span
								className={cn('min-w-0 truncate text-sm font-medium', scheduled && 'text-muted-foreground')}
								title={fullName}
							>
								{name}
							</span>
							{/* A phone reads the memory, and why a row needs a look, under its name; wider screens keep them in their columns. */}
							<span className="flex min-w-0 items-center gap-1.5 font-mono text-xs tracking-normal normal-case tabular-nums sm:hidden">
								<span className="text-muted-foreground shrink-0">{bytes(memory)}</span>
								{Boolean.match(failing, {
									onFalse: () =>
										Boolean.match(scheduled, {
											onFalse: () => null,
											onTrue: () => (
												<span className="text-muted-foreground flex min-w-0 items-center gap-1 truncate">
													<ClockIcon className="size-3 shrink-0" />
													{next}
												</span>
											)
										}),
									onTrue: () => (
										<span
											className={cn(
												'truncate',
												Boolean.match(light === 'error', {
													onFalse: () => 'text-warning',
													onTrue: () => 'text-destructive'
												})
											)}
										>
											{reason}
										</span>
									)
								})}
							</span>
						</ItemContent>
					</Item>
					<div className="pointer-events-auto relative z-10 flex max-w-1/2 min-w-0 shrink items-center justify-end gap-1 overflow-hidden max-sm:max-w-1/3">
						{Boolean.match(failing, {
							onFalse: () =>
								Boolean.match(scheduled, {
									onFalse: () => <Endpoints free={props.free} row={props.row} />,
									onTrue: () => (
										<span className="text-muted-foreground flex shrink-0 items-center gap-1 font-mono text-xs max-sm:hidden">
											<ClockIcon className="size-3" />
											{next}
										</span>
									)
								}),
							onTrue: () => (
								<span
									className={cn(
										'truncate text-xs max-sm:hidden',
										Boolean.match(light === 'error', {onFalse: () => 'text-warning', onTrue: () => 'text-destructive'})
									)}
									title={reason}
								>
									{reason}
								</span>
							)
						})}
					</div>
					<div className="pointer-events-none relative z-10 flex shrink-0 items-center gap-2">
						<span
							className={cn(
								'w-20 shrink-0 text-right font-mono text-xs whitespace-nowrap tabular-nums max-sm:hidden',
								scheduled && 'text-muted-foreground'
							)}
						>
							{bytes(memory)}
						</span>
						{/* Only a problem earns a dot; a healthy row says nothing more. */}
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
						<span
							className={cn(
								'pointer-events-auto flex shrink-0 items-center justify-center',
								Boolean.match(scheduled, {onFalse: () => 'size-4', onTrue: () => 'size-7 max-sm:size-11'})
							)}
						>
							{Boolean.match(scheduled, {
								onFalse: () => <CaretRightIcon className="text-muted-foreground size-3.5" />,
								onTrue: () => (
									<RunNow busy={running} item={props.row.item} onRun={() => setRequested(Option.some(props.now))} />
								)
							})}
						</span>
					</div>
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

// A mark, a line and a trailing figure, shaped like the rows that replace them.
function ListSkeleton(props: {indent?: boolean; label: string; rows: number}) {
	return (
		<div aria-busy="true" aria-label={props.label} role="status" className="min-h-0 flex-1 overflow-hidden">
			{Array.map(Array.range(1, props.rows), row => (
				<div
					key={row}
					aria-hidden
					className={cn('list-row flex h-14 items-center gap-3 px-4', props.indent === true && 'pl-8')}
				>
					<Skeleton className="size-5 shrink-0" />
					<Skeleton className="h-3.5 w-1/3 max-w-40" />
					<Skeleton className="ml-auto h-3 w-16" />
				</div>
			))}
		</div>
	)
}

function ChartSkeleton() {
	return (
		<div
			aria-busy="true"
			aria-label="Usage history"
			role="status"
			className="flex min-h-0 flex-1 flex-col gap-4 px-4 pt-3 pb-4"
		>
			<div className="flex flex-wrap gap-3">
				<Skeleton className="h-3 w-16" />
				<Skeleton className="h-3 w-24" />
				<Skeleton className="h-3 w-20" />
			</div>
			<Skeleton className="h-40 w-full" />
			<Skeleton className="h-36 w-full" />
			<Skeleton className="h-3 w-full" />
			<Skeleton className="h-1 w-full" />
			<Skeleton className="h-4 w-full" />
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
	rows: ReturnType<typeof workloads>
	selectedId?: string
}) {
	const inventory = useAtomValue(inventoryAtom)
	const pending = AsyncResult.isInitial(inventory)
	const ready = Option.isSome(AsyncResult.value(inventory))
	const apps = Array.filter(props.rows, row => row.item.scheduled !== true)
	const scheduled = Array.filter(props.rows, row => row.item.scheduled === true && !needsAttention(row))
	const firstScheduled = Option.getOrUndefined(
		Array.findFirstIndex(props.rows, row => row.item.scheduled === true && !needsAttention(row))
	)
	return (
		<Section
			title="Apps"
			className={cn('min-h-0 flex-1 gap-0', props.className)}
			headerClassName="px-4"
			actions={
				<div className="flex items-center gap-2">
					{Boolean.match(pending, {
						onFalse: () =>
							Boolean.match(ready, {
								onFalse: () => null,
								onTrue: () => (
									<Badge variant="secondary" aria-label={`${apps.length} apps`}>
										{apps.length}
									</Badge>
								)
							}),
						onTrue: () => <Skeleton className="h-3 w-10" />
					})}
					<InventoryProblem />
				</div>
			}
		>
			<Suspense fallback={<ListSkeleton label="Apps loading" rows={8} />}>
				<InventoryContent>
					{Array.match(props.rows, {
						onEmpty: () => (
							<EmptyState
								icon={<AppWindowIcon className="size-5" weight="light" />}
								label="No apps in this range"
								description="Nothing ran or failed in it. Try another machine or range."
							/>
						),
						onNonEmpty: () => (
							<ScrollArea className="min-h-0 flex-1">
								<div role="list" className="pr-2">
									{Array.map(props.rows, (row, index) => (
										<Fragment key={row.item.id}>
											{index === firstScheduled && (
												<div className="bg-background text-muted-foreground sticky top-0 z-20 flex h-10 shrink-0 items-center gap-2 border-b px-4 text-xs">
													<span className="tracking-label font-semibold uppercase">Scheduled</span>
													<Badge variant="secondary">{scheduled.length}</Badge>
												</div>
											)}
											<AppListRow
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
										</Fragment>
									))}
								</div>
							</ScrollArea>
						)
					})}
				</InventoryContent>
			</Suspense>
		</Section>
	)
}

// The selected app's processes, or a job's, with what the row cannot show: its state and next run.
function ProcessPane(props: {
	className?: string
	now: number
	pending: boolean
	row?: ReturnType<typeof workloads>[number]
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
	const tree = processTree(processes)
	const count = Array.reduce(tree, 0, (sum, node) => sum + node.count)
	return (
		<Section
			title="Processes"
			className={cn('min-h-0 min-w-0 flex-1 gap-0', props.className)}
			headerClassName="px-4"
			actions={
				<div className="flex min-w-0 items-center gap-2">
					{Option.match(Option.fromUndefinedOr(props.row), {
						onNone: () => null,
						onSome: current => (
							<span className="flex min-w-0 items-center gap-2 max-lg:hidden">
								<ApplicationIcon
									name={workloadName(current.item)}
									process={process}
									container={current.item.kind === 'container'}
								/>
								<span className="max-w-40 min-w-0 truncate text-sm font-medium tracking-normal normal-case">
									{workloadName(current.item)}
								</span>
							</span>
						)
					})}
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
					{Boolean.match(props.row?.item.scheduled === true, {
						onFalse: () => null,
						onTrue: () => (
							<span className="text-muted-foreground shrink-0 font-mono text-xs whitespace-nowrap">
								{nextRun(props.row?.item.next ?? props.now, props.now)}
							</span>
						)
					})}
					{Boolean.match(props.row !== undefined && !props.pending, {
						onFalse: () => null,
						onTrue: () => (
							<Badge variant="secondary" aria-label={`${count} processes`}>
								{count}
							</Badge>
						)
					})}
					<InventoryProblem />
				</div>
			}
		>
			<Suspense fallback={<ListSkeleton indent label="Processes loading" rows={6} />}>
				<InventoryContent>
					{Option.match(Option.fromUndefinedOr(props.row), {
						onNone: () => (
							<EmptyState
								icon={<TerminalWindowIcon className="size-5" weight="light" />}
								label="Select an app"
								description="Choose an app to see its processes and what they hold."
							/>
						),
						onSome: current => (
							<>
								{Boolean.match(current.item.scheduled === true, {
									onFalse: () => null,
									onTrue: () => (
										<div className="px-4 pt-2">
											<RunFailure item={current.item} />
										</div>
									)
								})}
								{Array.match(processes, {
									onEmpty: () => (
										<EmptyState
											icon={<TerminalWindowIcon className="size-5" weight="light" />}
											label="No processes right now"
											description="Nothing of this app is running at the machine's last snapshot."
										/>
									),
									onNonEmpty: () => (
										<ScrollArea className="min-h-0 min-w-0 flex-1">
											<div className="pr-2">
												<Processes tree={tree} />
											</div>
										</ScrollArea>
									)
								})}
							</>
						)
					})}
				</InventoryContent>
			</Suspense>
		</Section>
	)
}

// A machine's graphs, on its own hue, at the range the bar carries.
function MachineContent(props: {
	history: MachineHistory
	hovered?: string
	labels: Record<string, string>
	minutes: HistoryQuery['minutes']
	onHover: (id?: string) => void
}) {
	const latest = Option.getOrUndefined(Array.last(props.history.samples))
	const all = bands(props.history)
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
			Order.mapInput(Order.flip(Order.Number), (band: Band) => Option.getOrElse(Array.last(band.memory), () => 0))
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
		<ScrollArea className="min-h-0 flex-1">
			<div className="flex flex-col gap-4 px-4 pt-3 pb-4">
				<div className="flex flex-wrap gap-x-3 gap-y-1.5 text-xs">
					{Array.map([...memoryTop, ...Array.filter(all, band => band.kind !== 'app')], band => (
						<span key={band.id} className="flex min-w-0 items-center gap-1.5">
							<span
								className="size-2 shrink-0 bg-(--machine) opacity-(--swatch-opacity)"
								style={{'--swatch-opacity': band.opacity}}
							/>
							<span className="text-muted-foreground max-w-40 truncate" title={bandName(band.id)}>
								{bandName(band.id)}
							</span>
						</span>
					))}
				</div>
				<UsageChart
					className="h-40"
					history={props.history}
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
					className="h-36"
					history={props.history}
					minutes={props.minutes}
					hovered={props.hovered}
					label="CPU"
					layers={Array.map(all, band => ({...band, values: band.cpu}))}
					names={bandName}
					onHover={props.onHover}
					recorded={sample => sample.cpu !== undefined}
					value={Option.getOrUndefined(cpu)}
				/>
				<TimeAxis history={props.history} minutes={props.minutes} />
				{Boolean.match(storage.total > 0, {
					onFalse: () => null,
					onTrue: () => (
						// The bar alone says how full the disks are; the figures wait on hover, or sit beside them on a phone.
						<div className="machine-metric" title={`${bytes(storage.used)} of ${bytes(storage.total)}`}>
							<Progress value={(storage.used / storage.total) * 100}>
								<ProgressLabel>Disk</ProgressLabel>
								<span className="text-muted-foreground ml-auto text-sm tabular-nums sm:hidden">
									{bytes(storage.used)} of {bytes(storage.total)}
								</span>
							</Progress>
						</div>
					)
				})}
				<Cores history={props.history} />
			</div>
		</ScrollArea>
	)
}

function MachinePane(props: {
	className?: string
	history?: MachineHistory
	hovered?: string
	labels: Record<string, string>
	minutes: HistoryQuery['minutes']
	onHover: (id?: string) => void
	worker?: string
}) {
	return (
		<Section
			title="Machine"
			className={cn('min-h-0 flex-1 gap-0', props.className)}
			headerClassName="px-4"
			actions={
				<div className="flex items-center gap-2">
					<MetricsProblem minutes={props.minutes} />
				</div>
			}
		>
			<Suspense fallback={<ChartSkeleton />}>
				<MetricsContent minutes={props.minutes}>
					{Option.match(
						Option.filter(Option.fromUndefinedOr(props.history), history =>
							Array.isReadonlyArrayNonEmpty(history.samples)
						),
						{
							onNone: () => (
								<EmptyState
									icon={<ChartLineIcon className="size-5" weight="light" />}
									label={Boolean.match(props.worker === undefined, {
										onFalse: () => 'No readings in this range',
										onTrue: () => 'No machine'
									})}
									description={Boolean.match(props.worker === undefined, {
										onFalse: () => 'Nothing was recorded in this range. Try another one.',
										onTrue: () => 'Pick a machine above to see its apps and load.'
									})}
								/>
							),
							onSome: history => (
								<MachineContent
									history={history}
									hovered={props.hovered}
									labels={props.labels}
									minutes={props.minutes}
									onHover={props.onHover}
								/>
							)
						}
					)}
				</MetricsContent>
			</Suspense>
		</Section>
	)
}

// The two machines as one line at the top: their names, their size, and whether they answer.
function MachineTabs(props: {
	active?: string
	histories: readonly MachineHistory[]
	inventoryFailure: boolean
	onSelect: (worker: string) => void
	pending: boolean
	sources: readonly {error: string; name: string}[]
	workers: readonly string[]
}) {
	return Array.match(props.workers, {
		onEmpty: () =>
			Boolean.match(props.pending, {
				onFalse: () => null,
				onTrue: () => (
					<div aria-busy="true" aria-label="Machines" role="status" className="flex h-12 shrink-0 items-center gap-3">
						<Skeleton className="size-4" />
						<Skeleton className="h-4 w-24" />
						<Skeleton className="h-3 w-32" />
					</div>
				)
			}),
		onNonEmpty: workers => (
			<Tabs
				className="shrink-0"
				value={props.active ?? workers[0]}
				onValueChange={(worker: string) => props.onSelect(worker)}
			>
				<TabsList variant="line" aria-label="Machines" className="w-full max-sm:group-data-horizontal/tabs:h-auto">
					{Array.map(workers, worker => {
						const history = Array.findFirst(props.histories, machine => machine.worker === worker)
						const latest = Option.getOrUndefined(Option.flatMap(history, machine => Array.last(machine.samples)))
						const failed = failedFor(worker, props.inventoryFailure, props.sources, Option.getOrUndefined(history))
						return (
							<TabsTrigger key={worker} value={worker} className="min-w-0 max-sm:h-12">
								<MachineIcon worker={worker} />
								<span className="flex min-w-0 flex-1 flex-col items-start gap-0.5 sm:flex-row sm:items-baseline sm:gap-2">
									<span className="flex min-w-0 items-center gap-1.5">
										<span className="min-w-0 truncate">{machineName(worker)}</span>
										{/* Only an unreachable machine is marked; one that answers needs no dot. */}
										{failed && (
											<span
												role="img"
												aria-label="Unavailable"
												className="flex size-3 shrink-0 items-center justify-center"
											>
												<StatusDot status="off" />
											</span>
										)}
									</span>
									<span className="text-muted-foreground min-w-0 truncate font-mono text-xs tracking-normal normal-case tabular-nums">
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
								</span>
							</TabsTrigger>
						)
					})}
				</TabsList>
			</Tabs>
		)
	})
}

// The workers that did not answer, above the content they would have filled.
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
				<div className="flex shrink-0 flex-wrap items-center gap-3 border-b pb-2">
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

function Home() {
	// 1024–1599 shows apps and charts with processes beneath; 1600 and up gives each pane a column.
	const isNarrow = useMediaQuery('(width < 64rem)')
	const isWide = useMediaQuery('(width >= 100rem)')
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

	function selectRow(row: ReturnType<typeof workloads>[number]) {
		view({app: row.item.id, pane: 'process'})
	}

	// A phone's bar names the pane and backs out to Machines; desktop and the wide two-column layout keep the wordmark.
	const mobileTitle = Boolean.match(isNarrow, {
		onFalse: () => undefined,
		onTrue: () =>
			pipe(
				Match.value(pane),
				Match.when('apps', () => 'Machines'),
				Match.when('process', () =>
					Option.match(Option.fromUndefinedOr(selectedRow), {
						onNone: () => 'Processes',
						onSome: row => workloadName(row.item)
					})
				),
				Match.orElse(() => Option.match(Option.fromUndefinedOr(active), {onNone: () => 'Machine', onSome: machineName}))
			)
	})
	return (
		<div className="flex min-h-0 flex-1 flex-col">
			<AppBar
				back={Boolean.match(isNarrow && pane !== 'apps', {
					onFalse: () => undefined,
					onTrue: () => ({
						label: 'Machines',
						onClick: () => {
							setHovered(undefined)
							view({pane: 'apps'})
						}
					})
				})}
				icon={icon}
				name="deploy"
				title={mobileTitle}
				palette={Boolean.match(Option.isSome(authFailure), {
					onFalse: () => [
						{
							items: [
								...Option.match(Option.fromUndefinedOr(active), {
									onNone: () => [],
									onSome: current => [
										{
											icon: <MonitorIcon />,
											label: `Open ${machineName(current)} graphs`,
											run: () => view({pane: 'machine'})
										}
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
				controls={
					<>
						<div className="max-lg:hidden">
							<RangeToggle minutes={minutes} pending={refreshing} onChange={range => view({range})} />
						</div>
						<div className="lg:hidden">
							<RangeMenu minutes={minutes} pending={refreshing} onChange={range => view({range})} />
						</div>
					</>
				}
			/>
			{Option.match(authFailure, {
				onNone: () => (
					<Page width="full" className="h-full min-h-0 gap-4 max-sm:px-2">
						<h1 className="sr-only">Deploy</h1>
						<MachineTabs
							active={active}
							histories={shownHistories}
							inventoryFailure={inventoryFailure}
							onSelect={next => {
								setHovered(undefined)
								view({
									app: undefined,
									machine: next,
									pane: Boolean.match(pane === 'machine', {
										onFalse: () => 'apps' as const,
										onTrue: () => 'machine' as const
									})
								})
							}}
							pending={AsyncResult.isInitial(inventory) && AsyncResult.isInitial(metrics)}
							sources={sources}
							workers={workers}
						/>
						<SourceProblems onRetry={refreshInventory} sources={sources} workers={workers} />
						<div
							className={cn(
								'machine flex min-h-0 flex-1 flex-col gap-4',
								refreshing && 'opacity-60 transition-opacity'
							)}
							data-machine={Option.match(Option.fromUndefinedOr(active), {onNone: () => '', onSome: machineName})}
						>
							{Boolean.match(isNarrow, {
								onFalse: () =>
									Boolean.match(isWide, {
										onFalse: () => (
											<div className="grid-rows-split grid min-h-0 flex-1">
												<div className="grid min-h-0 grid-cols-2">
													<AppsPane
														bandOf={bandOf}
														className="min-w-0 border-r"
														compact={false}
														free={free}
														hovered={hovered}
														now={now}
														onHover={setHovered}
														onSelect={selectRow}
														rows={sorted}
														selectedId={selectedRow?.item.id}
													/>
													<MachinePane
														className="min-w-0"
														history={Option.getOrUndefined(history)}
														hovered={hovered}
														labels={bandNames}
														minutes={shownMinutes}
														onHover={setHovered}
														worker={active}
													/>
												</div>
												<ProcessPane
													className="min-h-0 border-t"
													now={now}
													pending={inventoryPending}
													row={selectedRow}
												/>
											</div>
										),
										onTrue: () => (
											<ResizablePanelGroup className="min-h-0 flex-1" orientation="horizontal">
												<ResizablePanel className="min-h-0" defaultSize="30%" minSize="20%">
													<AppsPane
														bandOf={bandOf}
														className="h-full min-w-0"
														compact={false}
														free={free}
														hovered={hovered}
														now={now}
														onHover={setHovered}
														onSelect={selectRow}
														rows={sorted}
														selectedId={selectedRow?.item.id}
													/>
												</ResizablePanel>
												<ResizableHandle />
												<ResizablePanel className="min-h-0" defaultSize="36%" minSize="22%">
													<ProcessPane
														className="h-full min-h-0"
														now={now}
														pending={inventoryPending}
														row={selectedRow}
													/>
												</ResizablePanel>
												<ResizableHandle />
												<ResizablePanel className="min-h-0" defaultSize="34%" minSize="22%">
													<MachinePane
														className="h-full min-h-0"
														history={Option.getOrUndefined(history)}
														hovered={hovered}
														labels={bandNames}
														minutes={shownMinutes}
														onHover={setHovered}
														worker={active}
													/>
												</ResizablePanel>
											</ResizablePanelGroup>
										)
									}),
								onTrue: () => (
									<div className="flex min-h-0 flex-1 flex-col">
										{pipe(
											Match.value(pane),
											Match.when('apps', () => (
												<AppsPane
													bandOf={bandOf}
													compact
													free={free}
													hovered={hovered}
													now={now}
													onHover={setHovered}
													onSelect={selectRow}
													rows={sorted}
													selectedId={selectedRow?.item.id}
												/>
											)),
											Match.when('process', () => (
												<ProcessPane className="min-h-0" now={now} pending={inventoryPending} row={selectedRow} />
											)),
											Match.orElse(() => (
												<MachinePane
													className="min-h-0"
													history={Option.getOrUndefined(history)}
													hovered={hovered}
													labels={bandNames}
													minutes={shownMinutes}
													onHover={setHovered}
													worker={active}
												/>
											))
										)}
									</div>
								)
							})}
						</div>
					</Page>
				),
				onSome: error => <FailureContent error={error} reset={retryFailed} />
			})}
		</div>
	)
}

export const Route = createFileRoute('/(home)/')({component: Home, validateSearch: WebRuntime.searchOf(Search)})
