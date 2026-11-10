import {useAtomRefresh, useAtomSuspense, useAtomValue} from '@effect/atom-react'

import {Array, Boolean, Cause, Option, Record, Schema, String} from 'effect'

import {HardDrivesIcon, MonitorIcon, TerminalWindowIcon} from '@phosphor-icons/react'
import {CatchBoundary, Link, createFileRoute, getRouteApi} from '@tanstack/react-router'
import {AsyncResult} from 'effect/reactivity'
import {Suspense, useDeferredValue} from 'react'
import type {ReactNode} from 'react'

import {AppBar, AppBarChoice, AppBarTab, AppBarTabs} from '@deslop/components-web/app-bar'
import {EmptyState} from '@deslop/components-web/fallbacks'
import {RowsSkeleton} from '@deslop/components-web/item-list'
import {StaleProblem} from '@deslop/components-web/problem'
import {StatusDot} from '@deslop/components-web/status-dot'
import {ItemActions, ItemContent, ItemMedia} from '@deslop/components-web/ui/item'
import {ResizableHandle, ResizablePanel, ResizablePanelGroup} from '@deslop/components-web/ui/resizable'
import {ScrollArea} from '@deslop/components-web/ui/scroll-area'
import {Skeleton} from '@deslop/components-web/ui/skeleton'
import {cn, useMediaQuery} from '@deslop/components-web/utils'
import {isDenied} from '@deslop/runtime/auth/utils'
import * as WebRuntime from '@deslop/runtime/web'

import {inventoryAtom, metricsAtom} from '#lib/utils.ts'
import {ChartBlock, ChartSkeleton, EmptyChart} from '#routes/(home)/-charts.tsx'
import {InventoryContent, ListPane} from '#routes/(home)/-list.tsx'
import {processTree} from '#routes/(home)/-process-tree.ts'
import {Processes} from '#routes/(home)/-processes.tsx'
import {type Row, failedFor, order, owner, rangeSet, ranged} from '#routes/(home)/-rows.ts'
import {appHue} from '#routes/(home)/-usage.ts'
import icon from '#routes/icon.svg'
import {availablePorts, workloadName, workloads} from '#services/inventory/lib/utils.ts'
import type {InventoryItem} from '#services/inventory/schema.ts'
import {HistoryQuery} from '#services/metrics/schema.ts'
import type {MachineHistory} from '#services/metrics/schema.ts'

// A phone shows the list with the machine's chart above it, or one app's processes full-screen.
type Pane = typeof Pane.Type
const Pane = Schema.Literals(['apps', 'process'])

type Search = typeof Search.Type
const Search = Schema.Struct({
	app: Schema.optionalKey(Schema.String),
	machine: Schema.optionalKey(Schema.String),
	pane: Schema.optionalKey(Pane),
	range: Schema.optionalKey(HistoryQuery.fields.minutes)
})
const route = getRouteApi('/(home)/')

// The range as one stock control: a line of tabs in the bar, the short set on a phone.
function RangeTabs(props: {
	minutes: HistoryQuery['minutes']
	onChange: (minutes: HistoryQuery['minutes']) => void
	ranges: readonly {label: string; minutes: HistoryQuery['minutes']}[]
}) {
	return (
		<AppBarChoice
			label="History range"
			value={`${props.minutes}`}
			options={Array.map(props.ranges, range => ({label: range.label, value: `${range.minutes}`}))}
			onChange={value => {
				Option.map(
					Array.findFirst(props.ranges, range => `${range.minutes}` === value),
					range => props.onChange(range.minutes)
				)
			}}
		/>
	)
}

// The machines as the bar's section control: its icon in the machine's colour and its name; an unreachable one keeps a dot. One machine needs no control.
function machineName(worker: string) {
	return String.split(worker, '.')[0]
}

function MachineIcon(props: {worker: string}) {
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
	active?: string
	histories: readonly MachineHistory[]
	inventoryFailure: boolean
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
						render={<Link to="/" search={previous => ({...previous, app: undefined, machine: worker, pane: 'apps'})} />}
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

// The processes' loading rows: the real mark and name and detail bars, and its two meters right-aligned at the row's end.
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
				<div className="flex items-center gap-1.5">
					<Skeleton className="h-1.5 w-12" />
					<Skeleton className="h-1.5 w-12" />
				</div>
			</ItemActions>
		</RowsSkeleton>
	)
}

