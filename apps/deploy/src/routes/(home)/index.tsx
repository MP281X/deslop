import {useAtomRefresh, useAtomValue} from '@effect/atom-react'

import {Array, Boolean, DateTime, Duration, Equal, Option, Record, Schema, String, pipe} from 'effect'

import {HardDrivesIcon, MonitorIcon, TerminalWindowIcon} from '@phosphor-icons/react'
import {CatchBoundary, Link, createFileRoute, getRouteApi} from '@tanstack/react-router'
import {AsyncResult} from 'effect/reactivity'
import {Suspense, useDeferredValue} from 'react'
import type {ReactNode} from 'react'

import {AppBarTab, AppBar, AppBarChoice, AppBarTabs} from '@deslop/components-web/app-bar'
import {cn, mediaQueryAtom} from '@deslop/components-web/classes'
import {EmptyState, Loaded, ReadFailure} from '@deslop/components-web/fallbacks'
import {RowsSkeleton} from '@deslop/components-web/item-list'
import {StaleProblem} from '@deslop/components-web/problem'
import {StatusDot} from '@deslop/components-web/status-dot'
import {ItemActions, ItemContent, ItemMedia} from '@deslop/components-web/ui/item'
import {ResizableHandle, ResizablePanel, ResizablePanelGroup} from '@deslop/components-web/ui/resizable'
import {ScrollArea} from '@deslop/components-web/ui/scroll-area'
import {Skeleton} from '@deslop/components-web/ui/skeleton'
import {isDenied} from '@deslop/runtime/shared/auth'

import {inventoryAtom, metricsAtom} from '#lib/fleet.ts'
import {RANGES} from '#routes/(home)/-chart.ts'
import {ChartBlock, ChartSkeleton, EmptyChart} from '#routes/(home)/-charts.tsx'
import {InventoryContent, ListPane} from '#routes/(home)/-list.tsx'
import {Processes} from '#routes/(home)/-processes.tsx'
import {failureOf, rowOrder, owner, ranged} from '#routes/(home)/-rows.ts'
import icon from '#routes/icon.svg'
import {type Row, availablePorts, processTree, workloadName, workloads} from '#services/inventory/lib/utils.ts'
import {ItemId, WorkerId} from '#services/inventory/schema.ts'
import type {AppId, InventoryItem} from '#services/inventory/schema.ts'
import {HistoryQuery} from '#services/metrics/schema.ts'
import type {MachineHistory} from '#services/metrics/schema.ts'

// A phone shows the list with the machine's chart above it, or one app's processes full-screen.
type Pane = typeof Pane.Type
const Pane = Schema.Literals(['apps', 'process'])

type Search = typeof Search.Type
export const Search = Schema.Struct({
	app: Schema.OptionFromOptionalKey(ItemId),
	machine: Schema.OptionFromOptionalKey(WorkerId),
	pane: Schema.OptionFromOptionalKey(Pane),
	range: Schema.OptionFromOptionalKey(HistoryQuery.fields.minutes)
})
const route = getRouteApi('/(home)/')

// The range as one stock control: the same five tabs in the bar at every width.
function RangeTabs(props: {
	minutes: HistoryQuery['minutes']
	onChange: (minutes: HistoryQuery['minutes']) => void
	ranges: readonly {label: string; minutes: HistoryQuery['minutes']}[]
}) {
	return (
		<AppBarChoice
			label="History range"
			value={`${Duration.toMinutes(props.minutes)}`}
			options={Array.map(props.ranges, range => ({label: range.label, value: `${Duration.toMinutes(range.minutes)}`}))}
			onChange={value => {
				pipe(
					props.ranges,
					Array.findFirst(range => `${Duration.toMinutes(range.minutes)}` === value),
					Option.map(range => props.onChange(range.minutes))
				)
			}}
		/>
	)
}

// The machines as the bar's section control: its icon in the machine's colour and its name; an unreachable one keeps a dot. One machine needs no control.
function machineName(worker: WorkerId) {
	return String.split(worker, '.')[0]
}

