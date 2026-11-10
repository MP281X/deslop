import {useAtomRefresh, useAtomSuspense, useAtomValue} from '@effect/atom-react'

import {Array, Boolean, Cause, DateTime, Match, Number, Option, Record, String, Struct, pipe} from 'effect'

import {ChartBarHorizontalIcon, DeviceMobileIcon, FlowArrowIcon, GlobeIcon, HardDrivesIcon} from '@phosphor-icons/react'
import {Link, createFileRoute, getRouteApi} from '@tanstack/react-router'
import {AsyncResult} from 'effect/reactivity'
import {Suspense, useEffect, useState} from 'react'
import type {ReactElement, ReactNode} from 'react'

import {AppBar, AppBarChoice, AppBarTab, AppBarTabs} from '@deslop/components-web/app-bar'
import {appMarks} from '@deslop/components-web/apps'
import {EmptyState} from '@deslop/components-web/fallbacks'
import {ItemListHeading, RowsSkeleton} from '@deslop/components-web/item-list'
import {StaleProblem} from '@deslop/components-web/problem'
import {StatusDot} from '@deslop/components-web/status-dot'
import {Item, ItemActions, ItemContent, ItemMedia, ItemTitle} from '@deslop/components-web/ui/item'
import {ResizableHandle, ResizablePanel, ResizablePanelGroup} from '@deslop/components-web/ui/resizable'
import {ScrollArea} from '@deslop/components-web/ui/scroll-area'
import {Skeleton} from '@deslop/components-web/ui/skeleton'
import {cn, useMediaQuery} from '@deslop/components-web/utils'
import {isDenied} from '@deslop/runtime/auth/utils'
import * as WebRuntime from '@deslop/runtime/web'

import {Search} from '#lib/schema.ts'
import type {OperationKey} from '#lib/schema.ts'
import {
	ageOf,
	durationOf,
	focusOf,
	navigationOf,
	nextSearch,
	nowAtom,
	operationsOf,
	overviewAtom,
	selectionOf,
	traceAtom,
	traceLabel
} from '#lib/utils.ts'
import type {ActiveOperation, NavigationEvent} from '#lib/utils.ts'
import {Flame, SpansSkeleton, TimeAxis} from '#routes/(home)/-flame.tsx'
import {CiMark, DetailSkeleton, SpanDetail} from '#routes/(home)/-span.tsx'
import icon from '#routes/icon.svg'
import {Range, rangeStart} from '#services/telemetry/schema.ts'
import type {Operation, OperationTrace, Overview, Runtime, Trace} from '#services/telemetry/schema.ts'

// The side an operation starts on: a 12px muted glyph after the name when two visible rows share it, and its name for their labels.
const SIDES: Record<Runtime, string> = {ci: 'CI', mobile: 'iOS', server: 'server', unknown: '', web: 'web'}

const KINDS: Record<Runtime, ReactElement> = {
	ci: <FlowArrowIcon aria-hidden className="text-muted-foreground size-3 shrink-0" />,
	mobile: <DeviceMobileIcon aria-hidden className="text-muted-foreground size-3 shrink-0" />,
	server: <HardDrivesIcon aria-hidden className="text-muted-foreground size-3 shrink-0" />,
	unknown: <HardDrivesIcon aria-hidden className="text-muted-foreground size-3 shrink-0" />,
	web: <GlobeIcon aria-hidden className="text-muted-foreground size-3 shrink-0" />
}

const clock = new Intl.DateTimeFormat(undefined, {
	hour: '2-digit',
	hourCycle: 'h23',
	minute: '2-digit',
	second: '2-digit'
})
const count = new Intl.NumberFormat(undefined, {maximumFractionDigits: 0})
const compact = new Intl.NumberFormat(undefined, {maximumFractionDigits: 1, notation: 'compact'})

// One run or many, in the reader's words.
function runsOf(n: number) {
	return `${count.format(n)} ${Boolean.match(n === 1, {onFalse: () => 'runs', onTrue: () => 'run'})}`
}
const route = getRouteApi('/(home)/')
const RANGES = Array.map(Range.literals, value => ({label: value, value}))

type WorkspaceProps = {
	active?: ActiveOperation
	activeKey?: OperationKey
	activeTrace?: OperationTrace
	now: number
	onPickSpan: (id: string) => void
	onSelectOperation: (app: string, operation: Operation) => void
	onSelectTrace: (trace: OperationTrace) => void
	pickedSpan?: string
	range: Range
	source?: string
}

