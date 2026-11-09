import {useAtomRefresh, useAtomSuspense, useAtomValue} from '@effect/atom-react'

import {Array, Boolean, Cause, DateTime, Match, Number, Option, Order, Predicate, Record, String, pipe} from 'effect'

import {ChartBarHorizontalIcon, DeviceMobileIcon, FlowArrowIcon, GlobeIcon, HardDrivesIcon} from '@phosphor-icons/react'
import {Link, createFileRoute, getRouteApi} from '@tanstack/react-router'
import {AsyncResult} from 'effect/reactivity'
import {Suspense, useEffect} from 'react'
import type {ReactElement, ReactNode} from 'react'

import {AppBar, AppBarTab, AppBarTabs} from '@deslop/components-web/app-bar'
import {Denied, EmptyState, Error, SignIn} from '@deslop/components-web/fallbacks'
import {ItemListHeading} from '@deslop/components-web/item-list'
import {Problem, problemSinceAtom} from '@deslop/components-web/problem'
import {StatusDot} from '@deslop/components-web/status-dot'
import {Item, ItemActions, ItemContent, ItemMedia, ItemTitle} from '@deslop/components-web/ui/item'
import {ResizableHandle, ResizablePanel, ResizablePanelGroup} from '@deslop/components-web/ui/resizable'
import {ScrollArea} from '@deslop/components-web/ui/scroll-area'
import {Skeleton} from '@deslop/components-web/ui/skeleton'
import {cn, useMediaQuery} from '@deslop/components-web/utils'
import {isDenied, needsSignIn, signInUrl} from '@deslop/runtime/auth/utils'
import * as WebRuntime from '@deslop/runtime/web'

import {
	ageOf,
	durationOf,
	focusOf,
	navigationOf,
	nextSearch,
	nowAtom,
	operationsOf,
	overviewAtom,
	Search,
	selectionOf,
	traceAtom
} from '#lib/utils.ts'
import type {ActiveOperation, NavigationEvent, OperationKey} from '#lib/utils.ts'
import {Icicle, SpansSkeleton, TimeAxis} from '#routes/(home)/-icicle.tsx'
import {CiMark, DetailSkeleton, marks, SpanDetail} from '#routes/(home)/-span.tsx'
import icon from '#routes/icon.svg'
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

type WorkspaceProps = {
	active?: ActiveOperation
	activeKey?: OperationKey
	activeTrace?: OperationTrace
	now: number
	onPickSpan: (id: string) => void
	onSelectOperation: (app: string, operation: Operation) => void
	onSelectTrace: (trace: OperationTrace) => void
	pickedSpan?: string
	source?: string
}

// A pane with nothing selected keeps its mark alone, never a sentence that repeats the pane's name.
function EmptyIcon() {
	return <img src={icon} alt="" className="pixelated size-8 opacity-50" />
}

// The operations rows' geometry while the overview loads: the name at the gutter, then the same figure columns.
function OperationsSkeleton(props: {label: string}) {
	return (
		<div aria-busy="true" aria-label={props.label} role="status">
			{Array.map(Array.range(1, 8), row => (
				<Item key={row} aria-hidden size="row">
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
				</Item>
			))}
		</div>
	)
}

// The trace rows' geometry while the overview loads: the age slot, the short id where names sit, and the duration column.
function TracesSkeleton(props: {label: string}) {
	return (
		<div aria-busy="true" aria-label={props.label} role="status">
			{Array.map(Array.range(1, 8), row => (
				<Item key={row} aria-hidden size="row">
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
				</Item>
			))}
		</div>
	)
}

function FailureContent(props: {error: unknown; reset: () => void}) {
	if (needsSignIn(props.error)) return <SignIn href={signInUrl(location.href)} />
	if (isDenied(props.error)) return <Denied />
	return <Error error={props.error} reset={props.reset} />
}

