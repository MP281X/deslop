import {useAtomRefresh, useAtomValue} from '@effect/atom-react'

import type {DateTime} from 'effect'
import {Array, Boolean, Duration, Function, Option, Record, Schema, pipe} from 'effect'

import {AppWindowIcon, TerminalWindowIcon} from '@phosphor-icons/react'
import {CatchBoundary, createFileRoute, getRouteApi} from '@tanstack/react-router'
import {AsyncResult} from 'effect/reactivity'
import {Suspense, useDeferredValue, useState} from 'react'
import type {ReactNode} from 'react'

import {StaleProblem} from '@deslop/components-web/blocks/problem'
import {LoadingRows} from '@deslop/components-web/blocks/rows'
import {Loaded, ReadFailure} from '@deslop/components-web/blocks/states'
import {mediaQueryAtom} from '@deslop/components-web/lib/media'
import {foldedAtom, FOLD_COLUMNS} from '@deslop/components-web/lib/posture'
import {preload} from '@deslop/components-web/lib/router'
import {AppBar, AppBarChoice} from '@deslop/components-web/shell/app-bar'
import {Workspace} from '@deslop/components-web/shell/workspace'
import {Empty, EmptyHeader, EmptyMedia, EmptyTitle} from '@deslop/components-web/ui/empty'
import {ResizableHandle, ResizablePanel, ResizablePanelGroup} from '@deslop/components-web/ui/resizable'
import {ScrollArea} from '@deslop/components-web/ui/scroll-area'
import {clockAtom} from '@deslop/runtime/client/clock'
import {isDenied} from '@deslop/runtime/shared/auth'

import {inventoryAtom, metricsAtom} from '#lib/machine.ts'
import {RANGES} from '#routes/(home)/-chart.ts'
import {ChartBlock, ChartSkeleton, EmptyChart, ReadingStrip, ReadingStripSkeleton} from '#routes/(home)/-charts.tsx'
import {InventoryContent, ListPane} from '#routes/(home)/-list.tsx'
import {Processes, Reasons} from '#routes/(home)/-processes.tsx'
import {rowOrder, owner, ranged} from '#routes/(home)/-rows.ts'
import {usageOf} from '#routes/(home)/-usage.ts'
import type {Usage} from '#routes/(home)/-usage.ts'
import icon from '#routes/icon.svg'
import {type Row, availablePorts, processTree, workloadName, workloads} from '#services/inventory/lib/utils.ts'
import {ItemId} from '#services/inventory/schema.ts'
import type {AppId, InventoryItem} from '#services/inventory/schema.ts'
import {HistoryQuery} from '#services/metrics/schema.ts'

// The list's width in each layout.
const LIST_SIZES = {half: '50%', narrow: 270, phone: '100%', roomy: 440, wide: 340} as const satisfies Record<
	Layout,
	number | string
>

// How much room the apps and the detail share: a phone stacks them; from 640px they stand side by side, the list 270px wide until 900px, then half the width up to 1000px, then 340px, and 440px from 1512px.
type Layout = typeof Layout.Type
const Layout = Schema.Literals(['phone', 'narrow', 'half', 'wide', 'roomy'])
function layoutOf(widths: {narrow: boolean; phone: boolean; roomy: boolean; wide: boolean}) {
	if (widths.phone) return 'phone' as const
	if (widths.narrow) return 'narrow' as const
	if (!widths.wide) return 'half' as const
	return Boolean.match(widths.roomy, {
		onFalse: Function.constant('wide' as const),
		onTrue: Function.constant('roomy' as const)
	})
}

// A phone shows the list under one row of the machine's readings, or one app's processes full-screen.
type Pane = typeof Pane.Type
const Pane = Schema.Literals(['apps', 'process'])

type Search = typeof Search.Type
export const Search = Schema.Struct({
	app: Schema.OptionFromOptionalKey(ItemId),
	pane: Schema.OptionFromOptionalKey(Pane),
	range: Schema.OptionFromOptionalKey(HistoryQuery.fields.minutes)
})
const route = getRouteApi('/(home)/')

function MetricsContent(props: {children: ReactNode; minutes: HistoryQuery['minutes']}) {
	return (
		<Loaded atom={metricsAtom({minutes: props.minutes})}>
			{() => (
				<CatchBoundary getResetKey={Function.constant('metrics')} errorComponent={ReadFailure}>
					{props.children}
				</CatchBoundary>
			)}
		</Loaded>
	)
}

function DataProblem(props: {minutes: HistoryQuery['minutes']}) {
	return <StaleProblem label="Out of date" readers={[inventoryAtom, metricsAtom({minutes: props.minutes})]} />
}