// The operations rows' geometry while the overview loads: the name at the gutter, then the same figure columns.
function OperationsSkeleton(props: {label: string}) {
	return (
		<RowsSkeleton label={props.label} rows={8}>
			<ItemContent>
				<Skeleton className="h-3 w-2/5" />
			</ItemContent>
			<ItemActions>
				<span className="grid-cols-operation grid items-center gap-x-3">
					<Skeleton className="h-3 w-full" />
					<Skeleton className="h-3 w-full" />
					<Skeleton className="h-3 w-full" />
				</span>
			</ItemActions>
		</RowsSkeleton>
	)
}

// The trace rows' geometry while the overview loads: the age slot, the short id where names sit, and the duration column.
function TracesSkeleton(props: {label: string}) {
	return (
		<RowsSkeleton label={props.label} rows={8}>
			<ItemMedia className="w-8">
				<Skeleton className="h-3 w-6" />
			</ItemMedia>
			<ItemContent>
				<Skeleton className="h-3 w-14" />
			</ItemContent>
			<ItemActions>
				<span className="flex w-12 justify-end">
					<Skeleton className="h-3 w-10" />
				</span>
			</ItemActions>
		</RowsSkeleton>
	)
}

// An app's mark: its own icon, GitHub's for CI, else a server glyph; never a letter tile. A heading names the app, so the mark is decorative.
function AppMark(props: {app: Overview['apps'][number]}) {
	return Option.match(Option.fromUndefinedOr(appMarks[props.app.name]), {
		onNone: () =>
			Boolean.match(props.app.ci === true, {
				onFalse: () => <HardDrivesIcon aria-hidden className="text-muted-foreground size-4 shrink-0" />,
				onTrue: () => <CiMark />
			}),
		onSome: mark => <img src={mark} alt="" className="pixelated size-4 shrink-0" />
	})
}

// The waterfall's mark, and the trace list's until an operation is chosen.
function WaterfallGlyph() {
	return <ChartBarHorizontalIcon aria-hidden className="text-muted-foreground size-4 shrink-0" />
}

// The bar's app choice: one mark per app; one is always chosen, and choosing the chosen tab again does nothing.
function SourceTabs(props: {apps: Overview['apps']; source?: string}) {
	return (
		<AppBarTabs value={props.source ?? ''}>
			{Array.map(props.apps, app => (
				<AppBarTab
					key={app.name}
					value={app.name}
					render={
						<Link
							to="/"
							aria-label={app.name}
							search={previous => nextSearch(previous, {_tag: 'Source', app: app.name})}
							onClick={event => {
								if (app.name === props.source) event.preventDefault()
							}}
						/>
					}
				>
					<AppMark app={app} />
				</AppBarTab>
			))}
		</AppBarTabs>
	)
}

// The page's time frame as one stock control: the same four tabs at every width.
function RangeTabs(props: {onChange: (range: Range) => void; range: Range}) {
	return (
		<AppBarChoice
			label="Time frame"
			value={props.range}
			options={RANGES}
			onChange={value => {
				Option.map(
					Array.findFirst(RANGES, entry => entry.value === value),
					entry => props.onChange(entry.value)
				)
			}}
		/>
	)
}

// Suspend the rows, not their shell. Home owns failures; ordinary outages retain the last overview.
function OverviewContent(props: {children: (overview: Overview) => ReactNode; range: Range}) {
	return Option.match(AsyncResult.value(useAtomSuspense(overviewAtom(props.range), {includeFailure: true})), {
		onNone: () => null,
		onSome: props.children
	})
}