// An app's mark: its own icon, GitHub's for CI, else a server glyph; never a letter tile. A heading names the app, so the mark is decorative.
function AppMark(props: {app: Overview['apps'][number]}) {
	return Option.match(Option.fromUndefinedOr(marks[props.app.name]), {
		onNone: () =>
			Boolean.match(
				Array.every(props.app.operations, operation => operation.runtime === 'ci'),
				{
					onFalse: () => <HardDrivesIcon aria-hidden className="text-muted-foreground size-4 shrink-0" />,
					onTrue: () => <CiMark />
				}
			),
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

// Suspend the rows, not their shell. Home owns failures; ordinary outages retain the last overview.
function OverviewContent(props: {children: (overview: Overview) => ReactNode}) {
	return Option.match(AsyncResult.value(useAtomSuspense(overviewAtom, {includeFailure: true})), {
		onNone: () => null,
		onSome: props.children
	})
}

// One operation: its name and side when two rows share it, then errors, runs and typical duration.
function OperationRow(props: {active: boolean; duplicate: boolean; onSelect: () => void; operation: Operation}) {
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
					<ItemTitle title={props.operation.name}>
						{props.operation.name}
						{props.duplicate && KINDS[props.operation.runtime]}
					</ItemTitle>
				</ItemContent>
				<ItemActions>
					<span className="grid-cols-operation grid items-center gap-x-3">
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
	source?: string
}) {
	return (
		<section aria-label="Operations" className={cn('flex h-full min-h-0 flex-col overflow-hidden', props.className)}>
			<Suspense fallback={<OperationsSkeleton label="Operations" />}>
				<OverviewContent>
					{overview =>
						Array.match(operationsOf(overview, props.source), {
							onEmpty: () => <EmptyState label="No traces yet" icon={<EmptyIcon />} />,
							onNonEmpty: rows => {
								const names = Array.groupBy(rows, row => row.operation.name)
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
								`trace ${String.slice(0, 8)(props.trace.id)}`,
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
							{String.slice(0, 8)(props.trace.id)}
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
				<OverviewContent>
					{() =>
						Option.match(active, {
							onNone: () => <EmptyState label="Select an operation" icon={<EmptyIcon />} />,
							onSome: current =>
								Boolean.match(Array.isReadonlyArrayNonEmpty(current.operation.traces), {
									onFalse: () => <EmptyState label="No traces" icon={<EmptyIcon />} />,
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
		onNone: () => <EmptyState label="Select a span" icon={<EmptyIcon />} />,
		onSome: span => (
			<ScrollArea className="min-h-0 flex-1">
				<div className="flex flex-col">
					<SpanDetail span={span} />
				</div>
			</ScrollArea>
		)
	})
}

// The trace's icicle under its time axis, then, when inline, the picked span's details after one hairline.
function SpansList(props: {
	focus: Option.Option<Trace['spans'][number]>
	inlineDetails: boolean
	onPick: (id: string) => void
	trace: Trace
}) {
	if (!Array.isReadonlyArrayNonEmpty(props.trace.spans)) {
		return <EmptyState label="No spans" icon={<EmptyIcon />} />
	}
	const total = Number.max(props.trace.durationMs, 1)
	const shortest = Array.reduce(props.trace.spans, Infinity, (min, span) =>
		Number.min(min, Boolean.match(span.durationMs > 0, {onFalse: () => Infinity, onTrue: () => span.durationMs}))
	)
	return (
		<ScrollArea className="min-h-0 flex-1">
			<div className="overflow-x-auto">
				<div
					className="w-full min-w-(--ice-width)"
					style={{
						'--ice-width': `${Boolean.match(shortest === Infinity, {
							onFalse: () => total / shortest + 32,
							onTrue: () => 0
						})}px`
					}}
				>
					<TimeAxis totalMs={props.trace.durationMs} />
					<Icicle
						focus={Option.getOrUndefined(Option.map(props.focus, span => span.spanId))}
						onPick={props.onPick}
						trace={props.trace}
					/>
				</div>
			</div>
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

// A failed refresh keeps its last data; an authorization failure never does.
function retained(result: AsyncResult.AsyncResult<unknown, unknown>) {
	return (
		AsyncResult.isFailure(result) &&
		Option.isSome(AsyncResult.value(result)) &&
		!Option.exists(AsyncResult.error(result), error => isDenied(error) || needsSignIn(error))
	)
}

// The operations reader alone, before a trace is open.
function OverviewStale() {
	const result = useAtomValue(overviewAtom)
	const since = Option.getOrUndefined(useAtomValue(problemSinceAtom(overviewAtom)))
	const refresh = useAtomRefresh(overviewAtom)
	if (!retained(result)) return null
	return <Problem label="Out of date" warning reset={refresh} since={since} />
}

// The page's readers as one mark: the oldest age among those still showing retained data, and one retry for both.
function TraceStale(props: {trace: OperationTrace}) {
	const overview = useAtomValue(overviewAtom)
	const traceResult = useAtomValue(traceAtom(props.trace.id))
	const overviewSince = Option.getOrUndefined(useAtomValue(problemSinceAtom(overviewAtom)))
	const traceSince = Option.getOrUndefined(useAtomValue(problemSinceAtom(traceAtom(props.trace.id))))
	const refreshOverview = useAtomRefresh(overviewAtom)
	const refreshTrace = useAtomRefresh(traceAtom(props.trace.id))
	const overviewStale = retained(overview)
	const traceStale = retained(traceResult)
	if (!overviewStale && !traceStale) return null
	const since = Option.getOrUndefined(
		Array.head(
			Array.sort(
				Array.filter(
					[
						Boolean.match(overviewStale, {onFalse: () => undefined, onTrue: () => overviewSince}),
						Boolean.match(traceStale, {onFalse: () => undefined, onTrue: () => traceSince})
					],
					Predicate.isNumber
				),
				Order.Number
			)
		)
	)
	return (
		<Problem
			label="Out of date"
			warning
			reset={() => {
				refreshOverview()
				refreshTrace()
			}}
			since={since}
		/>
	)
}

function StaleMark(props: {trace?: OperationTrace}) {
	return Option.match(Option.fromUndefinedOr(props.trace), {
		onNone: () => <OverviewStale />,
		onSome: trace => <TraceStale trace={trace} />
	})
}

function Spans(props: {
	detailOnly?: boolean
	id: string
	inlineDetails?: boolean
	onPick: (id: string) => void
	pickedSpan?: string
}) {
	const atom = traceAtom(props.id)
	const result = useAtomSuspense(atom, {includeFailure: true})
	const refresh = useAtomRefresh(atom)
	const value = AsyncResult.value(result)
	if (AsyncResult.isFailure(result) && (Option.isNone(value) || Option.exists(AsyncResult.error(result), isDenied))) {
		return <FailureContent error={Cause.squash(result.cause)} reset={refresh} />
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
							onSome: current => `${String.slice(0, 8)(current.id)} · ${ageOf(current.time, props.now)}`
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
				<OverviewContent>
					{() =>
						Option.match(trace, {
							onNone: () => (
								<EmptyState
									label={Boolean.match(props.detailOnly === true, {
										onFalse: () => 'Select a trace',
										onTrue: () => 'Select a span'
									})}
									icon={<EmptyIcon />}
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
					source={props.source}
				/>
				<TracesPane
					active={props.active}
					now={props.now}
					onSelect={props.onSelectTrace}
					selectedTrace={props.activeTrace}
				/>
			</div>
			<TracePane
				inlineDetails
				now={props.now}
				onPickSpan={props.onPickSpan}
				pickedSpan={props.pickedSpan}
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
				<OperationsPane activeKey={props.activeKey} onSelect={props.onSelectOperation} source={props.source} />
			</ResizablePanel>
			<ResizableHandle />
			<ResizablePanel defaultSize={320} minSize={240} maxSize={480}>
				<TracesPane
					active={props.active}
					now={props.now}
					onSelect={props.onSelectTrace}
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
						source={props.source}
					/>
				)),
				Match.when('Traces', () => (
					<TracesPane
						active={props.active}
						className="min-h-0 flex-1"
						now={props.now}
						onSelect={props.onSelectTrace}
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
	const overview = useAtomValue(overviewAtom)
	const refresh = useAtomRefresh(overviewAtom)
	const value = AsyncResult.value(overview)
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

	const workspaceProps = {
		active: Option.getOrUndefined(selection.activeOperation),
		activeKey: Option.getOrUndefined(selection.activeKey),
		activeTrace: Option.getOrUndefined(selection.activeTrace),
		now,
		onPickSpan: selectSpan,
		onSelectOperation: selectOperation,
		onSelectTrace: selectTrace,
		pickedSpan: selection.pickedSpan,
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
	return (
		<div className="flex min-h-0 flex-1 flex-col">
			<AppBar
				icon={icon}
				name="scope"
				title={Boolean.match(isMobile && pane !== 'Operations', {
					onFalse: () => undefined,
					onTrue: () =>
						pipe(
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
				})}
				back={Boolean.match(isMobile && pane !== 'Operations', {
					onFalse: () => undefined,
					onTrue: () => ({
						label: pipe(
							Match.value(pane),
							Match.when('Span', () => 'Trace'),
							Match.when('Trace', () => 'Traces'),
							Match.orElse(() => 'Operations')
						),
						onClick: () => send({_tag: 'Back'})
					})
				})}
				controls={<StaleMark trace={Option.getOrUndefined(selection.activeTrace)} />}
				tabs={Option.match(value, {
					onNone: () => undefined,
					onSome: current =>
						Boolean.match(isMobile && pane !== 'Operations', {
							onFalse: () => <SourceTabs apps={current.apps} source={selection.source} />,
							onTrue: () => undefined
						})
				})}
			/>
			{Option.match(authFailure, {
				onNone: () =>
					Option.match(blockingFailure, {
						onNone: () => renderPage(workspace),
						onSome: cause => renderPage(<FailureContent error={Cause.squash(cause)} reset={refresh} />)
					}),
				onSome: error => renderPage(<FailureContent error={error} reset={refresh} />)
			})}
		</div>
	)
}

export const Route = createFileRoute('/(home)/')({component: Home, validateSearch: WebRuntime.searchOf(Search)})
