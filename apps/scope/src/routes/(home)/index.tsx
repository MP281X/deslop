import {useAtomRefresh, useAtomSuspense, useAtomValue} from '@effect/atom-react'

import {Array, Boolean, Cause, DateTime, Function, Match, Option, Predicate, Record, Schema, String, pipe} from 'effect'

import {
	ChartBarHorizontalIcon,
	DeviceMobileIcon,
	FlowArrowIcon,
	GlobeIcon,
	HardDrivesIcon,
	ListBulletsIcon,
	RectangleIcon
} from '@phosphor-icons/react'
import {Link, createFileRoute, getRouteApi} from '@tanstack/react-router'
import {AsyncResult} from 'effect/reactivity'
import {Suspense, useState} from 'react'
import type {ReactElement, ReactNode} from 'react'

import {AppMark} from '@deslop/components-web/blocks/marks'
import {StaleProblem} from '@deslop/components-web/blocks/problem'
import {ChoiceRow, LoadingRows, RowLead} from '@deslop/components-web/blocks/rows'
import {Loaded, ReadFailure} from '@deslop/components-web/blocks/states'
import {StatusDot} from '@deslop/components-web/blocks/status-dot'
import {appMarks} from '@deslop/components-web/lib/apps'
import {mediaQueryAtom} from '@deslop/components-web/lib/media'
import {preload} from '@deslop/components-web/lib/router'
import {cn} from '@deslop/components-web/lib/utils'
import {AppBarTab, AppBar, AppBarChoice, AppBarTabs, AppBarTabsSkeleton} from '@deslop/components-web/shell/app-bar'
import {Workspace} from '@deslop/components-web/shell/workspace'
import {Empty, EmptyHeader, EmptyMedia, EmptyTitle} from '@deslop/components-web/ui/empty'
import {ResizableHandle, ResizablePanel, ResizablePanelGroup} from '@deslop/components-web/ui/resizable'
import {ScrollArea} from '@deslop/components-web/ui/scroll-area'
import {Separator} from '@deslop/components-web/ui/separator'
import {Table, TableBody, TableCell} from '@deslop/components-web/ui/table'
import {blockingFailure} from '@deslop/runtime/client/live-stream'
import {ageOf, clockOf, compactCountOf, countOf, durationOf} from '@deslop/runtime/shared/format'
import {TimeFrame} from '@deslop/runtime/shared/time'

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
import {rangeStart} from '#services/telemetry/schema.ts'
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

// The side an operation starts on: its row's muted glyph, and its name for the labels of two rows that share a name.
const SIDES: Record<Runtime, string> = {ci: 'CI', mobile: 'iOS', server: 'server', unknown: '', web: 'web'}

const KINDS: Record<Runtime, ReactNode> = {
	ci: <FlowArrowIcon aria-hidden className="text-muted-foreground size-4" />,
	mobile: <DeviceMobileIcon aria-hidden className="text-muted-foreground size-4" />,
	server: <HardDrivesIcon aria-hidden className="text-muted-foreground size-4" />,
	unknown: undefined,
	web: <GlobeIcon aria-hidden className="text-muted-foreground size-4" />
}

// One run or many, in the reader's words.
function runsOf(n: number) {
	return `${countOf(n)} ${Boolean.match(n === 1, {onFalse: Function.constant('runs'), onTrue: Function.constant('run')})}`
}
const route = getRouteApi('/(home)/')
const RANGES = Array.map(TimeFrame.literals, value => ({label: value, value}))

type WorkspaceProps = {
	active: Option.Option<ActiveOperation>
	activeKey: Option.Option<OperationKey>
	activeTrace: Option.Option<Pick<OperationTrace, 'id'>>
	now: DateTime.Utc
	onPickSpan: (id: SpanId) => void
	onSelectOperation: (app: AppName, operation: Operation) => void
	onSelectTrace: (trace: OperationTrace) => void
	pickedSpan: Option.Option<SpanId>
	range: TimeFrame
	source: Option.Option<AppName>
}

// One tab per app, using its app mark, else the CI/server glyph beside the last part of the name it was sent under; the supplied source selects it, and clicking that tab again prevents navigation.
function SourceTabs(props: {apps: Overview['apps']; source: Option.Option<AppName>}) {
	const search = route.useSearch()
	return (
		<AppBarTabs value={Option.getOrElse(props.source, Function.constant(''))}>
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
								if (Option.contains(props.source, app.name)) event.preventDefault()
							}}
						/>
					}
				>
					<span className="flex size-4">
						<AppMark name={app.name} fallback={<OutsideMark ci={Option.contains(app.ci, true)} />} />
					</span>
					{pipe(
						appMarks,
						Record.has(app.name),
						Boolean.match({
							onFalse: () => <span className="text-xs">{pipe(app.name, String.split('/'), Array.lastNonEmpty)}</span>,
							onTrue: Function.constNull
						})
					)}
				</AppBarTab>
			))}
		</AppBarTabs>
	)
}