function MachineIcon(props: {worker: WorkerId}) {
	return (
		<span
			aria-hidden="true"
			className={`inline-flex shrink-0 items-center justify-center ${Boolean.match(
				machineName(props.worker) === 'desktop',
				{onFalse: () => 'text-machine-dev', onTrue: () => 'text-machine-desktop'}
			)}`}
		>
			{Boolean.match(machineName(props.worker) === 'desktop', {
				onFalse: () => <HardDrivesIcon className="size-4" />,
				onTrue: () => <MonitorIcon className="size-4" />
			})}
		</span>
	)
}

function MachineTabs(props: {
	active?: WorkerId
	histories: readonly MachineHistory[]
	inventoryFailure: boolean
	sources: readonly {error: Option.Option<string>; name: string}[]
	workers: readonly WorkerId[]
}) {
	if (props.workers.length < 2) return null
	const histories = Record.fromEntries(Array.map(props.histories, machine => [machine.worker, machine] as const))
	return (
		<AppBarTabs value={props.active ?? props.workers[0] ?? ''}>
			{Array.map(props.workers, worker => {
				const failed = failureOf(worker, props.inventoryFailure, props.sources, histories[worker])
				return (
					<AppBarTab
						key={worker}
						value={worker}
						render={
							<Link
								to="/"
								search={previous =>
									Schema.encodeSync(Search)({
										app: Option.none(),
										machine: Option.some(worker),
										pane: Option.some('apps'),
										range: previous.range ?? Option.none()
									})
								}
							/>
						}
					>
						<MachineIcon worker={worker} />
						<span className="max-w-32 truncate max-sm:sr-only">{machineName(worker)}</span>
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

// The processes' loading rows: the real mark and name and detail bars, and its two figures right-aligned at the row's end.
function ProcessRowsSkeleton(props: {label: string; rows: number}) {
	return (
		<RowsSkeleton label={props.label} rows={props.rows}>
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
				<Skeleton className="h-3 w-14" />
				<Skeleton className="h-3 w-11" />
			</ItemActions>
		</RowsSkeleton>
	)
}

function MetricsContent(props: {children: ReactNode; minutes: HistoryQuery['minutes']}) {
	return (
		<Loaded atom={metricsAtom(props.minutes)}>
			{() => (
				<CatchBoundary getResetKey={() => 'metrics'} errorComponent={ReadFailure}>
					{props.children}
				</CatchBoundary>
			)}
		</Loaded>
	)
}

function DataProblem(props: {minutes: HistoryQuery['minutes']}) {
	return <StaleProblem label="Data out of date" readers={[inventoryAtom, metricsAtom(props.minutes)]} />
}

function ProcessList(props: {row: Row}) {
	const processes = Option.getOrElse(props.row.item.processes, Array.empty)
	const tree = processTree(processes)
	return Array.match(processes, {
		onEmpty: () => <EmptyState icon={<TerminalWindowIcon weight="light" />} label="No processes right now" />,
		onNonEmpty: () => (
			<ScrollArea className="min-h-0 flex-1">
				<Processes tree={tree} />
			</ScrollArea>
		)
	})
}

// The processes below the chart, or a phone's pushed pane; nothing selected is one symbol.
function SelectedProcesses(props: {app?: ItemId; pending: boolean; row?: Row}) {
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
							<ProcessList row={row} />
						</InventoryContent>
					</Suspense>
				)
			})}
		</div>
	)
}

function chartHistoryOf(history?: MachineHistory) {
	return Option.filter(Option.fromUndefinedOr(history), current => Array.isReadonlyArrayNonEmpty(current.samples))
}

// The desktop detail: the three charts, then the chosen processes.
function DetailPane(props: {
	app?: ItemId
	history?: MachineHistory
	labels: Record<AppId, string>
	minutes: HistoryQuery['minutes']
	pending: boolean
	row?: Row
	selectedOwner?: AppId
	worker?: WorkerId
}) {
	return (
		<div className="flex h-full min-h-0 flex-col">
			<Suspense fallback={<ChartSkeleton isPhone={false} minutes={props.minutes} />}>
				<MetricsContent minutes={props.minutes}>
					{Option.match(chartHistoryOf(props.history), {
						onNone: () => <EmptyChart worker={props.worker} />,
						onSome: history => (
							<ChartBlock
								history={history}
								isPhone={false}

								labels={props.labels}
								minutes={props.minutes}
								selectedOwner={props.selectedOwner}
							/>
						)
					})}
				</MetricsContent>
			</Suspense>
			<div className="flex min-h-0 flex-1 flex-col">
				<SelectedProcesses app={props.app} pending={props.pending} row={props.row} />
			</div>
		</div>
	)
}

// A phone's list view: the three short charts, then the rows edge to edge.
function PhoneList(props: {
	free: readonly InventoryItem[]
	history?: MachineHistory
	labels: Record<AppId, string>
	minutes: HistoryQuery['minutes']
	now: DateTime.Utc
	onSelect: (row: Row) => void
	rows: readonly Row[]
	selectedId?: ItemId
	selectedOwner?: AppId
}) {
	return (
		<div className="flex min-h-0 flex-1 flex-col">
			<Suspense fallback={<ChartSkeleton isPhone minutes={props.minutes} />}>
				<MetricsContent minutes={props.minutes}>
					{Option.match(chartHistoryOf(props.history), {
						onNone: () => <EmptyChart />,
						onSome: history => (
							<ChartBlock
								history={history}
								isPhone
								labels={props.labels}
								minutes={props.minutes}
								selectedOwner={props.selectedOwner}
							/>
						)
					})}
				</MetricsContent>
			</Suspense>
			<ListPane
				className="min-h-0 flex-1"
				compact
				free={props.free}
				history={props.history}
				now={props.now}
				onSelect={props.onSelect}
				rows={props.rows}
				selectedId={props.selectedId}
			/>
		</div>
	)
}

// What the bar opens onto: the two panes on a wide screen, the chart and list on a phone, or the pushed processes.
function Workspace(props: {
	active?: WorkerId
	authFailure: Option.Option<unknown>
	free: readonly InventoryItem[]
	history?: MachineHistory
	isPhone: boolean
	labels: Record<AppId, string>
	minutes: HistoryQuery['minutes']
	now: DateTime.Utc
	onSelect: (row: Row) => void
	pending: boolean
	pushed: boolean
	refreshing: boolean
	retryFailed: () => void
	rows: readonly Row[]
	selectedApp?: ItemId
	selectedRow?: Row
}) {
	const selectedOwner = Option.getOrUndefined(
		Option.flatMap(Option.fromUndefinedOr(props.selectedRow), row => owner(row))
	)
	return Option.match(props.authFailure, {
		onNone: () => (
			<div className="flex min-h-0 flex-1 flex-col">
				<h1 className="sr-only">Deploy</h1>
				<div className={cn('flex min-h-0 flex-1 flex-col', props.refreshing && 'opacity-60')}>
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
										className="h-full min-w-0"
										compact={false}
										free={props.free}
										history={props.history}

										now={props.now}
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
										labels={props.labels}
										minutes={props.minutes}
										pending={props.pending}
										row={props.selectedRow}
										selectedOwner={selectedOwner}
										worker={props.active}
									/>
								</ResizablePanel>
							</ResizablePanelGroup>
						),
						onTrue: () =>
							Boolean.match(props.pushed, {
								onFalse: () => (
									<PhoneList
										free={props.free}
										history={props.history}
										labels={props.labels}
										minutes={props.minutes}
										now={props.now}
										onSelect={props.onSelect}
										rows={props.rows}
										selectedId={props.selectedRow?.item.id}
										selectedOwner={selectedOwner}
									/>
								),
								onTrue: () => (
									<SelectedProcesses app={props.selectedApp} pending={props.pending} row={props.selectedRow} />
								)
							})
					})}
				</div>
			</div>
		),
		onSome: error => <ReadFailure error={error} reset={props.retryFailed} />
	})
}

