import {useAtomRefresh, useAtomValue} from '@effect/atom-react'

import {Array, Boolean, DateTime, Duration, Function, Option, Record, Schema, String, pipe} from 'effect'

import {AppWindowIcon, HardDrivesIcon, LaptopIcon, MonitorIcon, TerminalWindowIcon} from '@phosphor-icons/react'
import {CatchBoundary, Link, createFileRoute, getRouteApi} from '@tanstack/react-router'
import {AsyncResult} from 'effect/reactivity'
import {Suspense, useDeferredValue} from 'react'
import type {ReactNode} from 'react'

import {StaleProblem} from '@deslop/components-web/blocks/problem'
import {LoadingRows} from '@deslop/components-web/blocks/rows'
import {Loaded, ReadFailure} from '@deslop/components-web/blocks/states'
import {StatusDot} from '@deslop/components-web/blocks/status-dot'
import {mediaQueryAtom} from '@deslop/components-web/lib/media'
import {preload} from '@deslop/components-web/lib/router'
import {AppBarTab, AppBar, AppBarChoice, AppBarTabs} from '@deslop/components-web/shell/app-bar'
import {Workspace} from '@deslop/components-web/shell/workspace'
import {Empty, EmptyHeader, EmptyMedia, EmptyTitle} from '@deslop/components-web/ui/empty'
import {ResizableHandle, ResizablePanel, ResizablePanelGroup} from '@deslop/components-web/ui/resizable'
import {ScrollArea} from '@deslop/components-web/ui/scroll-area'
import {isDenied} from '@deslop/runtime/shared/auth'

import {inventoryAtom, metricsAtom} from '#lib/fleet.ts'
import {RANGES} from '#routes/(home)/-chart.ts'
import {ChartBlock, ChartSkeleton, EmptyChart} from '#routes/(home)/-charts.tsx'
import {InventoryContent, ListPane} from '#routes/(home)/-list.tsx'
import {Processes} from '#routes/(home)/-processes.tsx'
import {failureOf, rowOrder, owner, ranged} from '#routes/(home)/-rows.ts'
import {usageOf} from '#routes/(home)/-usage.ts'
import type {Usage} from '#routes/(home)/-usage.ts'
import icon from '#routes/icon.svg'
import {type Row, availablePorts, processTree, workloadName, workloads} from '#services/inventory/lib/utils.ts'
import {ItemId, WorkerId} from '#services/inventory/schema.ts'
import type {AppId, InventoryItem} from '#services/inventory/schema.ts'
import {HistoryQuery} from '#services/metrics/schema.ts'
import type {MachineHistory, Platform} from '#services/metrics/schema.ts'

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

// The machines as the bar's section control: its icon in the machine's colour and its name; an unreachable one keeps a dot. One machine needs no control.
function machineName(worker: WorkerId) {
	return String.split(worker, '.')[0]
}

function MachineIcon(props: {worker: WorkerId; platform: Option.Option<Platform>}) {
	return (
		<span
			aria-hidden="true"
			className={`inline-flex shrink-0 items-center justify-center ${Boolean.match(
				machineName(props.worker) === 'desktop',
				{onFalse: Function.constant('text-machine-dev'), onTrue: Function.constant('text-machine-desktop')}
			)}`}
		>
			{pipe(
				props.platform,
				Option.contains<Platform>('darwin'),
				Boolean.match({
					onFalse: () =>
						Boolean.match(machineName(props.worker) === 'desktop', {
							onFalse: () => <HardDrivesIcon className="size-4" />,
							onTrue: () => <MonitorIcon className="size-4" />
						}),
					onTrue: () => <LaptopIcon className="size-4" />
				})
			)}
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
	const histories = Record.fromIterableBy(props.histories, machine => machine.worker)
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
						<MachineIcon worker={worker} platform={histories[worker]?.platform ?? Option.none()} />
						<span className="max-w-32 truncate max-sm:sr-only">{machineName(worker)}</span>
						{/* Only an unreachable machine is marked; one that answers needs no dot. */}
						{failed && <StatusDot status="off" label="Unavailable" />}
					</AppBarTab>
				)
			})}
		</AppBarTabs>
	)
}

function MetricsContent(props: {children: ReactNode; minutes: HistoryQuery['minutes']}) {
	return (
		<Loaded atom={metricsAtom(props.minutes)}>
			{() => (
				<CatchBoundary getResetKey={Function.constant('metrics')} errorComponent={ReadFailure}>
					{props.children}
				</CatchBoundary>
			)}
		</Loaded>
	)
}

function DataProblem(props: {minutes: HistoryQuery['minutes']}) {
	return <StaleProblem label="Out of date" readers={[inventoryAtom, metricsAtom(props.minutes)]} />
}

function ProcessList(props: {row: Row}) {
	const processes = Option.getOrElse(props.row.item.processes, Array.empty)
	const tree = processTree(processes)
	return Array.match(processes, {
		onEmpty: () => (
			<Empty role="status">
				<EmptyHeader>
					<EmptyMedia variant="icon">
						<TerminalWindowIcon />
					</EmptyMedia>
					<EmptyTitle>No processes</EmptyTitle>
				</EmptyHeader>
			</Empty>
		),
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
						onFalse: () => (
							<Empty role="status">
								<EmptyHeader>
									<EmptyMedia variant="icon">
										<AppWindowIcon />
									</EmptyMedia>
									<EmptyTitle>Select an app</EmptyTitle>
								</EmptyHeader>
							</Empty>
						),
						onTrue: () => <LoadingRows label="Processes loading" rows={6} />
					}),
				onSome: row => (
					<Suspense fallback={<LoadingRows label="Processes loading" rows={6} />}>
						<InventoryContent>
							<ProcessList row={row} />
						</InventoryContent>
					</Suspense>
				)
			})}
		</div>
	)
}

