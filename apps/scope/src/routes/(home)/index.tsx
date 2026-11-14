import {useAtomRefresh, useAtomSuspense, useAtomValue} from '@effect/atom-react'

import {Array, Boolean, Cause, DateTime, Function, Match, Option, Record, Schema, pipe} from 'effect'

import {ChartBarHorizontalIcon, DeviceMobileIcon, FlowArrowIcon, GlobeIcon, HardDrivesIcon} from '@phosphor-icons/react'
import {Link, createFileRoute, getRouteApi} from '@tanstack/react-router'
import {AsyncResult} from 'effect/reactivity'
import {Suspense, useState} from 'react'
import type {ReactElement, ReactNode} from 'react'

import {AppBarTab, AppBar, AppBarChoice, AppBarTabs} from '@deslop/components-web/app-bar'
import {cn, mediaQueryAtom} from '@deslop/components-web/classes'
import {EmptyState, Loaded, ReadFailure} from '@deslop/components-web/fallbacks'
import {RowsSkeleton} from '@deslop/components-web/item-list'
import {AppMark} from '@deslop/components-web/marks'
import {StaleProblem} from '@deslop/components-web/problem'
import {StatusDot} from '@deslop/components-web/status-dot'
import {Item, ItemActions, ItemContent, ItemDescription, ItemGroup, ItemTitle} from '@deslop/components-web/ui/item'
import {ResizableHandle, ResizablePanel, ResizablePanelGroup} from '@deslop/components-web/ui/resizable'
import {ScrollArea} from '@deslop/components-web/ui/scroll-area'
import {Separator} from '@deslop/components-web/ui/separator'
import {blockingFailure} from '@deslop/runtime/client/live-stream'
import {ageOf, clockOf, compactCountOf, countOf, durationOf} from '@deslop/runtime/shared/format'

import {
	Search,
	NavigationEvent,
	focusOf,
	navigationOf,
	nextSearch,
	nowAtom,
	operationsOf,
	overviewAtom,
	selectionOf,
	shownSearch,
	traceAtom,
	traceLabel
} from '#lib/telemetry.ts'
import type {ActiveOperation, OperationKey} from '#lib/telemetry.ts'
import {Flame, SpansSkeleton, TimeAxis} from '#routes/(home)/-flame.tsx'
import {OutsideMark, SpanDetail} from '#routes/(home)/-span.tsx'
import icon from '#routes/icon.svg'
import {Range, rangeStart} from '#services/telemetry/schema.ts'
import type {
	AppName,
	Operation,
	OperationTrace,
	Overview,
	Runtime,
	SpanId,
	TraceId,
	TraceTree
} from '#services/telemetry/schema.ts'

// The side an operation starts on: a 12px muted glyph after the name when two visible rows share it, and its name for their labels.
const SIDES: Record<Runtime, string> = {ci: 'CI', mobile: 'iOS', server: 'server', unknown: '', web: 'web'}

const KINDS: Record<Runtime, ReactElement> = {
	ci: <FlowArrowIcon aria-hidden className="text-muted-foreground size-3 shrink-0" />,
	mobile: <DeviceMobileIcon aria-hidden className="text-muted-foreground size-3 shrink-0" />,
	server: <HardDrivesIcon aria-hidden className="text-muted-foreground size-3 shrink-0" />,
	unknown: <HardDrivesIcon aria-hidden className="text-muted-foreground size-3 shrink-0" />,
	web: <GlobeIcon aria-hidden className="text-muted-foreground size-3 shrink-0" />
}

// One run or many, in the reader's words.
function runsOf(n: number) {
	return `${countOf(n)} ${Boolean.match(n === 1, {onFalse: Function.constant('runs'), onTrue: Function.constant('run')})}`
}
const route = getRouteApi('/(home)/')
const RANGES = Array.map(Range.literals, value => ({label: value, value}))