// One operation: its name and side when two rows share it, then errors while any row in its list has them, runs and typical duration.
function OperationRow(props: {
	active: boolean
	duplicate: boolean
	failing: boolean
	onSelect: () => void
	operation: Operation
}) {
	const side = SIDES[props.operation.runtime]
	return (
		<div role="listitem">
			<Item
				size="row"
				data-selected={Boolean.match(props.active, {onFalse: () => undefined, onTrue: () => 'true' as const})}
				render={
					<button
						type="button"
						aria-label={Array.join(
							[
								props.operation.name,
								...Boolean.match(props.duplicate && side !== '', {onFalse: () => [], onTrue: () => [side]}),
								...Boolean.match(props.operation.failures > 0, {
									onFalse: () => [],
									onTrue: () => [`${count.format(props.operation.failures)} failed`]
								}),
								runsOf(props.operation.count),
								`${durationOf(props.operation.p50Ms)} typical`
							],
							', '
						)}
						aria-current={Boolean.match(props.active, {onFalse: () => undefined, onTrue: () => 'true' as const})}
						onClick={props.onSelect}
					/>
				}
			>
				<ItemContent>
					<ItemTitle className="w-full" title={props.operation.name}>
						<span className="min-w-0 truncate">{props.operation.name}</span>
						{props.duplicate && KINDS[props.operation.runtime]}
					</ItemTitle>
				</ItemContent>
				<ItemActions>
					<span
						className={cn(
							'grid items-center gap-x-3',
							Boolean.match(props.failing, {onFalse: () => 'grid-cols-runs', onTrue: () => 'grid-cols-operation'})
						)}
					>
						{props.failing && (
							<span
								className="text-destructive text-right tabular-nums"
								title={Boolean.match(props.operation.failures > 0, {
									onFalse: () => undefined,
									onTrue: () => `${count.format(props.operation.failures)} failed`
								})}
							>
								{Boolean.match(props.operation.failures > 0, {
									onFalse: () => null,
									onTrue: () => count.format(props.operation.failures)
								})}
							</span>
						)}
						<span className="text-muted-foreground text-right tabular-nums" title={runsOf(props.operation.count)}>
							{compact.format(props.operation.count)}
						</span>
						<span className="text-right tabular-nums" title="Typical duration">
							{durationOf(props.operation.p50Ms)}
						</span>
					</span>
				</ItemActions>
			</Item>
		</div>
	)
}

// One operations list, narrowed to the bar's chosen app; no groups or headings.
function OperationsPane(props: {
	activeKey?: OperationKey
	className?: string
	onSelect: (app: string, operation: Operation) => void
	range: Range
	source?: string
}) {
	return (
		<section aria-label="Operations" className={cn('flex h-full min-h-0 flex-col overflow-hidden', props.className)}>
			<Suspense fallback={<OperationsSkeleton label="Operations" />}>
				<OverviewContent range={props.range}>
					{overview =>
						Array.match(operationsOf(overview, props.source), {
							onEmpty: () => (
								<EmptyState label="No traces in this frame" icon={<ChartBarHorizontalIcon weight="light" />} />
							),
							onNonEmpty: rows => {
								const names = Array.groupBy(rows, row => row.operation.name)
								const failing = Array.some(rows, row => row.operation.failures > 0)
								return (
									<ScrollArea className="min-h-0 flex-1">
										<div role="list">
											{Array.map(rows, row => (
												<OperationRow
													key={`${row.app.name} ${row.operation.runtime} ${row.operation.name}`}
													active={
														props.activeKey !== undefined &&
														props.activeKey.app === row.app.name &&
														props.activeKey.runtime === row.operation.runtime &&
														props.activeKey.name === row.operation.name
													}
													duplicate={Option.exists(Record.get(names, row.operation.name), group => group.length > 1)}
													failing={failing}
													onSelect={() => props.onSelect(row.app.name, row.operation)}
													operation={row.operation}
												/>
											))}
										</div>
									</ScrollArea>
								)
							}
						})
					}
				</OverviewContent>
			</Suspense>
		</section>
	)
}

// One trace of the operation: its age, short id with its failure dot right after, and its duration; the row selects it.
function TraceListRow(props: {active: boolean; now: number; onSelect: () => void; trace: OperationTrace}) {
	return (
		<div role="listitem">
			<Item
				size="row"
				data-selected={Boolean.match(props.active, {onFalse: () => undefined, onTrue: () => 'true' as const})}
				render={
					<button
						type="button"
						aria-label={Array.join(
							[
								ageOf(props.trace.time, props.now),
								`trace ${traceLabel(props.trace)}`,
								...Option.match(Option.fromUndefinedOr(props.trace.failure), {
									onNone: () => [],
									onSome: failure => [`failed in ${failure.span}`]
								}),
								durationOf(props.trace.durationMs)
							],
							', '
						)}
						aria-current={Boolean.match(props.active, {onFalse: () => undefined, onTrue: () => 'true' as const})}
						onClick={props.onSelect}
					/>
				}
			>
				<ItemMedia className="w-8">
					<span
						className="text-muted-foreground tabular-nums"
						title={Option.match(Number.parse(String.slice(0, -6)(props.trace.time)), {
							onNone: () => '—',
							onSome: timestamp => clock.format(timestamp)
						})}
					>
						{ageOf(props.trace.time, props.now)}
					</span>
				</ItemMedia>
				<ItemContent>
					<span className="flex min-w-0 items-center gap-1.5">
						<span className="truncate" title={props.trace.id}>
							{traceLabel(props.trace)}
						</span>
						{props.trace.failure !== undefined && (
							<span
								role="img"
								className="flex shrink-0 items-center"
								aria-label={`Failed in ${props.trace.failure.span}`}
								title={`Failed in ${props.trace.failure.span}`}
							>
								<StatusDot status="error" />
							</span>
						)}
					</span>
				</ItemContent>
				<ItemActions>
					<span className="w-12 text-right tabular-nums">{durationOf(props.trace.durationMs)}</span>
				</ItemActions>
			</Item>
		</div>
	)
}

