import {useAtomRefresh, useAtomSuspense, useAtomValue} from '@effect/atom-react'

import {
	Array,
	Boolean,
	Cause,
	DateTime,
	Formatter,
	HashSet,
	Match,
	Number,
	Option,
	Order,
	Predicate,
	Record,
	Schema,
	String,
	Struct,
	pipe
} from 'effect'

import {ChartBarHorizontalIcon, DeviceMobileIcon, FlowArrowIcon, GlobeIcon, HardDrivesIcon} from '@phosphor-icons/react'
import {Link, createFileRoute, getRouteApi} from '@tanstack/react-router'
import {AsyncResult} from 'effect/reactivity'
import {Suspense, useEffect, useLayoutEffect, useRef, useState} from 'react'
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
import {GithubDark} from '@deslop/components-web/ui/svgs/githubDark'
import {GithubLight} from '@deslop/components-web/ui/svgs/githubLight'
import {cn, useMediaQuery} from '@deslop/components-web/utils'
import {isDenied, needsSignIn, signInUrl} from '@deslop/runtime/auth/utils'
import * as WebRuntime from '@deslop/runtime/web'

import {ageOf, durationOf, navigationOf, nextSearch, nowAtom, overviewAtom, Search, traceAtom} from '#lib/utils.ts'
import type {NavigationEvent, OperationKey} from '#lib/utils.ts'
import icon from '#routes/icon.svg'
import {appName} from '#services/telemetry/lib/utils.ts'
import type {Operation, OperationTrace, Overview, Runtime, Trace} from '#services/telemetry/schema.ts'

const STATUS: Record<string, string> = {
	400: 'Bad Request',
	401: 'Unauthorized',
	403: 'Forbidden',
	404: 'Not Found',
	409: 'Conflict',
	422: 'Unprocessable',
	429: 'Too Many Requests',
	500: 'Server Error',
	502: 'Bad Gateway',
	503: 'Unavailable',
	504: 'Gateway Timeout'
}

// The HTTP attributes a failed span's error line already reads, so its details do not repeat them.
const HTTP_ATTRIBUTES = [
	'http.request.method',
	'http.response.status_code',
	'server.address',
	'server.port',
	'url.full',
	'url.path',
	'url.scheme'
] as const

// The side an operation starts on: a 12px muted glyph after the name when two visible rows share it, and its name for their labels.
const SIDES: Record<Runtime, string> = {ci: 'CI', mobile: 'iOS', server: 'server', unknown: '', web: 'web'}

// The icicle's lanes: a 22px box, 2px between lanes, 6px box padding and gap between its name and time, 4px after an outside label; 8px covers the 12px mono face's advance.
const ICICLE_LANE = 24
const ICICLE_BOX = 22
const ICICLE_TEXT = 6
const ICICLE_GAP = 4
const ICICLE_CHAR = 8

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
const preciseClock = new Intl.DateTimeFormat(undefined, {
	fractionalSecondDigits: 3,
	hour: '2-digit',
	hourCycle: 'h23',
	minute: '2-digit',
	second: '2-digit'
})
const count = new Intl.NumberFormat(undefined, {maximumFractionDigits: 0})
const compact = new Intl.NumberFormat(undefined, {maximumFractionDigits: 1, notation: 'compact'})

// The icicle measures its lane width before paint; a server render such as the page test has no window.
const useIsomorphicLayoutEffect = Boolean.match(typeof window === 'undefined', {
	onFalse: () => useLayoutEffect,
	onTrue: () => useEffect
})

// One run or many, in the reader's words.
function runsOf(n: number) {
	return `${count.format(n)} ${Boolean.match(n === 1, {onFalse: () => 'runs', onTrue: () => 'run'})}`
}
const route = getRouteApi('/(home)/')

type Attributes = typeof Attributes.Type
const Attributes = Schema.Array(Schema.Struct({key: Schema.String, value: Schema.Json}))
type Wrapped = typeof Wrapped.Type
const Wrapped = Schema.Record(Schema.String, Schema.Json)