function MetricsContent(props: {children: ReactNode; minutes: HistoryQuery['minutes']}) {
	const result = useAtomSuspense(metricsAtom(props.minutes), {includeFailure: true})
	const refresh = useAtomRefresh(metricsAtom(props.minutes))
	if (AsyncResult.isFailure(result) && Option.isNone(AsyncResult.value(result))) {
		return <WebRuntime.Failure error={Cause.squash(result.cause)} reset={refresh} />
	}
	return (
		<CatchBoundary getResetKey={() => 'metrics'} errorComponent={WebRuntime.Failure}>
			{props.children}
		</CatchBoundary>
	)
}

function DataProblem(props: {minutes: HistoryQuery['minutes']}) {
	return <StaleProblem label="Data out of date" readers={[inventoryAtom, metricsAtom(props.minutes)]} />
}

function ProcessList(props: {row: Row}) {
	const processes = props.row.item.processes ?? []
	const tree = processTree(processes)
	const hue = Option.getOrElse(appHue(workloadName(props.row.item)), () => 'var(--blue)')
	return Array.match(processes, {
		onEmpty: () => <EmptyState icon={<TerminalWindowIcon weight="light" />} label="No processes right now" />,
		onNonEmpty: () => (
			<ScrollArea className="min-h-0 flex-1">
				<Processes hue={hue} tree={tree} />
			</ScrollArea>
		)
	})
}

// The processes below the chart, or a phone's pushed pane; nothing selected is one symbol.
function SelectedProcesses(props: {app?: string; pending: boolean; row?: Row}) {
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

// The desktop detail: the three charts, then the chosen processes.
function DetailPane(props: {
	app?: string
	history?: MachineHistory
	labels: Record<string, string>
	minutes: HistoryQuery['minutes']
	pending: boolean
	row?: Row
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
								<ChartBlock history={history} isPhone={false} labels={props.labels} minutes={props.minutes} />
							)
						}
					)}
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
	labels: Record<string, string>
	minutes: HistoryQuery['minutes']
	now: number
	onSelect: (row: Row) => void
	rows: readonly Row[]
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
							onSome: history => <ChartBlock history={history} isPhone labels={props.labels} minutes={props.minutes} />
						}
					)}
				</MetricsContent>
			</Suspense>
			<ListPane
				className="min-h-0 flex-1"
				compact
				free={props.free}
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
	active?: string
	authFailure: Option.Option<unknown>
	free: readonly InventoryItem[]
	history?: MachineHistory
	isPhone: boolean
	labels: Record<string, string>
	minutes: HistoryQuery['minutes']
	now: number
	onSelect: (row: Row) => void
	pending: boolean
	pushed: boolean
	refreshing: boolean
	retryFailed: () => void
	rows: readonly Row[]
	selectedApp?: string
	selectedRow?: Row
}) {
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
		onSome: error => <WebRuntime.Failure error={error} reset={props.retryFailed} />
	})
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
	const rows = Option.getOrElse(
		Option.map(snapshot, value => workloads(value.items)),
		() => []
	)
	const free = availablePorts(rows)
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
	const sorted = Array.sort(ranged(activeRows, shownMinutes, Option.getOrUndefined(history)), order)
	const selectedRow = Option.getOrUndefined(
		Option.flatMap(Option.fromUndefinedOr(search.app), current =>
			Array.findFirst(activeRows, row => row.item.id === current)
		)
	)
	const ranges = rangeSet(isPhone, minutes)

	function selectRow(row: Row) {
		view({app: row.item.id, pane: 'process'})
	}

	const pushed = Boolean.match(isPhone, {onFalse: () => false, onTrue: () => pane === 'process'})

	// A phone's bar names the pushed app and backs out to the list; wider screens keep the wordmark.
	return (
		<div className="flex min-h-0 flex-1 flex-col">
			<AppBar
				heading={Boolean.match(pushed, {
					onFalse: () => undefined,
					onTrue: () => ({
						back: {label: 'Back', onClick: () => view({pane: 'apps'})},
						title: Option.match(Option.fromUndefinedOr(selectedRow), {
							onNone: () => 'Processes',
							onSome: entry => workloadName(entry.item)
						})
					})
				})}
				icon={icon}
				name="deploy"
				controls={
					<div className="flex items-center gap-1">
						<DataProblem minutes={minutes} />
						<RangeTabs minutes={minutes} onChange={range => view({range})} ranges={ranges} />
					</div>
				}
				tabs={
					<MachineTabs
						active={active}
						histories={shownHistories}
						inventoryFailure={inventoryFailure}
						sources={sources}
						workers={workers}
					/>
				}
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
				selectedApp={search.app}
				selectedRow={selectedRow}
			/>
		</div>
	)
}

export const Route = createFileRoute('/(home)/')({component: Home, validateSearch: WebRuntime.searchOf(Search)})