type WorkspaceProps = {
	active?: ActiveOperation
	activeKey?: OperationKey
	activeTrace?: OperationTrace
	now: DateTime.Utc
	onPickSpan: (id: SpanId) => void
	onSelectOperation: (app: AppName, operation: Operation) => void
	onSelectTrace: (trace: OperationTrace) => void
	pickedSpan?: SpanId
	range: Range
	source?: AppName
}

// The bar's app choice: one mark per app, its own icon, GitHub's for CI, else a server glyph, never a letter tile; one is always chosen, and choosing the chosen tab again does nothing.
function SourceTabs(props: {apps: Overview['apps']; source?: AppName}) {
	const search = route.useSearch()
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
							search={Schema.encodeSync(Search)(nextSearch(search, NavigationEvent.cases.Source.make({app: app.name})))}
							onClick={event => {
								if (app.name === props.source) event.preventDefault()
							}}
						/>
					}
				>
					<AppMark name={app.name} fallback={<OutsideMark ci={Option.contains(app.ci, true)} />} />
				</AppBarTab>
			))}
		</AppBarTabs>
	)
}

// Suspend the rows, not their shell. Home owns failures; ordinary outages retain the last overview.
function OverviewContent(props: {children: (overview: Overview) => ReactNode; range: Range}) {
	return Option.match(AsyncResult.value(useAtomSuspense(overviewAtom(props.range), {includeFailure: true})), {
		onNone: Function.constNull,
		onSome: props.children
	})
}

// A row of a list that selects one: the whole row is the button, and the chosen one is muted.
function ChoiceRow(props: {active: boolean; children: ReactNode; label: readonly string[]; onSelect: () => void}) {
	return (
		<div role="listitem">
			<Item
				size="sm"
				variant={Boolean.match(props.active, {
					onFalse: Function.constant('default' as const),
					onTrue: Function.constant('muted' as const)
				})}
				render={
					<button
						type="button"
						aria-label={Array.join(props.label, ', ')}
						aria-current={Boolean.match(props.active, {
							onFalse: Function.constUndefined,
							onTrue: Function.constant('true' as const)
						})}
						onClick={props.onSelect}
					/>
				}
			>
				{props.children}
			</Item>
		</div>
	)
}

// One operation: its name and side when two rows share it, then its errors when it has any, runs and typical duration.
function OperationRow(props: {active: boolean; duplicate: boolean; onSelect: () => void; operation: Operation}) {
	const side = SIDES[props.operation.runtime]
	return (
		<ChoiceRow
			active={props.active}
			label={[
				props.operation.name,
				...Boolean.match(props.duplicate && side !== '', {onFalse: () => [], onTrue: () => [side]}),
				...Boolean.match(props.operation.failures > 0, {
					onFalse: () => [],
					onTrue: () => [`${countOf(props.operation.failures)} failed`]
				}),
				runsOf(props.operation.count),
				`${durationOf(props.operation.p50Ms)} typical`
			]}
			onSelect={props.onSelect}
		>
			<ItemContent>
				<ItemTitle title={props.operation.name}>
					{props.operation.name}
					{props.duplicate && KINDS[props.operation.runtime]}
				</ItemTitle>
			</ItemContent>
			<ItemActions>
				{props.operation.failures > 0 && (
					<span className="text-destructive tabular-nums" title={`${countOf(props.operation.failures)} failed`}>
						{countOf(props.operation.failures)}
					</span>
				)}
				<span className="text-muted-foreground tabular-nums" title={runsOf(props.operation.count)}>
					{compactCountOf(props.operation.count)}
				</span>
				<span className="tabular-nums" title="Typical duration">
					{durationOf(props.operation.p50Ms)}
				</span>
			</ItemActions>
		</ChoiceRow>
	)
}