const marks = WebRuntime.appIcons(
	import.meta.glob<string>('../../../../*/src/routes/icon.svg', {eager: true, import: 'default', query: '?url'})
)

type ActiveOperation = {app: Overview['apps'][number]; operation: Operation}

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

// The operations rows' geometry while the overview loads: the 16px mark at the gutter, the name, then the same figure columns.
function OperationsSkeleton(props: {label: string}) {
	return (
		<div aria-busy="true" aria-label={props.label} role="status">
			{Array.map(Array.range(1, 8), row => (
				<Item key={row} aria-hidden size="row">
					<ItemMedia>
						<Skeleton className="size-4" />
					</ItemMedia>
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

// The icicle's 22px lanes while its trace loads, including a lane with two sibling boxes; no axis, which the real pane draws only with data.
function SpansSkeleton(props: {label: string}) {
	return (
		<div aria-busy="true" aria-label={props.label} role="status" className="px-4 pt-1.5 pb-2">
			<div
				className="relative h-(--ice-height)"
				style={{'--ice-height': `${4 * ICICLE_LANE - (ICICLE_LANE - ICICLE_BOX)}px`}}
			>
				{Array.map(
					[
						{left: 0, top: 0, width: 100},
						{left: 2, top: 24, width: 97},
						{left: 6, top: 48, width: 2.5},
						{left: 10, top: 48, width: 89},
						{left: 14, top: 72, width: 85}
					],
					(box, index) => (
						<Skeleton
							key={index}
							aria-hidden
							className="absolute top-(--ice-top) left-(--ice-left) h-5.5 w-(--ice-width)"
							style={{'--ice-left': `${box.left}%`, '--ice-top': `${box.top}px`, '--ice-width': `${box.width}%`}}
						/>
					)
				)}
			</div>
		</div>
	)
}

// The inspector's 24px rows while its span loads, sharing the same max-content key column as the real ones.
function DetailSkeleton(props: {label: string}) {
	return (
		<div
			aria-busy="true"
			aria-label={props.label}
			role="status"
			className="grid-cols-detail max-sm:grid-cols-detail-phone grid px-4"
		>
			{Array.map(Array.range(1, 6), row => (
				<div key={row} aria-hidden className="col-span-2 grid h-6 grid-cols-subgrid items-center gap-2.5">
					<Skeleton className="h-3 w-24" />
					<Skeleton className="h-3 w-1/2" />
				</div>
			))}
		</div>
	)
}

function FailureContent(props: {error: unknown; reset: () => void}) {
	if (needsSignIn(props.error)) return <SignIn href={signInUrl(location.href)} />
	if (isDenied(props.error)) return <Denied />
	return <Error error={props.error} reset={props.reset} />
}

// An attribute's value as OTLP wraps it, such as {stringValue: "…"}, shown as its one value.
function valueOf(value: Schema.Json) {
	return pipe(
		Schema.decodeUnknownOption(Wrapped)(value),
		Option.flatMap(wrapped => Array.head(Record.values(wrapped))),
		Option.filter(inner => Predicate.isString(inner) || Predicate.isNumber(inner) || Predicate.isBoolean(inner)),
		Option.match({onNone: () => Formatter.formatJson(value), onSome: inner => `${inner}`})
	)
}

function errorOf(span: Trace['spans'][number]) {
	return pipe(
		Option.liftPredicate(span, current => current.status === 2),
		Option.flatMap(current => Option.fromNullishOr(current.payload['status'])),
		Option.filter(Predicate.isObject),
		Option.flatMap(status => Option.fromNullishOr(pipe(Record.get(status, 'message'), Option.getOrUndefined))),
		Option.filter(String.isString),
		Option.filter(String.isNonEmpty)
	)
}

// Attributes, without anything that only repeats the row: its name, code.function, or the status code the error line carries.
function attributesOf(span: Trace['spans'][number]) {
	if (span.payload['attributes'] === undefined) return []
	return Option.match(Schema.decodeUnknownOption(Attributes)(span.payload['attributes']), {
		onNone: () => [{key: 'attributes', value: 'Unreadable'}],
		onSome: decoded => {
			const failed = Option.isSome(errorOf(span))
			const attributes = Array.map(
				Array.filter(decoded, attribute => attribute.key !== 'service.name'),
				attribute => ({key: attribute.key, value: valueOf(attribute.value)})
			)
			const status = Array.findFirst(attributes, attribute => attribute.key === 'http.response.status_code')
			return Array.filter(
				attributes,
				attribute =>
					attribute.value !== span.name &&
					!(failed && Array.contains(HTTP_ATTRIBUTES, attribute.key)) &&
					(attribute.key !== 'error.type' || !Option.exists(status, code => code.value === attribute.value))
			)
		}
	})
}

// Effect's HTTP client error as a status line, method and host; anything else stays as the server wrote it.
function ErrorText(props: {message: string}) {
	return Option.match(String.match(/^StatusCode error \((\d{3}) (\w+) (https?:\/\/[^\s)]+)\)$/u)(props.message), {
		onNone: () => <span className="break-words">{props.message}</span>,
		onSome: parts => {
			const code = parts[1] ?? ''
			const method = parts[2] ?? ''
			const url = parts[3] ?? ''
			return (
				<span className="flex min-w-0 flex-wrap items-baseline gap-x-2 break-words">
					<span className="font-medium">
						{code} {Option.getOrElse(Record.get(STATUS, code), () => '')}
					</span>
					<span>{method}</span>
					<span className="min-w-0 break-all">{String.replace(/^https?:\/\//u, '')(url)}</span>
				</span>
			)
		}
	})
}

// A span opens only when it has something its row doesn't already show.
function hasDetail(span: Trace['spans'][number]) {
	return (
		Option.isSome(errorOf(span)) ||
		Array.isReadonlyArrayNonEmpty(attributesOf(span)) ||
		Array.isReadonlyArrayNonEmpty(span.logs)
	)
}

// An app's mark: its own icon, GitHub's for CI, else a server glyph; never a letter tile. A heading names the app, so the mark is decorative.
function AppMark(props: {app: Overview['apps'][number]}) {
	return Option.match(Option.fromUndefinedOr(marks[props.app.name]), {
		onNone: () =>
			Boolean.match(
				Array.every(props.app.operations, operation => operation.runtime === 'ci'),
				{
					onFalse: () => <HardDrivesIcon aria-hidden className="text-muted-foreground size-4 shrink-0" />,
					// GitHub's mark fills its box edge to edge where the pixel icons keep a margin, so it sits at 14px in the same 16px slot.
					onTrue: () => (
						<span aria-hidden className="flex size-4 shrink-0 items-center justify-center">
							<GithubLight className="size-3.5 dark:hidden" />
							<GithubDark className="hidden size-3.5 dark:block" />
						</span>
					)
				}
			),
		onSome: mark => <img src={mark} alt="" className="pixelated size-4 shrink-0" />
	})
}

// The waterfall's mark, and the trace list's until an operation is chosen.
function WaterfallGlyph() {
	return <ChartBarHorizontalIcon aria-hidden className="text-muted-foreground size-4 shrink-0" />
}

// The bar's app filter: one mark per app, no All; no tab is active while every app shows, and the active tab clears the filter.
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
						/>
					}
				>
					<AppMark app={app} />
				</AppBarTab>
			))}
		</AppBarTabs>
	)
}