// The chosen operation's traces; nothing selects until one is chosen.
function TracesPane(props: {
	active?: ActiveOperation
	className?: string
	now: number
	onSelect: (trace: OperationTrace) => void
	range: Range
	selectedTrace?: OperationTrace
}) {
	const active = Option.fromUndefinedOr(props.active)
	return (
		<section aria-label="Traces" className={cn('flex h-full min-h-0 flex-col overflow-hidden', props.className)}>
			<ItemListHeading
				icon={Option.match(active, {
					onNone: () => <WaterfallGlyph />,
					onSome: current => <AppMark app={current.app} />
				})}
			>
				{Option.match(active, {onNone: () => null, onSome: current => current.operation.name})}
			</ItemListHeading>
			<Suspense fallback={<TracesSkeleton label="Traces" />}>
				<OverviewContent range={props.range}>
					{() =>
						Option.match(active, {
							onNone: () => <EmptyState label="Select an operation" icon={<ChartBarHorizontalIcon weight="light" />} />,
							onSome: current =>
								Boolean.match(Array.isReadonlyArrayNonEmpty(current.operation.traces), {
									onFalse: () => <EmptyState label="No traces" icon={<ChartBarHorizontalIcon weight="light" />} />,
									onTrue: () => (
										<ScrollArea className="min-h-0 flex-1">
											<div role="list">
												{Array.map(current.operation.traces, trace => (
													<TraceListRow
														key={trace.id}
														active={props.selectedTrace?.id === trace.id}
														now={props.now}
														onSelect={() => props.onSelect(trace)}
														trace={trace}
													/>
												))}
											</div>
										</ScrollArea>
									)
								})
						})
					}
				</OverviewContent>
			</Suspense>
		</section>
	)
}

// The picked span's details alone, for the phone's pushed span screen.
function SpanDetails(props: {focus: Option.Option<Trace['spans'][number]>}) {
	return Option.match(props.focus, {
		onNone: () => <EmptyState label="Select a span" icon={<ChartBarHorizontalIcon weight="light" />} />,
		onSome: span => (
			<ScrollArea className="min-h-0 flex-1">
				<div className="flex flex-col">
					<SpanDetail span={span} />
				</div>
			</ScrollArea>
		)
	})
}

// The trace's flame under its pinned time axis, then, when inline, the picked span's details after one hairline.
function SpansList(props: {
	focus: Option.Option<Trace['spans'][number]>
	inlineDetails: boolean
	onPick: (id: string) => void
	trace: Trace
}) {
	if (!Array.isReadonlyArrayNonEmpty(props.trace.spans)) {
		return <EmptyState label="No spans" icon={<ChartBarHorizontalIcon weight="light" />} />
	}
	return (
		<ScrollArea className="min-h-0 flex-1">
			<TimeAxis totalMs={props.trace.durationMs} />
			<Flame
				focus={Option.getOrUndefined(Option.map(props.focus, span => span.spanId))}
				onPick={props.onPick}
				trace={props.trace}
			/>
			{Boolean.match(props.inlineDetails && Option.isSome(props.focus), {
				onFalse: () => null,
				onTrue: () => (
					<div className="border-t">
						{Option.match(props.focus, {onNone: () => null, onSome: span => <SpanDetail span={span} />})}
					</div>
				)
			})}
		</ScrollArea>
	)
}