function HomeRoute() {
	const isPhone = useAtomValue(mediaQueryAtom('(width < 40rem)'))
	const search = route.useSearch()
	const navigate = route.useNavigate()
	function view(next: Partial<Search>) {
		navigate({search: previous => Schema.encodeSync(Search)({...previous, ...next})})
	}
	const minutes = Option.getOrElse(search.range, () => Duration.minutes(60))
	// The charts keep the last loaded range, dimmed, until the one the URL asks for arrives.
	const shownMinutes = useDeferredValue(minutes)
	const pane = Option.getOrElse(search.pane, () => 'apps')
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
	const authFailure = pipe(
		AsyncResult.error(inventory),
		Option.filter(isDenied),
		Option.orElse(() => Option.filter(AsyncResult.error(metrics), isDenied))
	)
	const refreshing = !Equal.equals(shownMinutes, minutes)
	const inventoryPending = AsyncResult.isInitial(inventory)
	const workers = Array.dedupe([
		...pipe(
			snapshot,
			Option.map(value => Option.getOrElse(value.workers, () => Array.map(value.items, item => item.worker))),
			Option.getOrElse(() => [])
		),
		...Array.map(shownHistories, machine => machine.worker)
	])
	const active = Option.getOrUndefined(Option.orElse(search.machine, () => Array.head(workers)))
	const history = Option.flatMap(Option.fromUndefinedOr(active), current =>
		Array.findFirst(shownHistories, machine => machine.worker === current)
	)
	const rows = pipe(
		snapshot,
		Option.map(value => workloads(value.items)),
		Option.getOrElse(() => [])
	)
	const free = availablePorts(rows)
	const sources = pipe(
		snapshot,
		Option.map(value => value.sources),
		Option.getOrElse(() => [])
	)
	const now = pipe(
		snapshot,
		Option.map(value => value.time),
		Option.getOrElse(DateTime.nowUnsafe)
	)
	const activeRows = Option.match(Option.fromUndefinedOr(active), {
		onNone: () => [],
		onSome: current => Array.filter(rows, row => row.item.worker === current)
	})
	const bandNames = Record.fromEntries(
		Array.flatMap(activeRows, row =>
			Option.match(owner(row), {onNone: () => [], onSome: id => [[id, workloadName(row.item)] as const]})
		)
	) satisfies Record<AppId, string>
	const sorted = Array.sort(ranged(activeRows, shownMinutes, Option.getOrUndefined(history)), rowOrder)
	const selectedRow = Option.getOrUndefined(
		Option.flatMap(search.app, current => Array.findFirst(activeRows, row => row.item.id === current))
	)
	function selectRow(row: Row) {
		view({app: Option.some(row.item.id), pane: Option.some('process')})
	}

	const pushed = Boolean.match(isPhone, {onFalse: () => false, onTrue: () => pane === 'process'})

	// A phone's bar names the pushed app and backs out to the list; wider screens keep the wordmark.
	return (
		<div className="flex min-h-0 flex-1 flex-col">
			<AppBar
				heading={Boolean.match(pushed, {
					onFalse: () => undefined,
					onTrue: () => ({
						back: {label: 'Back', onClick: () => view({pane: Option.some('apps')})},
						title: Option.match(Option.fromUndefinedOr(selectedRow), {
							onNone: () => 'Processes',
							onSome: entry => workloadName(entry.item)
						})
					})
				})}
				icon={icon}
				name="deploy"
				controls={Boolean.match(pushed, {
					onFalse: () => (
						<div className="flex items-center gap-1 max-sm:-ml-3">
							<DataProblem minutes={minutes} />
							<RangeTabs minutes={minutes} onChange={range => view({range: Option.some(range)})} ranges={RANGES} />
						</div>
					),
					onTrue: () => <DataProblem minutes={minutes} />
				})}
				tabs={Boolean.match(pushed, {
					onFalse: () => (
						<MachineTabs
							active={active}
							histories={shownHistories}
							inventoryFailure={inventoryFailure}
							sources={sources}
							workers={workers}
						/>
					),
					onTrue: () => undefined
				})}
			/>
			<Workspace
				active={active}
				authFailure={authFailure}
				free={free}
				history={Option.getOrUndefined(history)}
				isPhone={isPhone}
				labels={bandNames}
				minutes={shownMinutes}
				now={now}
				onSelect={selectRow}
				pending={inventoryPending}
				pushed={pushed}
				refreshing={refreshing}
				retryFailed={retryFailed}
				rows={sorted}
				selectedApp={Option.getOrUndefined(search.app)}
				selectedRow={selectedRow}
			/>
		</div>
	)
}

export const Route = createFileRoute('/(home)/')({
	component: HomeRoute,
	validateSearch: Schema.toStandardSchemaV1(Search)
})