// Suspend the rows, not their shell. Home owns failures; ordinary outages retain the last overview.
function OverviewContent(props: {children: (overview: Overview) => ReactNode; range: TimeFrame}) {
	return Option.match(AsyncResult.value(useAtomSuspense(overviewAtom(props.range), {includeFailure: true})), {
		onNone: Function.constNull,
		onSome: props.children
	})
}

// A pane with nothing to show yet, or nothing at all, under the icon of the thing it holds.
function EmptyPane(props: {icon: ReactElement; label: string}) {
	return (
		<Empty role="status">
			<EmptyHeader>
				<EmptyMedia variant="icon">{props.icon}</EmptyMedia>
				<EmptyTitle>{props.label}</EmptyTitle>
			</EmptyHeader>
		</Empty>
	)
}

// One operation: its side's glyph, its name and a dot when it failed, then its errors when it has any, runs and typical duration in their own columns; its label names the side when two rows share the name.
function OperationRow(props: {active: boolean; duplicate: boolean; onSelect: () => void; operation: Operation}) {
	const side = SIDES[props.operation.runtime]
	return (
		<ChoiceRow
			selected={props.active}
			label={Array.join(
				[
					props.operation.name,
					...Boolean.match(props.duplicate && side !== '', {onFalse: () => [], onTrue: () => [side]}),
					...Boolean.match(props.operation.failures > 0, {
						onFalse: () => [],
						onTrue: () => [`${countOf(props.operation.failures)} failed`]
					}),
					runsOf(props.operation.count),
					`${durationOf(props.operation.p50Ms)} typical`
				],
				', '
			)}
			onSelect={props.onSelect}
		>
			<RowLead
				title={props.operation.name}
				mark={KINDS[props.operation.runtime]}
				after={
					props.operation.failures > 0 && (
						<StatusDot status="error" label={`${countOf(props.operation.failures)} failed`} />
					)
				}
			>
				{props.operation.name}
			</RowLead>
			<TableCell className="text-right">
				{props.operation.failures > 0 && (
					<span
						className="text-destructive in-data-[state=selected]:text-foreground tabular-nums"
						title={`${countOf(props.operation.failures)} failed`}
					>
						{countOf(props.operation.failures)}
					</span>
				)}
			</TableCell>
			<TableCell className="text-right">
				<span
					className="text-muted-foreground in-data-[state=selected]:text-foreground tabular-nums"
					title={runsOf(props.operation.count)}
				>
					{compactCountOf(props.operation.count)}
				</span>
			</TableCell>
			<TableCell className="text-right">
				<span className="tabular-nums" title="Typical duration">
					{durationOf(props.operation.p50Ms)}
				</span>
			</TableCell>
		</ChoiceRow>
	)
}