// The page's readers as one mark: the oldest age among those still showing content, and one retry for them all.
function StaleMark(props: {range: Range; trace?: OperationTrace}) {
	return Option.match(Option.fromUndefinedOr(props.trace), {
		onNone: () => <StaleProblem label="Out of date" readers={[overviewAtom(props.range)]} />,
		onSome: trace => (
			<StaleProblem label="Out of date" readers={[overviewAtom(props.range), traceAtom(props.range, trace.id)]} />
		)
	})
}

function Spans(props: {
	detailOnly?: boolean
	id: string
	inlineDetails?: boolean
	onPick: (id: string) => void
	pickedSpan?: string
	range: Range
}) {
	const atom = traceAtom(props.range, props.id)
	const result = useAtomSuspense(atom, {includeFailure: true})
	const refresh = useAtomRefresh(atom)
	const value = AsyncResult.value(result)
	if (AsyncResult.isFailure(result) && (Option.isNone(value) || Option.exists(AsyncResult.error(result), isDenied))) {
		return <WebRuntime.Failure error={Cause.squash(result.cause)} reset={refresh} />
	}
	return Option.match(value, {
		onNone: () => null,
		onSome: trace => {
			const focus = focusOf(trace, props.pickedSpan)
			if (props.detailOnly === true) return <SpanDetails focus={focus} />
			return (
				<SpansList focus={focus} inlineDetails={props.inlineDetails === true} onPick={props.onPick} trace={trace} />
			)
		}
	})
}

// The open trace's waterfall: a band naming its short id and age, then, when inline, the picked span's details.
function TracePane(props: {
	className?: string
	detailOnly?: boolean
	inlineDetails?: boolean
	now: number
	onPickSpan: (id: string) => void
	pickedSpan?: string
	range: Range
	trace?: OperationTrace
}) {
	const trace = Option.fromUndefinedOr(props.trace)
	return (
		<section aria-label="Trace" className={cn('flex h-full min-h-0 flex-col overflow-hidden', props.className)}>
			{Boolean.match(props.detailOnly === true, {
				onFalse: () => (
					<ItemListHeading icon={<WaterfallGlyph />}>
						{Option.match(trace, {
							onNone: () => null,
							onSome: current => `${traceLabel(current)} · ${ageOf(current.time, props.now)}`
						})}
					</ItemListHeading>
				),
				onTrue: () => null
			})}
			<Suspense
				fallback={Boolean.match(props.detailOnly === true, {
					onFalse: () => <SpansSkeleton label="Spans" />,
					onTrue: () => <DetailSkeleton label="Span details" />
				})}
			>
				<OverviewContent range={props.range}>
					{() =>
						Option.match(trace, {
							onNone: () => (
								<EmptyState
									label={Boolean.match(props.detailOnly === true, {
										onFalse: () => 'Select a trace',
										onTrue: () => 'Select a span'
									})}
									icon={<ChartBarHorizontalIcon weight="light" />}
								/>
							),
							onSome: current => (
								<Suspense
									fallback={Boolean.match(props.detailOnly === true, {
										onFalse: () => <SpansSkeleton label="Spans" />,
										onTrue: () => <DetailSkeleton label="Span details" />
									})}
								>
									<Spans
										key={current.id}
										detailOnly={props.detailOnly}
										id={current.id}
										inlineDetails={props.inlineDetails}
										onPick={props.onPickSpan}
										pickedSpan={props.pickedSpan}
										range={props.range}
									/>
								</Suspense>
							)
						})
					}
				</OverviewContent>
			</Suspense>
		</section>
	)
}

// From 1024px to 1599px: operations and traces beside the waterfall, with the picked details after the spans.
function NarrowWorkspace(props: WorkspaceProps) {
	return (
		<div className="grid-cols-scope grid min-h-0 flex-1">
			<div className="grid min-h-0 grid-rows-2 border-r">
				<OperationsPane
					activeKey={props.activeKey}
					className="border-b"
					onSelect={props.onSelectOperation}
					range={props.range}
					source={props.source}
				/>
				<TracesPane
					active={props.active}
					now={props.now}
					onSelect={props.onSelectTrace}
					range={props.range}
					selectedTrace={props.activeTrace}
				/>
			</div>
			<TracePane
				inlineDetails
				now={props.now}
				onPickSpan={props.onPickSpan}
				pickedSpan={props.pickedSpan}
				range={props.range}
				trace={props.activeTrace}
			/>
		</div>
	)
}