// The opened row scrolls as one, so every reason and the processes under them can be reached; with no processes their symbol takes the room the reasons leave.
function ProcessList(props: {row: Row}) {
	const processes = Option.getOrElse(props.row.item.processes, Array.empty)
	const tree = processTree(processes)
	return (
		<ScrollArea className="min-h-0 flex-1">
			<div className="flex min-h-full flex-col">
				<Reasons row={props.row} />
				{Array.match(processes, {
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
					onNonEmpty: () => <Processes tree={tree} />
				})}
			</div>
		</ScrollArea>
	)
}

// The processes below the chart, or a phone's pushed pane; nothing selected is one symbol.
function SelectedProcesses(props: {app: Option.Option<ItemId>; pending: boolean; row: Option.Option<Row>}) {
	return (
		<div className="flex min-h-0 flex-1 flex-col">
			{Option.match(props.row, {
				onNone: () =>
					Boolean.match(props.pending && Option.isSome(props.app), {
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

function chartUsageOf(usage: Option.Option<Usage>) {
	return Option.filter(usage, current => Array.isReadonlyArrayNonEmpty(current.history.samples))
}

// The desktop detail: the three charts, then the chosen processes.
function DetailPane(props: {
	app: Option.Option<ItemId>
	usage: Option.Option<Usage>
	labels: Record<AppId, string>
	minutes: HistoryQuery['minutes']
	pending: boolean
	row: Option.Option<Row>
}) {
	return (
		<div className="flex h-full min-h-0 flex-col">
			<Suspense fallback={<ChartSkeleton minutes={props.minutes} />}>
				<MetricsContent minutes={props.minutes}>
					{Option.match(chartUsageOf(props.usage), {
						onNone: () => <EmptyChart />,
						onSome: usage => (
							<ChartBlock
								usage={usage}
								labels={props.labels}
								minutes={props.minutes}
								selectedOwner={Option.flatMap(props.row, owner)}
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

// A phone's list view: the readings in one row, then the rows edge to edge in the page's one scroller.
function PhoneList(props: {
	free: readonly InventoryItem[]
	usage: Option.Option<Usage>
	minutes: HistoryQuery['minutes']
	now: DateTime.Utc
	onSelect: (row: Row) => void
	rows: readonly Row[]
	selectedId: Option.Option<ItemId>
}) {
	return (
		<div className="flex min-h-0 flex-1 flex-col">
			<Suspense fallback={<ReadingStripSkeleton />}>
				<MetricsContent minutes={props.minutes}>
					<ReadingStrip history={Option.map(chartUsageOf(props.usage), usage => usage.history)} />
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
				spark={false}
				usage={props.usage}
			/>
		</div>
	)
}

// The apps and the detail side by side, or the detail alone once the list is folded away: half open like a book they are the two halves of the screen, otherwise the list is as wide as its layout gives and the handle moves it.
function SplitPanes(props: {detail: ReactNode; folded: boolean; layout: Layout; list: ReactNode; listHidden: boolean}) {
	if (props.listHidden) return props.detail
	if (props.folded) {
		return (
			<div className="grid min-h-0 flex-1 grid-cols-(--fold-columns)" style={{'--fold-columns': FOLD_COLUMNS}}>
				<div className="min-h-0 min-w-0 border-r">{props.list}</div>
				<div className="col-start-3 min-h-0">{props.detail}</div>
			</div>
		)
	}
	return (
		<ResizablePanelGroup key={props.layout} className="min-h-0 flex-1" orientation="horizontal">
			<ResizablePanel
				className="min-h-0"
				defaultSize={LIST_SIZES[props.layout]}
				groupResizeBehavior="preserve-pixel-size"
				minSize={Boolean.match(props.layout === 'narrow', {
					onFalse: Function.constant(260),
					onTrue: Function.constant(200)
				})}
				maxSize={480}
			>
				{props.list}
			</ResizablePanel>
			<ResizableHandle />
			{/* Room for CPU, Memory and Disk side by side, however far the handle moves the list. */}
			<ResizablePanel className="min-h-0" minSize={320}>
				{props.detail}
			</ResizablePanel>
		</ResizablePanelGroup>
	)
}

// What the bar opens onto: the apps beside the detail, the detail alone with the list folded away, the readings and list on a phone, or the pushed processes.
function Panes(props: {
	authFailure: Option.Option<unknown>
	free: readonly InventoryItem[]
	usage: Option.Option<Usage>
	folded: boolean
	labels: Record<AppId, string>
	layout: Layout
	listHidden: boolean
	minutes: HistoryQuery['minutes']
	now: DateTime.Utc
	onSelect: (row: Row) => void
	pending: boolean
	pushed: boolean
	retryFailed: () => void
	rows: readonly Row[]
	selectedApp: Option.Option<ItemId>
	selectedRow: Option.Option<Row>
}) {
	return Option.match(props.authFailure, {
		onNone: () => (
			<Workspace>
				<h1 className="sr-only">Deploy</h1>
				{Boolean.match(props.layout === 'phone', {
					onFalse: () => (
						<SplitPanes
							detail={
								<DetailPane
									app={props.selectedApp}
									usage={props.usage}
									labels={props.labels}
									minutes={props.minutes}
									pending={props.pending}
									row={props.selectedRow}
								/>
							}
							folded={props.folded}
							layout={props.layout}
							// The list's sparkline needs 340px; only the 270px list beside the detail goes without, and half the screen at the fold is wide enough.
							list={
								<ListPane
									className="h-full min-w-0"
									compact={false}
									free={props.free}
									now={props.now}
									onSelect={props.onSelect}
									rows={props.rows}
									selectedId={Option.map(props.selectedRow, row => row.item.id)}
									spark={props.layout !== 'narrow' || props.folded}
									usage={props.usage}
								/>
							}
							listHidden={props.listHidden}
						/>
					),
					onTrue: () =>
						Boolean.match(props.pushed, {
							onFalse: () => (
								<PhoneList
									free={props.free}
									usage={props.usage}
									minutes={props.minutes}
									now={props.now}
									onSelect={props.onSelect}
									rows={props.rows}
									selectedId={Option.map(props.selectedRow, row => row.item.id)}
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
	// Below 640px the list and the three charts would each be too narrow to read: a phone's list and its row of readings take their place.
	const layout = layoutOf({
		narrow: useAtomValue(mediaQueryAtom('(width < 56.25rem)')),
		phone: useAtomValue(mediaQueryAtom('(width < 40rem)')),
		roomy: useAtomValue(mediaQueryAtom('(width >= 94.5rem)')),
		wide: useAtomValue(mediaQueryAtom('(width >= 62.5rem)'))
	})
	const isPhone = layout === 'phone'
	const folded = useAtomValue(foldedAtom)
	const [listHidden, setListHidden] = useState(false)
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
	const metrics = useAtomValue(metricsAtom({minutes: shownMinutes}))
	const refreshInventory = useAtomRefresh(inventoryAtom)
	const refreshMetrics = useAtomRefresh(metricsAtom({minutes: shownMinutes}))
	function retryFailed() {
		if (AsyncResult.isFailure(inventory)) refreshInventory()
		if (AsyncResult.isFailure(metrics)) refreshMetrics()
	}
	const snapshot = AsyncResult.value(inventory)
	const history = AsyncResult.value(metrics)
	// A revoked session shows the sign-in even while a cached snapshot remains.
	const authFailure = pipe(
		AsyncResult.error(inventory),
		Option.filter(isDenied),
		Option.orElse(() => Option.filter(AsyncResult.error(metrics), isDenied))
	)
	const inventoryPending = AsyncResult.isInitial(inventory)
	// The list and the charts share one derivation per history, which the compiler keeps until the history changes.
	const usage = Option.map(history, usageOf)
	const rows = pipe(
		snapshot,
		Option.map(value => workloads(value.items)),
		Option.getOrElse(() => [])
	)
	const free = availablePorts(rows)
	const now = useAtomValue(clockAtom('1 second'))
	const bandNames = Record.fromEntries(
		Array.flatMap(rows, row =>
			Option.match(owner(row), {onNone: () => [], onSome: id => [[id, workloadName(row.item)] as const]})
		)
	) satisfies Record<AppId, string>
	const sorted = Array.sort(ranged(rows, shownMinutes, history), rowOrder)
	const selectedRow = Option.flatMap(search.app, current => Array.findFirst(rows, row => row.item.id === current))
	function selectRow(row: Row) {
		view({app: Option.some(row.item.id), pane: Option.some('process')})
	}

	const pushed = Boolean.match(isPhone, {onFalse: Function.constFalse, onTrue: () => pane === 'process'})

	// A phone's bar names the pushed app and backs out to the list; wider screens keep the wordmark.
	return (
		<div className="flex min-h-0 flex-1 flex-col">
			<AppBar
				{...Boolean.match(pushed, {
					onFalse: () => ({}),
					onTrue: () => ({
						heading: {
							back: {label: 'Back', onClick: () => view({pane: Option.some('apps')})},
							title: Option.match(selectedRow, {
								onNone: Function.constant('Processes'),
								onSome: entry => workloadName(entry.item)
							})
						}
					})
				})}
				icon={icon}
				name="deploy"
				{...Boolean.match(isPhone, {
					onFalse: () => ({sidebar: {hidden: listHidden, onToggle: () => setListHidden(hidden => !hidden)}}),
					onTrue: () => ({})
				})}
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
			/>
			<Panes
				authFailure={authFailure}
				free={free}
				usage={usage}
				folded={folded}
				labels={bandNames}
				layout={layout}
				listHidden={listHidden}
				minutes={shownMinutes}
				now={now}
				onSelect={selectRow}
				pending={inventoryPending}
				pushed={pushed}
				retryFailed={retryFailed}
				rows={sorted}
				selectedApp={search.app}
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
	loader: load => preload(load, [inventoryAtom, metricsAtom({minutes: Duration.minutes(load.deps.minutes)})]),
	validateSearch: Schema.toStandardSchemaV1(Search)
})