// One operations list, narrowed to the bar's chosen app; no groups or headings.
function OperationsPane(props: {
	activeKey: Option.Option<OperationKey>
	className?: string
	onSelect: (app: AppName, operation: Operation) => void
	range: TimeFrame
	source: Option.Option<AppName>
}) {
	return (
		<section aria-label="Operations" className={cn('flex h-full min-h-0 flex-col overflow-hidden', props.className)}>
			<Suspense fallback={<LoadingRows label="Operations" rows={8} />}>
				<OverviewContent range={props.range}>
					{overview =>
						Array.match(operationsOf(overview, props.source), {
							onEmpty: () => <EmptyPane icon={<ListBulletsIcon />} label="No operations" />,
							onNonEmpty: rows => {
								const names = Array.groupBy(rows, row => row.operation.name)
								return (
									<ScrollArea className="min-h-0 flex-1">
										<Table aria-label="Operations">
											<TableBody>
												{Array.map(rows, row => (
													<OperationRow
														key={`${row.app.name} ${row.operation.runtime} ${row.operation.name}`}
														active={Option.exists(
															props.activeKey,
															key =>
																key.app === row.app.name &&
																key.runtime === row.operation.runtime &&
																key.name === row.operation.name
														)}
														duplicate={pipe(
															names,
															Record.get(row.operation.name),
															Option.exists(group => group.length > 1)
														)}
														onSelect={() => props.onSelect(row.app.name, row.operation)}
														operation={row.operation}
													/>
												))}
											</TableBody>
										</Table>
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

// One trace of the operation: its short id with its failure dot right after, its age and its duration; the row selects it.
function TraceListRow(props: {active: boolean; now: DateTime.Utc; onSelect: () => void; trace: OperationTrace}) {
	return (
		<ChoiceRow
			selected={props.active}
			label={Array.join(
				[
					ageOf(props.trace.start, props.now),
					`trace ${traceLabel(props.trace)}`,
					...Option.match(props.trace.failure, {onNone: () => [], onSome: failure => [`failed in ${failure.span}`]}),
					durationOf(props.trace.duration)
				],
				', '
			)}
			onSelect={props.onSelect}
		>
			<RowLead
				title={props.trace.id}
				after={Option.match(props.trace.failure, {
					onNone: Function.constNull,
					onSome: failure => <StatusDot status="error" label={`Failed in ${failure.span}`} />
				})}
			>
				{traceLabel(props.trace)}
			</RowLead>
			<TableCell className="text-right">
				<span
					className="text-muted-foreground in-data-[state=selected]:text-foreground tabular-nums"
					title={clockOf(props.trace.start, 'second')}
				>
					{ageOf(props.trace.start, props.now)}
				</span>
			</TableCell>
			<TableCell className="text-right">
				<span className="tabular-nums">{durationOf(props.trace.duration)}</span>
			</TableCell>
		</ChoiceRow>
	)
}

// The chosen operation's traces; nothing selects until one is chosen.
function TracesPane(props: {
	active: Option.Option<ActiveOperation>
	className?: string
	now: DateTime.Utc
	onSelect: (trace: OperationTrace) => void
	range: TimeFrame
	selectedTrace: Option.Option<Pick<OperationTrace, 'id'>>
}) {
	const active = props.active
	return (
		<section aria-label="Traces" className={cn('flex h-full min-h-0 flex-col overflow-hidden', props.className)}>
			<Suspense fallback={<LoadingRows label="Traces" rows={8} />}>
				<OverviewContent range={props.range}>
					{() =>
						Option.match(active, {
							onNone: () => <EmptyPane icon={<ListBulletsIcon />} label="Select an operation" />,
							onSome: current =>
								Boolean.match(Array.isReadonlyArrayNonEmpty(current.operation.traces), {
									onFalse: () => <EmptyPane icon={<ChartBarHorizontalIcon />} label="No traces" />,
									onTrue: () => (
										<ScrollArea className="min-h-0 flex-1">
											<Table aria-label="Traces">
												<TableBody>
													{Array.map(current.operation.traces, trace => (
														<TraceListRow
															key={trace.id}
															active={Option.exists(props.selectedTrace, selected => selected.id === trace.id)}
															now={props.now}
															onSelect={() => props.onSelect(trace)}
															trace={trace}
														/>
													))}
												</TableBody>
											</Table>
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
		onNone: () => <EmptyPane icon={<RectangleIcon />} label="Select a span" />,
		onSome: span => (
			<ScrollArea className="min-h-0 flex-1">
				<SpanDetail span={span} wrap />
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
		return <EmptyPane icon={<RectangleIcon />} label="No spans" />
	}
	return (
		<ScrollArea className="min-h-0 flex-1">
			<TimeAxis totalMs={props.trace.durationMs} />
			<Flame focus={Option.map(props.focus, span => span.spanId)} onPick={props.onPick} trace={props.trace} />
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
function StaleMark(props: {range: TimeFrame; trace: Option.Option<Pick<OperationTrace, 'id'>>}) {
	return Option.match(props.trace, {
		onNone: () => <StaleProblem label="Out of date" readers={[overviewAtom(props.range)]} />,
		onSome: trace => <StaleProblem label="Out of date" readers={[overviewAtom(props.range), traceAtom(trace.id)]} />
	})
}

function Spans(props: {
	detailOnly?: boolean
	id: TraceId
	inlineDetails?: boolean
	onPick: (id: SpanId) => void
	pickedSpan: Option.Option<SpanId>
}) {
	return (
		<Loaded atom={traceAtom(props.id)}>
			{trace => {
				const focus = focusOf(trace, props.pickedSpan)
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
	onPickSpan: (id: SpanId) => void
	pickedSpan: Option.Option<SpanId>
	range: TimeFrame
	trace: Option.Option<Pick<OperationTrace, 'id'>>
}) {
	const trace = props.trace
	return (
		<section aria-label="Trace" className={cn('flex h-full min-h-0 flex-col overflow-hidden', props.className)}>
			<Suspense
				fallback={Boolean.match(props.detailOnly === true, {
					onFalse: () => <SpansSkeleton label="Spans" />,
					onTrue: () => <LoadingRows label="Span details" rows={6} />
				})}
			>
				<OverviewContent range={props.range}>
					{() =>
						Option.match(trace, {
							onNone: () =>
								Boolean.match(props.detailOnly === true, {
									onFalse: () => <EmptyPane icon={<ChartBarHorizontalIcon />} label="Select a trace" />,
									onTrue: () => <EmptyPane icon={<RectangleIcon />} label="Select a span" />
								}),
							onSome: current => (
								<Suspense
									fallback={Boolean.match(props.detailOnly === true, {
										onFalse: () => <SpansSkeleton label="Spans" />,
										onTrue: () => <LoadingRows label="Span details" rows={6} />
									})}
								>
									<Spans
										key={current.id}
										detailOnly={props.detailOnly === true}
										id={current.id}
										inlineDetails={props.inlineDetails === true}
										onPick={props.onPickSpan}
										pickedSpan={props.pickedSpan}
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
		<Workspace>
			<h1 className="sr-only">Scope</h1>
			{children}
		</Workspace>
	)
}

function HomeRoute() {
	// Below desktop width, the same selection navigates one screen at a time; from 1600px all panes stand together.
	const isMobile = useAtomValue(mediaQueryAtom('(width < 64rem)'))
	const isWide = useAtomValue(mediaQueryAtom('(width >= 100rem)'))
	const search = route.useSearch()
	const navigate = route.useNavigate()
	const range = Option.getOrElse(search.range, Function.constant('24h' as const))
	const overview = useAtomValue(overviewAtom(range))
	const refresh = useAtomRefresh(overviewAtom(range))
	const value = AsyncResult.value(overview)
	// The app tabs describe retained data, not the frame: the switch stores them so the bar never waits for the new frame.
	const [known, setKnown] = useState<Overview['apps']>(() => [])
	const apps = Option.match(value, {onNone: () => known, onSome: current => current.apps})
	const failure = blockingFailure(overview)
	const now = useAtomValue(nowAtom)

	// One app is always chosen: a URL naming none, or one this data no longer has, falls back to the newest failure, else the first tab. That opening choice holds while the page stays open, so a later failure elsewhere never switches apps under the reader.
	const [opened, setOpened] = useState(Option.none<AppName>)
	const selection = selectionOf(value, {...search, source: Option.orElse(search.source, () => opened)}, isMobile)
	if (Option.isNone(search.source) && Option.isNone(opened) && Option.isSome(selection.source)) {
		setOpened(selection.source)
	}
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

	// A new frame applies its cutoff to listed traces; directly opened ids stay readable outside the capped list.
	function selectRange(next: TimeFrame) {
		Option.match(value, {onNone: Function.constUndefined, onSome: current => setKnown(current.apps)})
		const cutoff = rangeStart(next, now)
		send(
			NavigationEvent.cases.Range.make({
				keepTrace: Option.exists(
					selection.activeTrace,
					trace => !Predicate.hasProperty(trace, 'start') || DateTime.isGreaterThanOrEqualTo(trace.start, cutoff)
				),
				range: next
			})
		)
	}

	const workspaceProps = {
		active: selection.activeOperation,
		activeKey: selection.activeKey,
		activeTrace: selection.activeTrace,
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
				{...Boolean.match(isMobile && pane !== 'Operations', {
					onFalse: () => ({}),
					onTrue: () => ({
						heading: {
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
						}
					})
				})}
				icon={icon}
				name="scope"
				controls={
					<>
						<StaleMark range={range} trace={selection.activeTrace} />
						{Boolean.match(isMobile && pane !== 'Operations', {
							onFalse: () => <AppBarChoice label="Range" value={range} options={RANGES} onChange={selectRange} />,
							onTrue: Function.constNull
						})}
					</>
				}
				tabs={Boolean.match(isMobile && pane !== 'Operations', {
					onFalse: () =>
						Boolean.match(AsyncResult.isInitial(overview) && Array.isReadonlyArrayEmpty(apps), {
							onFalse: () => <SourceTabs apps={apps} source={Option.orElse(selection.source, () => search.source)} />,
							onTrue: () => <AppBarTabsSkeleton count={4} />
						}),
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
	// Ahead of the loader: TypeScript types `load.deps` from the keys before it.
	loaderDeps: location => ({
		range: Option.getOrElse(location.search.range, Function.constant('24h' as const)),
		trace: Option.getOrUndefined(location.search.trace)
	}),

	component: HomeRoute,
	loader: load =>
		preload(load, [
			overviewAtom(load.deps.range),
			...Array.map(Option.toArray(Option.fromUndefinedOr(load.deps.trace)), traceAtom)
		]),
	validateSearch: Schema.toStandardSchemaV1(Search)
})