// From 1600px: operations, traces and the waterfall as three resizable columns; details follow the spans.
function WideWorkspace(props: WorkspaceProps) {
	return (
		<ResizablePanelGroup orientation="horizontal" className="min-h-0 flex-1">
			<ResizablePanel defaultSize={440} minSize={320} maxSize={560}>
				<OperationsPane
					activeKey={props.activeKey}
					onSelect={props.onSelectOperation}
					range={props.range}
					source={props.source}
				/>
			</ResizablePanel>
			<ResizableHandle />
			<ResizablePanel defaultSize={320} minSize={240} maxSize={480}>
				<TracesPane
					active={props.active}
					now={props.now}
					onSelect={props.onSelectTrace}
					range={props.range}
					selectedTrace={props.activeTrace}
				/>
			</ResizablePanel>
			<ResizableHandle />
			<ResizablePanel minSize={320}>
				<TracePane
					inlineDetails
					now={props.now}
					onPickSpan={props.onPickSpan}
					pickedSpan={props.pickedSpan}
					range={props.range}
					trace={props.activeTrace}
				/>
			</ResizablePanel>
		</ResizablePanelGroup>
	)
}

function MobileWorkspace(props: WorkspaceProps & {pane: ReturnType<typeof navigationOf>['path']}) {
	return (
		<div className="flex min-h-0 flex-1 flex-col">
			{pipe(
				Match.value(props.pane),
				Match.when('Operations', () => (
					<OperationsPane
						activeKey={props.activeKey}
						className="min-h-0 flex-1"
						onSelect={props.onSelectOperation}
						range={props.range}
						source={props.source}
					/>
				)),
				Match.when('Traces', () => (
					<TracesPane
						active={props.active}
						className="min-h-0 flex-1"
						now={props.now}
						onSelect={props.onSelectTrace}
						range={props.range}
						selectedTrace={props.activeTrace}
					/>
				)),
				Match.orElse(() => (
					<TracePane
						className="min-h-0 flex-1"
						detailOnly={props.pane === 'Span'}
						now={props.now}
						onPickSpan={props.onPickSpan}
						pickedSpan={props.pickedSpan}
						range={props.range}
						trace={props.activeTrace}
					/>
				))
			)}
		</div>
	)
}

function renderPage(children: ReactNode) {
	return (
		<main className="pb-safe-bottom relative flex min-h-0 flex-1 flex-col overflow-hidden">
			<h1 className="sr-only">Scope</h1>
			{children}
		</main>
	)
}