// The most recent trace an operation started, which orders the list after failures.
function latestOf(operation: Operation) {
	return Array.match(operation.traces, {
		onEmpty: () => 0n,
		onNonEmpty: traces =>
			BigInt(
				Array.max(
					traces,
					Order.mapInput(Order.BigInt, (trace: OperationTrace) => BigInt(trace.time))
				).time
			)
	})
}

// One list of operations, narrowed to the chosen app: failing first, then most recent.
function operationsOf(overview: Overview, source?: string) {
	return Array.sort(
		Array.flatMap(
			Array.filter(overview.apps, (app: Overview['apps'][number]) => source === undefined || app.name === source),
			(app: Overview['apps'][number]) => Array.map(app.operations, operation => ({app, operation}))
		),
		Order.combine(
			Order.mapInput(Order.flip(Order.Boolean), (row: ActiveOperation) => row.operation.failures > 0),
			Order.mapInput(Order.flip(Order.BigInt), (row: ActiveOperation) => latestOf(row.operation))
		)
	)
}

// Suspend the rows, not their shell. Home owns failures; ordinary outages retain the last overview.
function OverviewContent(props: {children: (overview: Overview) => ReactNode}) {
	return Option.match(AsyncResult.value(useAtomSuspense(overviewAtom, {includeFailure: true})), {
		onNone: () => null,
		onSome: props.children
	})
}