function chartUsageOf(usage?: Usage) {
	return Option.filter(Option.fromUndefinedOr(usage), current => Array.isReadonlyArrayNonEmpty(current.history.samples))
}

// The desktop detail: the three charts, then the chosen processes.
function DetailPane(props: {
	app?: ItemId
	usage?: Usage
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
					{Option.match(chartUsageOf(props.usage), {
						onNone: () => <EmptyChart worker={props.worker} />,
						onSome: usage => (
							<ChartBlock
								usage={usage}
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
	usage?: Usage
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
					{Option.match(chartUsageOf(props.usage), {
						onNone: () => <EmptyChart />,
						onSome: usage => (
							<ChartBlock
								usage={usage}
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
				lowImpact={props.usage?.lowImpact}
				now={props.now}
				onSelect={props.onSelect}
				rows={props.rows}
				selectedId={props.selectedId}
			/>
		</div>
	)
}

// What the bar opens onto: the two panes on a wide screen, the chart and list on a phone, or the pushed processes.
function Panes(props: {
	active?: WorkerId
	authFailure: Option.Option<unknown>
	free: readonly InventoryItem[]
	usage?: Usage
	isPhone: boolean
	labels: Record<AppId, string>
	minutes: HistoryQuery['minutes']
	now: DateTime.Utc
	onSelect: (row: Row) => void
	pending: boolean
	pushed: boolean
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
			<Workspace>
				<h1 className="sr-only">Deploy</h1>
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
									lowImpact={props.usage?.lowImpact}

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
									usage={props.usage}
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
									usage={props.usage}
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
			</Workspace>
		),
		onSome: error => (
			<Workspace>
				<ReadFailure error={error} reset={props.retryFailed} />
			</Workspace>
		)
	})
}

function HomeRoute() {
	const isPhone = useAtomValue(mediaQueryAtom('(width < 40rem)'))
	const search = route.useSearch()
	const navigate = route.useNavigate()
	function view(next: Partial<Search>) {
		navigate({search: previous => Schema.encodeSync(Search)({...previous, ...next})})
	}
	const minutes = Option.getOrElse(search.range, () => Duration.minutes(1440))
	// The charts keep the last loaded range, unmarked, until the one the URL asks for arrives.
	const shownMinutes = useDeferredValue(minutes)
	const pane = Option.getOrElse(search.pane, Function.constant('apps'))
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
	const inventoryPending = AsyncResult.isInitial(inventory)
	const workers = Array.dedupe([
		...pipe(
			snapshot,
			Option.map(value => value.workers),
			Option.getOrElse(() => [])
		),
		...Array.map(shownHistories, machine => machine.worker)
	])
	const active = Option.getOrUndefined(Option.orElse(search.machine, () => Array.head(workers)))
	const history = Option.getOrUndefined(
		Option.flatMap(Option.fromUndefinedOr(active), current =>
			Array.findFirst(shownHistories, machine => machine.worker === current)
		)
	)
	// The list and the charts share one derivation per history, which the compiler keeps until the history changes.
	const usage = Option.getOrUndefined(Option.map(Option.fromUndefinedOr(history), usageOf))
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
	const sorted = Array.sort(ranged(activeRows, shownMinutes, history), rowOrder)
	const selectedRow = Option.getOrUndefined(
		Option.flatMap(search.app, current => Array.findFirst(activeRows, row => row.item.id === current))
	)
	function selectRow(row: Row) {
		view({app: Option.some(row.item.id), pane: Option.some('process')})
	}

	const pushed = Boolean.match(isPhone, {onFalse: Function.constFalse, onTrue: () => pane === 'process'})

	// A phone's bar names the pushed app and backs out to the list; wider screens keep the wordmark.
	return (
		<div className="flex min-h-0 flex-1 flex-col">
			<AppBar
				heading={Boolean.match(pushed, {
					onFalse: Function.constUndefined,
					onTrue: () => ({
						back: {label: 'Back', onClick: () => view({pane: Option.some('apps')})},
						title: Option.match(Option.fromUndefinedOr(selectedRow), {
							onNone: Function.constant('Processes'),
							onSome: entry => workloadName(entry.item)
						})
					})
				})}
				icon={icon}
				name="deploy"
				controls={Boolean.match(pushed, {
					onFalse: () => (
						<>
							<DataProblem minutes={minutes} />
							<AppBarChoice
								label="Range"
								value={minutes}
								options={RANGES}
								onChange={range => view({range: Option.some(range)})}
							/>
						</>
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
					onTrue: Function.constUndefined
				})}
			/>
			<Panes
				active={active}
				authFailure={authFailure}
				free={free}
				usage={usage}
				isPhone={isPhone}
				labels={bandNames}
				minutes={shownMinutes}
				now={now}
				onSelect={selectRow}
				pending={inventoryPending}
				pushed={pushed}
				retryFailed={retryFailed}
				rows={sorted}
				selectedApp={Option.getOrUndefined(search.app)}
				selectedRow={selectedRow}
			/>
		</div>
	)
}

export const Route = createFileRoute('/(home)/')({
	// Ahead of the loader: TypeScript types `load.deps` from the keys before it.
	loaderDeps: location => ({
		minutes: Duration.toMinutes(Option.getOrElse(location.search.range, () => Duration.minutes(1440)))
	}),

	component: HomeRoute,
	loader: load => preload(load.context, [inventoryAtom, metricsAtom(Duration.minutes(load.deps.minutes))]),
	validateSearch: Schema.toStandardSchemaV1(Search)
})