function Home() {
	// Below desktop width, the same selection navigates one screen at a time; from 1600px all panes stand together.
	const isMobile = useMediaQuery('(width < 64rem)')
	const isWide = useMediaQuery('(width >= 100rem)')
	const search = route.useSearch()
	const navigation = navigationOf(search)
	const navigate = route.useNavigate()
	function send(event: NavigationEvent) {
		navigate({search: previous => nextSearch(previous, event)})
	}
	const pane = navigation.path
	const range = search.range ?? '1h'
	const overview = useAtomValue(overviewAtom(range))
	const refresh = useAtomRefresh(overviewAtom(range))
	const value = AsyncResult.value(overview)
	// The app tabs describe retained data, not the frame: the switch stores them so the bar never waits for the new frame.
	const [known, setKnown] = useState<Overview['apps']>(() => [])
	const apps = Option.match(value, {onNone: () => known, onSome: current => current.apps})
	const authFailure = Option.filter(AsyncResult.error(overview), isDenied)
	const blockingFailure = Option.filter(AsyncResult.cause(overview), () => Option.isNone(value))
	const now = AsyncResult.getOrElse(useAtomValue(nowAtom), () => DateTime.toEpochMillis(DateTime.nowUnsafe()))

	// One app is always chosen: a URL naming none, or one this data no longer has, falls back to the newest failure, else the first tab.
	const selection = selectionOf(value, search, isMobile)
	const source = selection.source
	useEffect(() => {
		if (source === undefined || search.source === source) return
		navigate({replace: true, search: previous => nextSearch(previous, {_tag: 'Source', app: source})})
	}, [navigate, search.source, source])

	// Once a frame's operations arrive, the URL drops a selection the page no longer shows; a frame that still shows it changes nothing.
	useEffect(() => {
		if (Option.isNone(value)) return
		const staleOperation =
			search.operation !== undefined &&
			!Option.exists(
				selection.activeOperation,
				active =>
					active.app.name === (search.source ?? '') &&
					active.operation.name === search.operation &&
					active.operation.runtime === search.side
			)
		const staleTrace =
			search.trace !== undefined && !Option.exists(selection.activeTrace, trace => trace.id === search.trace)
		if (!staleOperation && !staleTrace) return
		navigate({
			replace: true,
			search: previous =>
				Boolean.match(staleOperation, {
					onFalse: () => Struct.omit(previous, ['span', 'trace']),
					onTrue: () => Struct.omit(previous, ['operation', 'side', 'span', 'trace'])
				})
		})
	}, [
		navigate,
		search.operation,
		search.side,
		search.source,
		search.trace,
		selection.activeOperation,
		selection.activeTrace,
		value
	])

	function selectOperation(app: string, operation: Operation) {
		send({_tag: 'Operation', operation: {app, name: operation.name, runtime: operation.runtime}})
	}

	function selectTrace(trace: OperationTrace) {
		Option.map(selection.activeKey, operation => send({_tag: 'Trace', selection: {operation, traceId: trace.id}}))
	}

	function selectSpan(id: string) {
		Option.map(Option.all({operation: selection.activeKey, trace: selection.activeTrace}), selected =>
			send({_tag: 'Span', selection: {operation: selected.operation, spanId: id, traceId: selected.trace.id}})
		)
	}

	// A new frame keeps the trace it still holds; the URL follows a fallback once the frame's operations arrive.
	function selectRange(next: Range) {
		Option.match(value, {onNone: () => undefined, onSome: current => setKnown(current.apps)})
		const cutoff = rangeStart(next, now)
		send({
			_tag: 'Range',
			keepTrace: Option.exists(selection.activeTrace, trace => BigInt(trace.time) >= cutoff),
			range: next
		})
	}

	const workspaceProps = {
		active: Option.getOrUndefined(selection.activeOperation),
		activeKey: Option.getOrUndefined(selection.activeKey),
		activeTrace: Option.getOrUndefined(selection.activeTrace),
		now,
		onPickSpan: selectSpan,
		onSelectOperation: selectOperation,
		onSelectTrace: selectTrace,
		pickedSpan: selection.pickedSpan,
		range,
		source: selection.source
	}
	const workspace = Boolean.match(isMobile, {
		onFalse: () =>
			Boolean.match(isWide, {
				onFalse: () => <NarrowWorkspace {...workspaceProps} />,
				onTrue: () => <WideWorkspace {...workspaceProps} />
			}),
		onTrue: () => <MobileWorkspace {...workspaceProps} pane={pane} />
	})
	// A phone pushes one pane at a time: the bar names it and its caret goes back up the tree.
	return (
		<div className="flex min-h-0 flex-1 flex-col">
			<AppBar
				heading={Boolean.match(isMobile && pane !== 'Operations', {
					onFalse: () => undefined,
					onTrue: () => ({
						back: {
							label: pipe(
								Match.value(pane),
								Match.when('Span', () => 'Trace'),
								Match.when('Trace', () => 'Traces'),
								Match.orElse(() => 'Operations')
							),
							onClick: () => send({_tag: 'Back'})
						},
						title: pipe(
							Match.value(pane),
							Match.when('Traces', () =>
								Option.match(selection.activeOperation, {
									onNone: () => 'Traces',
									onSome: active => active.operation.name
								})
							),
							Match.when('Span', () => 'Span'),
							Match.orElse(() => 'Trace')
						)
					})
				})}
				icon={icon}
				name="scope"
				controls={
					<>
						<StaleMark range={range} trace={Option.getOrUndefined(selection.activeTrace)} />
						{Boolean.match(isMobile && pane !== 'Operations', {
							onFalse: () => <RangeTabs range={range} onChange={selectRange} />,
							onTrue: () => null
						})}
					</>
				}
				tabs={Boolean.match(isMobile && pane !== 'Operations', {
					onFalse: () => <SourceTabs apps={apps} source={selection.source ?? search.source} />,
					onTrue: () => undefined
				})}
			/>
			{Option.match(authFailure, {
				onNone: () =>
					Option.match(blockingFailure, {
						onNone: () => renderPage(workspace),
						onSome: cause => renderPage(<WebRuntime.Failure error={Cause.squash(cause)} reset={refresh} />)
					}),
				onSome: error => renderPage(<WebRuntime.Failure error={error} reset={refresh} />)
			})}
		</div>
	)
}

export const Route = createFileRoute('/(home)/')({component: Home, validateSearch: WebRuntime.searchOf(Search)})