// One operation: its app's mark, its name and side when two rows share it, then errors, runs and typical duration.
function OperationRow(props: {
	active: boolean
	app: Overview['apps'][number]
	duplicate: boolean
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
								`${props.app.name} ${props.operation.name}`,
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
				<ItemMedia>
					<AppMark app={props.app} />
				</ItemMedia>
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
													app={row.app}
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

// The trace's time scale: start, quarters and total, in tabular figures.
function TimeAxis(props: {totalMs: number}) {
	const total = Number.max(props.totalMs, 1)
	return (
		<div className="text-muted-foreground h-6 shrink-0 border-b px-4 text-xs tabular-nums">
			<div className="relative h-full">
				{Array.map([0, 0.25, 0.5, 0.75, 1] as const, ratio => (
					<span
						key={ratio}
						className={cn(
							'absolute top-1/2 left-(--axis-left) -translate-y-1/2 whitespace-nowrap',
							Boolean.match(ratio === 0, {
								onFalse: () =>
									Boolean.match(ratio === 1, {onFalse: () => '-translate-x-1/2', onTrue: () => '-translate-x-full'}),
								onTrue: () => undefined
							})
						)}
						style={{'--axis-left': `${ratio * 100}%`}}
					>
						{Boolean.match(ratio === 0, {onFalse: () => durationOf(total * ratio), onTrue: () => '0'})}
					</span>
				))}
			</div>
		</div>
	)
}

// One lane per span depth, each span a box on the trace's time scale; a short box borrows the free lane after it for its label.
function Icicle(props: {focus?: string; onPick: (id: string) => void; trace: Trace}) {
	const total = Number.max(props.trace.durationMs, 1)
	const lanes = Array.reduce(props.trace.spans, 0, (deepest, span) => Number.max(deepest, span.depth)) + 1
	const [width, setWidth] = useState(0)
	const surface = useRef<HTMLDivElement>(null)
	useIsomorphicLayoutEffect(() => {
		const element = surface.current
		if (element === null) return
		setWidth(element.getBoundingClientRect().width)
		const observer = new ResizeObserver(() => setWidth(element.getBoundingClientRect().width))
		observer.observe(element)
		return () => observer.disconnect()
	}, [])
	const rows = Array.map(props.trace.spans, span => {
		const fraction = span.durationMs / total
		const box = fraction * width
		const time = durationOf(span.durationMs)
		const label = `${span.name} ${time}`
		const inline = width === 0 || box >= time.length * ICICLE_CHAR + ICICLE_TEXT * 2 + ICICLE_TEXT
		const free = Number.max(
			0,
			((Number.min(
				Array.reduce(
					Array.filter(props.trace.spans, other => other.depth === span.depth && other.offsetMs > span.offsetMs),
					Infinity,
					(soonest, other) => Number.min(soonest, other.offsetMs)
				),
				total
			) -
				span.offsetMs -
				span.durationMs) /
				total) *
				width
		)
		return {
			box,
			inline,
			label,
			left: (span.offsetMs / total) * 100,
			outside: !inline && free >= label.length * ICICLE_CHAR + ICICLE_GAP,
			outsideLeft: (span.offsetMs / total) * width + Number.max(box, 1) + ICICLE_GAP,
			picked: span.spanId === props.focus,
			span,
			time,
			top: span.depth * ICICLE_LANE,
			width: fraction * 100
		}
	})
	return (
		<div className="mt-1.5 mb-2 px-4">
			<div
				ref={surface}
				role="group"
				aria-label="Spans"
				className="relative h-(--ice-height) w-full"
				style={{'--ice-height': `${lanes * ICICLE_LANE - (ICICLE_LANE - ICICLE_BOX)}px`}}
			>
				{Array.map(rows, row => (
					<div
						key={row.span.spanId}
						data-icicle-box=""
						data-span-id={row.span.spanId}
						className="has-[:focus-visible]:outline-ring absolute top-(--span-top) left-(--span-left) h-5.5 w-(--span-width) min-w-px has-[:focus-visible]:outline-2"
						style={{'--span-left': `${row.left}%`, '--span-top': `${row.top}px`, '--span-width': `${row.width}%`}}
					>
						<span
							aria-hidden
							data-app={appName(row.span.service)}
							className={cn(
								'text-background absolute inset-0 flex items-center overflow-hidden text-xs',
								Boolean.match(row.inline, {onFalse: () => undefined, onTrue: () => 'px-1.5'}),
								Boolean.match(row.span.status === 2, {onFalse: () => 'bg-(--app)', onTrue: () => 'bg-destructive'}),
								Boolean.match(row.picked, {
									onFalse: () => undefined,
									onTrue: () => 'outline-1 outline-foreground outline-offset-[-1px]'
								})
							)}
						>
							{Boolean.match(row.inline, {
								onFalse: () => null,
								onTrue: () => (
									<span className="flex w-full min-w-0 items-center gap-1.5">
										<span className="min-w-0 truncate">{row.span.name}</span>
										<span className="shrink-0 opacity-70">{row.time}</span>
									</span>
								)
							})}
						</span>
						<button
							type="button"
							aria-current={Boolean.match(row.picked, {onFalse: () => undefined, onTrue: () => 'true' as const})}
							aria-label={row.label}
							title={row.label}
							onClick={() => props.onPick(row.span.spanId)}
							className="absolute inset-0 h-full w-full border-0 bg-transparent p-0 outline-none"
						/>
					</div>
				))}
				{Array.map(rows, row =>
					Boolean.match(row.outside, {
						onFalse: () => null,
						onTrue: () => (
							<span
								key={`label:${row.span.spanId}`}
								aria-hidden
								data-icicle-label=""
								className="text-muted-foreground pointer-events-none absolute top-(--label-top) left-(--label-left) h-5.5 text-xs leading-5.5 whitespace-nowrap"
								style={{'--label-left': `${row.outsideLeft}px`, '--label-top': `${row.top}px`}}
							>
								{row.label}
							</span>
						)
					})
				)}
			</div>
		</div>
	)
}

// The picked span's error, attributes and logs, as 24px rows with no dividers between them; a span with none shows no rows.
function SpanDetail(props: {span: Trace['spans'][number]}) {
	const error = errorOf(props.span)
	const attributes = attributesOf(props.span)
	if (
		!Option.isSome(error) &&
		!Array.isReadonlyArrayNonEmpty(attributes) &&
		!Array.isReadonlyArrayNonEmpty(props.span.logs)
	) {
		return null
	}
	return (
		<div
			role="list"
			aria-label="Span details"
			className="grid-cols-detail max-sm:grid-cols-detail-phone grid px-4 text-xs"
		>
			{Option.match(error, {
				onNone: () => null,
				onSome: message => (
					<div role="listitem" className="col-span-2 grid h-6 grid-cols-subgrid items-center gap-2.5">
						<span className="text-muted-foreground truncate">error</span>
						<span className="text-destructive min-w-0 truncate" title={message}>
							<ErrorText message={message} />
						</span>
					</div>
				)
			})}
			{Array.map(attributes, (attribute, index) => (
				<div
					key={`${attribute.key}:${index}`}
					role="listitem"
					className="col-span-2 grid h-6 grid-cols-subgrid items-center gap-2.5"
				>
					<span className="text-muted-foreground truncate" title={attribute.key}>
						{attribute.key}
					</span>
					<span className="block min-w-0 truncate select-text" title={attribute.value}>
						{Boolean.match(attribute.key === 'url.full' && String.startsWith('https://')(attribute.value), {
							onFalse: () => attribute.value,
							onTrue: () => (
								<a href={attribute.value} target="_blank" rel="noreferrer" className="text-primary">
									{attribute.value}
								</a>
							)
						})}
					</span>
				</div>
			))}
			{Array.map(props.span.logs, (log, index) => (
				<div
					key={`${log.id}:${index}`}
					role="listitem"
					className="grid-cols-log col-span-2 grid h-6 items-center gap-2.5"
				>
					<span className="text-muted-foreground truncate tabular-nums">
						{Option.match(Number.parse(String.slice(0, -6)(log.time)), {
							onNone: () => '—',
							onSome: timestamp => preciseClock.format(timestamp)
						})}
					</span>
					<span
						className={cn(
							'text-muted-foreground block min-w-0 truncate',
							Boolean.match(log.status === 2, {onFalse: () => undefined, onTrue: () => 'text-destructive'})
						)}
						title={log.name}
					>
						{log.name}
					</span>
				</div>
			))}
		</div>
	)
}

// The picked span's details alone, for the phone's pushed span screen; a picked span with none says so with the same symbol.
function SpanDetails(props: {focus: Option.Option<Trace['spans'][number]>}) {
	return Option.match(props.focus, {
		onNone: () => <EmptyState label="Select a span" icon={<EmptyIcon />} />,
		onSome: span =>
			Boolean.match(hasDetail(span), {
				onFalse: () => <EmptyState label="No details" icon={<EmptyIcon />} />,
				onTrue: () => (
					<ScrollArea className="min-h-0 flex-1">
						<div className="flex flex-col">
							<SpanDetail span={span} />
						</div>
					</ScrollArea>
				)
			})
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
			{Boolean.match(props.inlineDetails && Option.exists(props.focus, hasDetail), {
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

// Effect marks every span a failure passed through, so where it broke is the failed span with no failed child.
function brokeAt(spans: Trace['spans']) {
	const failed = Array.filter(spans, span => span.status === 2)
	const parents = HashSet.fromIterable(
		Array.map(failed, span =>
			String.toLowerCase(
				Option.getOrElse(Option.filter(Option.fromNullishOr(span.payload['parentSpanId']), String.isString), () => '')
			)
		)
	)
	return Array.findFirst(failed, span => !HashSet.has(parents, span.spanId))
}

// The span the URL picks, else where the failure broke, else the first span with details.
function focusOf(trace: Trace, pickedSpan?: string) {
	const root = Array.findFirst(trace.spans, span => span.depth === 0)
	return Option.orElse(
		Array.findFirst(trace.spans, span => span.spanId === pickedSpan),
		() =>
			pipe(
				brokeAt(trace.spans),
				Option.orElse(() => root),
				Option.filter(hasDetail),
				Option.orElse(() => Array.findFirst(trace.spans, hasDetail))
			)
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

function findOperation(overview: Overview, key: OperationKey) {
	return Option.flatMap(
		Array.findFirst(overview.apps, app => app.name === key.app),
		app =>
			Option.map(
				Array.findFirst(app.operations, operation => operation.runtime === key.runtime && operation.name === key.name),
				operation => ({app, operation})
			)
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
	const source = search.source
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

	const activeOperation = Option.orElse(
		Option.flatMap(Option.fromUndefinedOr(navigation.selection?.operation), key =>
			Option.flatMap(value, current => findOperation(current, key))
		),
		() =>
			Boolean.match(isMobile, {
				onFalse: () =>
					Option.flatMap(value, current =>
						Option.map(Array.head(operationsOf(current, source)), row => ({app: row.app, operation: row.operation}))
					),
				onTrue: () => Option.none<ActiveOperation>()
			})
	)
	const activeKey = Option.map(activeOperation, active => ({
		app: active.app.name,
		name: active.operation.name,
		runtime: active.operation.runtime
	}))
	const activeTrace = Option.flatMap(activeOperation, active =>
		Option.orElse(
			Option.flatMap(Option.fromUndefinedOr(navigation.selection?.traceId), selected =>
				Array.findFirst(active.operation.traces, trace => trace.id === selected)
			),
			() => Array.head(active.operation.traces)
		)
	)

	function selectOperation(app: string, operation: Operation) {
		send({_tag: 'Operation', operation: {app, name: operation.name, runtime: operation.runtime}})
	}

	function selectTrace(trace: OperationTrace) {
		Option.map(activeKey, operation => send({_tag: 'Trace', selection: {operation, traceId: trace.id}}))
	}

	function selectSpan(id: string) {
		Option.map(Option.all({operation: activeKey, trace: activeTrace}), selected =>
			send({_tag: 'Span', selection: {operation: selected.operation, spanId: id, traceId: selected.trace.id}})
		)
	}

	const pickedSpan = Option.getOrUndefined(
		Option.flatMap(
			Option.filter(Option.fromUndefinedOr(navigation.selection), selected =>
				Option.exists(activeTrace, trace => selected.traceId === trace.id)
			),
			selected => Option.fromUndefinedOr(selected.spanId)
		)
	)

	const workspace = Boolean.match(isMobile, {
		onFalse: () =>
			Boolean.match(isWide, {
				onFalse: () => (
					<NarrowWorkspace
						active={Option.getOrUndefined(activeOperation)}
						activeKey={Option.getOrUndefined(activeKey)}
						activeTrace={Option.getOrUndefined(activeTrace)}
						now={now}
						onPickSpan={selectSpan}
						onSelectOperation={selectOperation}
						onSelectTrace={selectTrace}
						pickedSpan={pickedSpan}
						source={source}
					/>
				),
				onTrue: () => (
					<WideWorkspace
						active={Option.getOrUndefined(activeOperation)}
						activeKey={Option.getOrUndefined(activeKey)}
						activeTrace={Option.getOrUndefined(activeTrace)}
						now={now}
						onPickSpan={selectSpan}
						onSelectOperation={selectOperation}
						onSelectTrace={selectTrace}
						pickedSpan={pickedSpan}
						source={source}
					/>
				)
			}),
		onTrue: () => (
			<MobileWorkspace
				active={Option.getOrUndefined(activeOperation)}
				activeKey={Option.getOrUndefined(activeKey)}
				activeTrace={Option.getOrUndefined(activeTrace)}
				now={now}
				onPickSpan={selectSpan}
				onSelectOperation={selectOperation}
				onSelectTrace={selectTrace}
				pane={pane}
				pickedSpan={pickedSpan}
				source={source}
			/>
		)
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
								Option.match(activeOperation, {onNone: () => 'Traces', onSome: active => active.operation.name})
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
				controls={<StaleMark trace={Option.getOrUndefined(activeTrace)} />}
				tabs={Option.match(value, {
					onNone: () => undefined,
					onSome: current =>
						Boolean.match(isMobile && pane !== 'Operations', {
							onFalse: () => <SourceTabs apps={current.apps} source={source} />,
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