// One operations list, narrowed to the bar's chosen app; no groups or headings.
function OperationsPane(props: {
	activeKey?: OperationKey
	className?: string
	onSelect: (app: AppName, operation: Operation) => void
	range: Range
	source?: AppName
}) {
	return (
		<section aria-label="Operations" className={cn('flex h-full min-h-0 flex-col overflow-hidden', props.className)}>
			<Suspense fallback={<RowsSkeleton label="Operations" rows={8} />}>
				<OverviewContent range={props.range}>
					{overview =>
						Array.match(operationsOf(overview, Option.fromUndefinedOr(props.source)), {
							onEmpty: () => (
								<EmptyState label="No traces in this range" icon={<ChartBarHorizontalIcon weight="light" />} />
							),
							onNonEmpty: rows => {
								const names = Array.groupBy(rows, row => row.operation.name)
								return (
									<ScrollArea className="min-h-0 flex-1">
										<ItemGroup>
											{Array.map(rows, row => (
												<OperationRow
													key={`${row.app.name} ${row.operation.runtime} ${row.operation.name}`}
													active={
														props.activeKey !== undefined &&
														props.activeKey.app === row.app.name &&
														props.activeKey.runtime === row.operation.runtime &&
														props.activeKey.name === row.operation.name
													}
													duplicate={pipe(
														names,
														Record.get(row.operation.name),
														Option.exists(group => group.length > 1)
													)}
													onSelect={() => props.onSelect(row.app.name, row.operation)}
													operation={row.operation}
												/>
											))}
										</ItemGroup>
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
function TraceListRow(props: {active: boolean; now: DateTime.Utc; onSelect: () => void; trace: OperationTrace}) {
	return (
		<ChoiceRow
			active={props.active}
			label={[
				ageOf(props.trace.start, props.now),
				`trace ${traceLabel(props.trace)}`,
				...Option.match(props.trace.failure, {onNone: () => [], onSome: failure => [`failed in ${failure.span}`]}),
				durationOf(props.trace.duration)
			]}
			onSelect={props.onSelect}
		>
			<ItemContent>
				<ItemTitle title={props.trace.id}>
					{traceLabel(props.trace)}
					{Option.match(props.trace.failure, {
						onNone: Function.constNull,
						onSome: failure => <StatusDot status="error" label={`Failed in ${failure.span}`} />
					})}
				</ItemTitle>
				<ItemDescription title={clockOf(props.trace.start, 'second')}>
					{ageOf(props.trace.start, props.now)}
				</ItemDescription>
			</ItemContent>
			<ItemActions>
				<span className="tabular-nums">{durationOf(props.trace.duration)}</span>
			</ItemActions>
		</ChoiceRow>
	)
}

// The chosen operation's traces; nothing selects until one is chosen.
function TracesPane(props: {
	active?: ActiveOperation
	className?: string
	now: DateTime.Utc
	onSelect: (trace: OperationTrace) => void
	range: Range
	selectedTrace?: OperationTrace
}) {
	const active = Option.fromUndefinedOr(props.active)
	return (
		<section aria-label="Traces" className={cn('flex h-full min-h-0 flex-col overflow-hidden', props.className)}>
			<Suspense fallback={<RowsSkeleton label="Traces" rows={8} />}>
				<OverviewContent range={props.range}>
					{() =>
						Option.match(active, {
							onNone: () => <EmptyState label="Select an operation" icon={<ChartBarHorizontalIcon weight="light" />} />,
							onSome: current =>
								Boolean.match(Array.isReadonlyArrayNonEmpty(current.operation.traces), {
									onFalse: () => <EmptyState label="No traces" icon={<ChartBarHorizontalIcon weight="light" />} />,
									onTrue: () => (
										<ScrollArea className="min-h-0 flex-1">
											<ItemGroup>
												{Array.map(current.operation.traces, trace => (
													<TraceListRow
														key={trace.id}
														active={props.selectedTrace?.id === trace.id}
														now={props.now}
														onSelect={() => props.onSelect(trace)}
														trace={trace}
													/>
												))}
											</ItemGroup>
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
function SpanDetails(props: {focus: Option.Option<TraceTree['spans'][number]>}) {
	return Option.match(props.focus, {
		onNone: () => <EmptyState label="Select a span" icon={<ChartBarHorizontalIcon weight="light" />} />,
		onSome: span => (
			<ScrollArea className="min-h-0 flex-1">
				<SpanDetail span={span} />
			</ScrollArea>
		)
	})
}

// The trace's flame under its pinned time axis, then, when inline, the picked span's details after one hairline.
function SpansList(props: {
	focus: Option.Option<TraceTree['spans'][number]>
	inlineDetails: boolean
	onPick: (id: SpanId) => void
	trace: TraceTree
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
				onFalse: Function.constNull,
				onTrue: () => (
					<>
						<Separator />
						{Option.match(props.focus, {onNone: Function.constNull, onSome: span => <SpanDetail span={span} />})}
					</>
				)
			})}
		</ScrollArea>
	)
}

// The page's readers as one mark: the oldest age among those still showing content, and one retry for them all.
function StaleMark(props: {range: Range; trace?: OperationTrace}) {
	return Option.match(Option.fromUndefinedOr(props.trace), {
		onNone: () => <StaleProblem label="Out of date" readers={[overviewAtom(props.range)]} />,
		onSome: trace => <StaleProblem label="Out of date" readers={[overviewAtom(props.range), traceAtom(trace.id)]} />
	})
}

function Spans(props: {
	detailOnly?: boolean
	id: TraceId
	inlineDetails?: boolean
	onPick: (id: SpanId) => void
	pickedSpan?: SpanId
	range: Range
}) {
	return (
		<Loaded atom={traceAtom(props.id)}>
			{trace => {
				const focus = focusOf(trace, Option.fromUndefinedOr(props.pickedSpan))
				if (props.detailOnly === true) {
					return <SpanDetails focus={focus} />
				}
				return (
					<SpansList focus={focus} inlineDetails={props.inlineDetails === true} onPick={props.onPick} trace={trace} />
				)
			}}
		</Loaded>
	)
}

// The open trace's waterfall: a band naming its short id and age, then, when inline, the picked span's details.
function TracePane(props: {
	className?: string
	detailOnly?: boolean
	inlineDetails?: boolean
	now: DateTime.Utc
	onPickSpan: (id: SpanId) => void
	pickedSpan?: SpanId
	range: Range
	trace?: OperationTrace
}) {
	const trace = Option.fromUndefinedOr(props.trace)
	return (
		<section aria-label="Trace" className={cn('flex h-full min-h-0 flex-col overflow-hidden', props.className)}>
			<Suspense
				fallback={Boolean.match(props.detailOnly === true, {
					onFalse: () => <SpansSkeleton label="Spans" />,
					onTrue: () => <RowsSkeleton label="Span details" rows={6} />
				})}
			>
				<OverviewContent range={props.range}>
					{() =>
						Option.match(trace, {
							onNone: () => (
								<EmptyState
									label={Boolean.match(props.detailOnly === true, {
										onFalse: Function.constant('Select a trace'),
										onTrue: Function.constant('Select a span')
									})}
									icon={<ChartBarHorizontalIcon weight="light" />}
								/>
							),
							onSome: current => (
								<Suspense
									fallback={Boolean.match(props.detailOnly === true, {
										onFalse: () => <SpansSkeleton label="Spans" />,
										onTrue: () => <RowsSkeleton label="Span details" rows={6} />
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

function HomeRoute() {
	// Below desktop width, the same selection navigates one screen at a time; from 1600px all panes stand together.
	const isMobile = useAtomValue(mediaQueryAtom('(width < 64rem)'))
	const isWide = useAtomValue(mediaQueryAtom('(width >= 100rem)'))
	const search = route.useSearch()
	const navigate = route.useNavigate()
	const range = Option.getOrElse(search.range, Function.constant('1h' as const))
	const overview = useAtomValue(overviewAtom(range))
	const refresh = useAtomRefresh(overviewAtom(range))
	const value = AsyncResult.value(overview)
	// The app tabs describe retained data, not the frame: the switch stores them so the bar never waits for the new frame.
	const [known, setKnown] = useState<Overview['apps']>(() => [])
	const apps = Option.match(value, {onNone: () => known, onSome: current => current.apps})
	const failure = blockingFailure(overview)
	const now = AsyncResult.getOrElse(useAtomValue(nowAtom), DateTime.nowUnsafe)

	// One app is always chosen: a URL naming none, or one this data no longer has, falls back to the newest failure, else the first tab.
	const selection = selectionOf(value, search, isMobile)
	// The selection as the page shows it, which the next navigation writes: the chosen app, without an operation or trace this frame no longer holds.
	const shown = shownSearch(search, selection, Option.isSome(value))
	const pane = navigationOf(shown).path
	function send(event: NavigationEvent) {
		navigate({search: Schema.encodeSync(Search)(nextSearch(shown, event))})
	}

	function selectOperation(app: AppName, operation: Operation) {
		send(NavigationEvent.cases.Operation.make({operation: {app, name: operation.name, runtime: operation.runtime}}))
	}

	function selectTrace(trace: OperationTrace) {
		Option.map(selection.activeKey, operation =>
			send(NavigationEvent.cases.Trace.make({selection: {operation, traceId: trace.id}}))
		)
	}

	function selectSpan(id: SpanId) {
		Option.map(Option.all({operation: selection.activeKey, trace: selection.activeTrace}), selected =>
			send(
				NavigationEvent.cases.Span.make({
					selection: {operation: selected.operation, spanId: id, traceId: selected.trace.id}
				})
			)
		)
	}

	// A new frame keeps the trace it still holds; the URL follows a fallback once the frame's operations arrive.
	function selectRange(next: Range) {
		Option.match(value, {onNone: Function.constUndefined, onSome: current => setKnown(current.apps)})
		const cutoff = rangeStart(next, now)
		send(
			NavigationEvent.cases.Range.make({
				keepTrace: Option.exists(selection.activeTrace, trace => DateTime.isGreaterThanOrEqualTo(trace.start, cutoff)),
				range: next
			})
		)
	}

	const workspaceProps = {
		active: Option.getOrUndefined(selection.activeOperation),
		activeKey: Option.getOrUndefined(selection.activeKey),
		activeTrace: Option.getOrUndefined(selection.activeTrace),
		now,
		onPickSpan: selectSpan,
		onSelectOperation: selectOperation,
		onSelectTrace: selectTrace,
		pickedSpan: Option.getOrUndefined(selection.pickedSpan),
		range,
		source: Option.getOrUndefined(selection.source)
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
					onFalse: Function.constUndefined,
					onTrue: () => ({
						back: {
							label: pipe(
								Match.value(pane),
								Match.when('Span', Function.constant('Trace')),
								Match.when('Trace', Function.constant('Traces')),
								Match.orElse(Function.constant('Operations'))
							),
							onClick: () => send(NavigationEvent.cases.Back.make({}))
						},
						title: pipe(
							Match.value(pane),
							Match.when('Traces', () =>
								Option.match(selection.activeOperation, {
									onNone: Function.constant('Traces'),
									onSome: active => active.operation.name
								})
							),
							Match.when('Span', Function.constant('Span')),
							Match.orElse(Function.constant('Trace'))
						)
					})
				})}
				icon={icon}
				name="scope"
				controls={
					<>
						<StaleMark range={range} trace={Option.getOrUndefined(selection.activeTrace)} />
						{Boolean.match(isMobile && pane !== 'Operations', {
							onFalse: () => <AppBarChoice label="Range" value={range} options={RANGES} onChange={selectRange} />,
							onTrue: Function.constNull
						})}
					</>
				}
				tabs={Boolean.match(isMobile && pane !== 'Operations', {
					onFalse: () => (
						<SourceTabs
							apps={apps}
							source={Option.getOrUndefined(Option.orElse(selection.source, () => search.source))}
						/>
					),
					onTrue: Function.constUndefined
				})}
			/>
			{Option.match(failure, {
				onNone: () => renderPage(workspace),
				onSome: cause => renderPage(<ReadFailure error={Cause.squash(cause)} reset={refresh} />)
			})}
		</div>
	)
}

export const Route = createFileRoute('/(home)/')({
	component: HomeRoute,
	validateSearch: Schema.toStandardSchemaV1(Search)
})
