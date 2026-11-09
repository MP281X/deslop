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
	pipe
} from 'effect'

import {DeviceMobileIcon, FlowArrowIcon, GlobeIcon, HardDrivesIcon, XIcon} from '@phosphor-icons/react'
import {createFileRoute, getRouteApi} from '@tanstack/react-router'
import {AsyncResult} from 'effect/reactivity'
import {Suspense, useEffect, useRef} from 'react'
import type {ReactElement, ReactNode} from 'react'

import {AppBar} from '@deslop/components-web/app-bar'
import {otherApps} from '@deslop/components-web/command-palette'
import type {PaletteGroup} from '@deslop/components-web/command-palette'
import {Denied, EmptyState, Error, SignIn} from '@deslop/components-web/fallbacks'
import {ItemListSkeleton} from '@deslop/components-web/item-list'
import {Problem, problemSinceAtom} from '@deslop/components-web/problem'
import {StatusDot} from '@deslop/components-web/status-dot'
import {Item, ItemActions, ItemContent, ItemMedia, ItemTitle} from '@deslop/components-web/ui/item'
import {ResizableHandle, ResizablePanel, ResizablePanelGroup} from '@deslop/components-web/ui/resizable'
import {ScrollArea} from '@deslop/components-web/ui/scroll-area'
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

const SIDES: Record<Runtime, string> = {ci: 'ci', mobile: 'iOS', server: 'server', unknown: '', web: 'web'}

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

// The device an operation starts on, as Auth marks a sign-in's; it is a shape, not a hue.
const DEVICES: Record<Runtime, ReactElement> = {
	ci: <FlowArrowIcon role="img" aria-label="CI" className="text-muted-foreground size-3.5 shrink-0" />,
	mobile: <DeviceMobileIcon role="img" aria-label="iOS" className="text-muted-foreground size-3.5 shrink-0" />,
	server: <HardDrivesIcon role="img" aria-label="server" className="text-muted-foreground size-3.5 shrink-0" />,
	unknown: <HardDrivesIcon aria-hidden className="text-muted-foreground size-3.5 shrink-0" />,
	web: <GlobeIcon role="img" aria-label="web" className="text-muted-foreground size-3.5 shrink-0" />
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
type FlatOperation = {app: Overview['apps'][number]; operation: Operation}

// The span rows the page's hotkeys move through, owned by the open trace's list.
type SpanNavigation = {next: () => void; open: () => void; previous: () => void}
const NO_SPAN_NAVIGATION: SpanNavigation = {next: () => undefined, open: () => undefined, previous: () => undefined}

type WorkspaceProps = {
	active?: ActiveOperation
	activeKey?: OperationKey
	activeTrace?: OperationTrace
	now: number
	onMoveSpan: (id: string) => void
	onPickSpan: (id: string) => void
	onRegisterSpanNavigation: (navigation: SpanNavigation) => void
	onSelectOperation: (app: string, operation: Operation) => void
	onSelectTrace: (trace: OperationTrace) => void
	pickedSpan?: string
}

// A pane with nothing selected keeps its mark alone, never a sentence that repeats the pane's name.
function EmptyIcon() {
	return <img src={icon} alt="" className="pixelated size-8 opacity-50" />
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

// An app's mark: its own icon, GitHub's for CI, else a server glyph; never a letter tile.
function AppMark(props: {app: Overview['apps'][number]}) {
	return Option.match(Option.fromUndefinedOr(marks[props.app.name]), {
		onNone: () =>
			Boolean.match(
				Array.every(props.app.operations, operation => operation.runtime === 'ci'),
				{
					onFalse: () => (
						<HardDrivesIcon role="img" aria-label={props.app.name} className="text-muted-foreground size-4 shrink-0" />
					),
					onTrue: () => (
						<>
							<GithubLight role="img" aria-label={props.app.name} className="size-4 shrink-0 dark:hidden" />
							<GithubDark role="img" aria-label={props.app.name} className="hidden size-4 shrink-0 dark:block" />
						</>
					)
				}
			),
		onSome: mark => <img src={mark} alt={props.app.name} className="pixelated size-4 shrink-0" />
	})
}

// Every app's operations as one list: failures first, then the busiest, never grouped by app.
function flatOperations(overview: Overview) {
	return Array.sort(
		Array.flatMap(overview.apps, app => Array.map(app.operations, operation => ({app, operation}))),
		Order.combine(
			Order.mapInput(Order.flip(Order.Number), (row: FlatOperation) => row.operation.failures),
			Order.mapInput(Order.flip(Order.Number), (row: FlatOperation) => row.operation.count)
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

// One operation: its app's mark, its name, the side it starts on, then errors, runs and typical duration.
function OperationRow(props: {
	active: boolean
	app: Overview['apps'][number]
	onSelect: () => void
	operation: Operation
}) {
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
					<ItemTitle className="w-full" title={props.operation.name}>
						{props.operation.name}
					</ItemTitle>
				</ItemContent>
				<ItemActions>
					<span className="grid-cols-operation grid items-center gap-x-2">
						{DEVICES[props.operation.runtime]}
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

// Every app's operations as one flat list; nothing selects when there are no traces yet.
function OperationsPane(props: {
	activeKey?: OperationKey
	className?: string
	onSelect: (app: string, operation: Operation) => void
}) {
	const current = useAtomValue(overviewAtom)
	const refresh = useAtomRefresh(overviewAtom)
	const since = Option.getOrUndefined(useAtomValue(problemSinceAtom(overviewAtom)))
	return (
		<section aria-label="Operations" className={cn('flex h-full min-h-0 flex-col overflow-hidden', props.className)}>
			<Suspense fallback={<ItemListSkeleton label="Operations" media rows={8} />}>
				<OverviewContent>
					{overview =>
						Array.match(flatOperations(overview), {
							onEmpty: () => <EmptyState label="No traces yet" icon={<EmptyIcon />} />,
							onNonEmpty: rows => (
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
												onSelect={() => props.onSelect(row.app.name, row.operation)}
												operation={row.operation}
											/>
										))}
									</div>
								</ScrollArea>
							)
						})
					}
				</OverviewContent>
			</Suspense>
			{Boolean.match(AsyncResult.isFailure(current) && Option.isSome(AsyncResult.value(current)), {
				onFalse: () => null,
				onTrue: () => (
					<div className="flex shrink-0 justify-end px-4">
						<Problem label="Operations out of date" warning reset={refresh} since={since} />
					</div>
				)
			})}
		</section>
	)
}

// One trace of the operation: its age, short id, where it broke and its duration; the row selects it.
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
				<ItemMedia className="w-10">
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
					<ItemTitle className="w-full" title={props.trace.id}>
						{String.slice(0, 8)(props.trace.id)}
					</ItemTitle>
				</ItemContent>
				<ItemActions>
					<span className="flex w-2 items-center justify-center">
						{props.trace.failure !== undefined && (
							<span
								role="img"
								className="flex items-center justify-center"
								aria-label={`Failed in ${props.trace.failure.span}`}
								title={`Failed in ${props.trace.failure.span}`}
							>
								<StatusDot status="error" />
							</span>
						)}
					</span>
					<span className="w-18 text-right tabular-nums">{durationOf(props.trace.durationMs)}</span>
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
			<Suspense fallback={<ItemListSkeleton label="Traces" rows={8} />}>
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

// One waterfall row: its app's hue on the bar, its name indented by depth, and its duration.
function SpanRow(props: {
	focus?: string
	mark: Option.Option<string>
	onPick: (id: string) => void
	span: Trace['spans'][number]
}) {
	const interactive = hasDetail(props.span)
	const open = interactive && props.focus === props.span.spanId
	return (
		<div role="listitem">
			<Item
				size="row"
				data-selected={Boolean.match(open, {onFalse: () => undefined, onTrue: () => 'true' as const})}
				render={Boolean.match(interactive, {
					onFalse: () => undefined,
					onTrue: () => (
						<button
							type="button"
							aria-label={Array.join(
								[
									`${appName(props.span.service)} ${props.span.name}`,
									durationOf(props.span.durationMs),
									...Boolean.match(props.span.status === 2, {onFalse: () => [], onTrue: () => ['failed']})
								],
								', '
							)}
							aria-current={Boolean.match(open, {onFalse: () => undefined, onTrue: () => 'true' as const})}
							onClick={() => props.onPick(props.span.spanId)}
						/>
					)
				})}
			>
				<ItemMedia className="w-36 sm:w-60">
					<span
						className="flex w-full min-w-0 items-center gap-2 pl-(--indent)"
						style={{'--indent': `${props.span.depth * 16}px`}}
					>
						{Option.match(props.mark, {
							onNone: () => null,
							onSome: mark => <img src={mark} alt="" className="pixelated size-4 shrink-0" />
						})}
						<span className={cn('truncate', props.span.status === 2 && 'text-destructive')} title={props.span.name}>
							{props.span.name}
						</span>
					</span>
				</ItemMedia>
				<ItemContent>
					<span className="bg-muted relative h-2 w-full">
						<span
							data-app={appName(props.span.service)}
							className={cn(
								'absolute top-0 left-(--offset) h-2 w-(--length) min-w-0.5',
								Boolean.match(props.span.status === 2, {onFalse: () => 'bg-(--app)', onTrue: () => 'bg-destructive'})
							)}
							style={{
								'--length': `calc(${props.span.durationMs} / var(--trace-total) * 100%)`,
								'--offset': `calc(${props.span.offsetMs} / var(--trace-total) * 100%)`
							}}
						/>
					</span>
				</ItemContent>
				<ItemActions>
					<span className="text-muted-foreground w-18 text-right tabular-nums">
						{durationOf(props.span.durationMs)}
					</span>
				</ItemActions>
			</Item>
		</div>
	)
}

// The picked span's error, attributes and logs, as rows after its span row.
function SpanDetail(props: {span: Trace['spans'][number]}) {
	const error = errorOf(props.span)
	const attributes = attributesOf(props.span)
	if (
		!Option.isSome(error) &&
		!Array.isReadonlyArrayNonEmpty(attributes) &&
		!Array.isReadonlyArrayNonEmpty(props.span.logs)
	) {
		return <EmptyState label="Select a span" icon={<EmptyIcon />} />
	}
	return (
		<div role="list" aria-label="Span details">
			{Option.match(error, {
				onNone: () => null,
				onSome: message => (
					<div role="listitem">
						<Item size="row">
							<ItemMedia>
								<XIcon aria-hidden className="text-destructive size-4" />
							</ItemMedia>
							<ItemContent>
								<span className="text-destructive block min-w-0 truncate" title={message}>
									<ErrorText message={message} />
								</span>
							</ItemContent>
						</Item>
					</div>
				)
			})}
			{Array.map(attributes, (attribute, index) => (
				<div key={`${attribute.key}:${index}`} role="listitem">
					<Item size="row">
						<ItemMedia className="w-36 sm:w-50">
							<span className="text-muted-foreground w-full truncate" title={attribute.key}>
								{attribute.key}
							</span>
						</ItemMedia>
						<ItemContent>
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
						</ItemContent>
					</Item>
				</div>
			))}
			{Array.map(props.span.logs, (log, index) => (
				<div key={`${log.id}:${index}`} role="listitem">
					<Item size="row">
						<ItemMedia className="w-24">
							<span className="text-muted-foreground w-full truncate tabular-nums">
								{Option.match(Number.parse(String.slice(0, -6)(log.time)), {
									onNone: () => '—',
									onSome: timestamp => preciseClock.format(timestamp)
								})}
							</span>
						</ItemMedia>
						<ItemContent>
							<span
								className={cn(
									'text-muted-foreground block min-w-0 truncate',
									Boolean.match(log.status === 2, {onFalse: () => undefined, onTrue: () => 'text-destructive'})
								)}
								title={log.name}
							>
								{log.name}
							</span>
						</ItemContent>
					</Item>
				</div>
			))}
		</div>
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

// Registers the open trace's span rows for the page's hotkeys; only rows with detail can be picked.
function SpanHotkeys(props: {
	focus: Option.Option<Trace['spans'][number]>
	onMove: (id: string) => void
	onOpen: (id: string) => void
	onRegister: (navigation: SpanNavigation) => void
	spans: Trace['spans']
}) {
	useEffect(() => {
		const rows = Array.filter(props.spans, hasDetail)
		const index = Option.match(props.focus, {
			onNone: () => -1,
			onSome: span =>
				Option.getOrElse(
					Array.findFirstIndex(rows, row => row.spanId === span.spanId),
					() => -1
				)
		})
		function move(delta: number) {
			if (Array.isArrayEmpty(rows)) return
			const next = Number.clamp(index + delta, {maximum: rows.length - 1, minimum: 0})
			if (next === index) return
			Option.match(Array.get(rows, next), {onNone: () => undefined, onSome: span => props.onMove(span.spanId)})
		}
		props.onRegister({
			next: () => move(1),
			open: () => Option.match(props.focus, {onNone: () => undefined, onSome: span => props.onOpen(span.spanId)}),
			previous: () => move(-1)
		})
		return () => {
			props.onRegister(NO_SPAN_NAVIGATION)
		}
	}, [props])
	return null
}

// The waterfall in trace order, independently scrolling; its time scale is the trace's own duration.
function SpansList(props: {
	focus: Option.Option<Trace['spans'][number]>
	inlineDetails: boolean
	onPick: (id: string) => void
	trace: Trace
}) {
	if (!Array.isReadonlyArrayNonEmpty(props.trace.spans)) {
		return <EmptyState label="No spans" icon={<EmptyIcon />} />
	}
	const root = Array.findFirst(props.trace.spans, span => span.depth === 0)
	const below = Array.filter(props.trace.spans, span => !Option.exists(root, top => top.spanId === span.spanId))
	const services = Record.fromEntries(Array.map(props.trace.spans, span => [span.spanId, span.service] as const))
	function mark(span: Trace['spans'][number]) {
		const parent =
			services[span.parentSpanId] ?? Option.match(root, {onNone: () => span.service, onSome: top => top.service})
		return Option.filter(
			Option.fromUndefinedOr(marks[appName(span.service)]),
			() => appName(span.service) !== appName(parent)
		)
	}
	const focusId = Option.getOrUndefined(Option.map(props.focus, span => span.spanId))
	return (
		<ScrollArea className="min-h-0 flex-1">
			<div className="flex flex-col" style={{'--trace-total': `${Number.max(props.trace.durationMs, 1)}`}}>
				<div role="list">
					{Option.match(root, {
						onNone: () => null,
						onSome: span => <SpanRow focus={focusId} mark={mark(span)} onPick={props.onPick} span={span} />
					})}
					{Array.map(below, span => (
						<SpanRow key={span.spanId} focus={focusId} mark={mark(span)} onPick={props.onPick} span={span} />
					))}
				</div>
				{Boolean.match(props.inlineDetails && Option.isSome(props.focus), {
					onFalse: () => null,
					onTrue: () => Option.match(props.focus, {onNone: () => null, onSome: span => <SpanDetail span={span} />})
				})}
			</div>
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

function focusOf(trace: Trace, pickedSpan?: string) {
	const root = Array.findFirst(trace.spans, span => span.depth === 0)
	return Option.orElse(
		Array.findFirst(trace.spans, span => span.spanId === pickedSpan && hasDetail(span)),
		() =>
			pipe(
				brokeAt(trace.spans),
				Option.orElse(() => root),
				Option.filter(hasDetail),
				Option.orElse(() => Array.findFirst(trace.spans, hasDetail))
			)
	)
}

function TraceProblem(props: {id: string}) {
	const atom = traceAtom(props.id)
	const result = useAtomValue(atom)
	const refresh = useAtomRefresh(atom)
	const since = Option.getOrUndefined(useAtomValue(problemSinceAtom(atom)))
	if (!AsyncResult.isFailure(result) || Option.isNone(AsyncResult.value(result))) return null
	return (
		<div className="flex shrink-0 justify-end px-4">
			<Problem label="Trace out of date" warning reset={refresh} since={since} />
		</div>
	)
}

// A failed refresh keeps the last trace, but authorization failures never expose retained spans.
function Spans(props: {
	detailOnly?: boolean
	id: string
	inlineDetails?: boolean
	onMove: (id: string) => void
	onPick: (id: string) => void
	onRegisterSpanNavigation: (navigation: SpanNavigation) => void
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
			return (
				<>
					<SpanHotkeys
						focus={focus}
						onMove={props.onMove}
						onOpen={props.onPick}
						onRegister={props.onRegisterSpanNavigation}
						spans={trace.spans}
					/>
					{Boolean.match(props.detailOnly === true, {
						onFalse: () => (
							<>
								<SpansList
									focus={focus}
									inlineDetails={props.inlineDetails === true}
									onPick={props.onPick}
									trace={trace}
								/>
								<TraceProblem id={props.id} />
							</>
						),
						onTrue: () => <SpanDetails focus={focus} />
					})}
				</>
			)
		}
	})
}

// The open trace's waterfall and, when inline, the picked span's details; its age, id and duration already sit on its selected row.
function TracePane(props: {
	className?: string
	detailOnly?: boolean
	inlineDetails?: boolean
	onMoveSpan: (id: string) => void
	onPickSpan: (id: string) => void
	onRegisterSpanNavigation: (navigation: SpanNavigation) => void
	pickedSpan?: string
	trace?: OperationTrace
}) {
	const trace = Option.fromUndefinedOr(props.trace)
	return (
		<section aria-label="Trace" className={cn('flex h-full min-h-0 flex-col overflow-hidden', props.className)}>
			<Suspense
				fallback={
					<ItemListSkeleton
						label={Boolean.match(props.detailOnly === true, {onFalse: () => 'Spans', onTrue: () => 'Span details'})}
						rows={6}
					/>
				}
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
									fallback={
										<ItemListSkeleton
											label={Boolean.match(props.detailOnly === true, {
												onFalse: () => 'Spans',
												onTrue: () => 'Span details'
											})}
											rows={6}
										/>
									}
								>
									<Spans
										key={current.id}
										detailOnly={props.detailOnly}
										id={current.id}
										inlineDetails={props.inlineDetails}
										onMove={props.onMoveSpan}
										onPick={props.onPickSpan}
										pickedSpan={props.pickedSpan}
										onRegisterSpanNavigation={props.onRegisterSpanNavigation}
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
				<OperationsPane activeKey={props.activeKey} className="border-b" onSelect={props.onSelectOperation} />
				<TracesPane
					active={props.active}
					now={props.now}
					onSelect={props.onSelectTrace}
					selectedTrace={props.activeTrace}
				/>
			</div>
			<TracePane
				inlineDetails
				onMoveSpan={props.onMoveSpan}
				onPickSpan={props.onPickSpan}
				pickedSpan={props.pickedSpan}
				onRegisterSpanNavigation={props.onRegisterSpanNavigation}
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
				<OperationsPane activeKey={props.activeKey} onSelect={props.onSelectOperation} />
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
					onMoveSpan={props.onMoveSpan}
					onPickSpan={props.onPickSpan}
					pickedSpan={props.pickedSpan}
					onRegisterSpanNavigation={props.onRegisterSpanNavigation}
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
					<OperationsPane activeKey={props.activeKey} className="min-h-0 flex-1" onSelect={props.onSelectOperation} />
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
						onMoveSpan={props.onMoveSpan}
						onPickSpan={props.onPickSpan}
						pickedSpan={props.pickedSpan}
						onRegisterSpanNavigation={props.onRegisterSpanNavigation}
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
	const navigation = navigationOf(route.useSearch())
	const navigate = route.useNavigate()
	function send(event: NavigationEvent) {
		navigate({search: previous => nextSearch(previous, event)})
	}
	const pane = navigation.path
	const root = useRef<HTMLDivElement>(null)
	const spanNavigation = useRef<SpanNavigation>(NO_SPAN_NAVIGATION)
	useEffect(() => {
		const container = root.current
		if (!isMobile || container === null) return
		const selector = pipe(
			Match.value(pane),
			Match.when('Span', () => 'header button'),
			Match.when('Trace', () => 'section[aria-label="Trace"] button[aria-current="true"]'),
			Match.when('Traces', () => 'section[aria-label="Traces"] button[aria-current="true"]'),
			Match.orElse(() => 'section[aria-label="Operations"] button[aria-current="true"]')
		)
		const target = container.querySelector<HTMLButtonElement>(selector)
		if (target !== null && target.getClientRects().item(0) !== null) {
			target.focus()
			return
		}
		const fallback = container.querySelector<HTMLButtonElement>('header button')
		fallback?.focus()
		// A push can reach its Suspense fallback before its selected row mounts.
		const pending = new MutationObserver(() => {
			if (
				container.ownerDocument.activeElement !== container.ownerDocument.body &&
				container.ownerDocument.activeElement !== fallback
			) {
				pending.disconnect()
				return
			}
			const ready = container.querySelector<HTMLButtonElement>(selector)
			if (ready !== null && ready.getClientRects().item(0) !== null) {
				pending.disconnect()
				ready.focus()
			}
		})
		pending.observe(container, {
			attributeFilter: ['aria-current', 'hidden', 'style'],
			attributes: true,
			childList: true,
			subtree: true
		})
		return () => pending.disconnect()
	}, [isMobile, pane, root])
	function registerSpanNavigation(registered: SpanNavigation) {
		spanNavigation.current = registered
	}
	const overview = useAtomValue(overviewAtom)
	useAtomValue(problemSinceAtom(overviewAtom))
	const refresh = useAtomRefresh(overviewAtom)
	const value = AsyncResult.value(overview)
	const authFailure = Option.filter(AsyncResult.error(overview), isDenied)
	const blockingFailure = Option.filter(AsyncResult.cause(overview), () => Option.isNone(value))
	const now = AsyncResult.getOrElse(useAtomValue(nowAtom), () => DateTime.toEpochMillis(DateTime.nowUnsafe()))

	const activeOperation = Option.orElse(
		Option.flatMap(Option.fromUndefinedOr(navigation.selection?.operation), key =>
			Option.flatMap(value, current => findOperation(current, key))
		),
		() => Option.flatMap(value, current => Array.head(flatOperations(current)))
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
	const operations: FlatOperation[] = Option.getOrElse(Option.map(value, flatOperations), () => [])
	const operationIndex = Option.match(activeKey, {
		onNone: () => -1,
		onSome: key =>
			Option.getOrElse(
				Array.findFirstIndex(
					operations,
					row => row.app.name === key.app && row.operation.name === key.name && row.operation.runtime === key.runtime
				),
				() => -1
			)
	})
	const traces = Option.getOrElse(
		Option.map(activeOperation, active => active.operation.traces),
		() => []
	)
	const traceIndex = Option.match(activeTrace, {
		onNone: () => -1,
		onSome: trace =>
			Option.getOrElse(
				Array.findFirstIndex(traces, row => row.id === trace.id),
				() => -1
			)
	})

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

	function moveSpan(id: string) {
		Option.map(Option.all({operation: activeKey, trace: activeTrace}), selected =>
			send({_tag: 'Pick', selection: {operation: selected.operation, spanId: id, traceId: selected.trace.id}})
		)
	}

	function moveOperation(delta: number) {
		const index = Number.clamp(operationIndex + delta, {maximum: Number.max(0, operations.length - 1), minimum: 0})
		if (index === operationIndex) return
		Option.match(Array.get(operations, index), {
			onNone: () => undefined,
			onSome: row =>
				send({
					_tag: 'Pick',
					selection: {operation: {app: row.app.name, name: row.operation.name, runtime: row.operation.runtime}}
				})
		})
	}

	function moveTrace(delta: number) {
		const index = Number.clamp(traceIndex + delta, {maximum: Number.max(0, traces.length - 1), minimum: 0})
		if (index === traceIndex) return
		Option.match(Option.all({operation: activeKey, trace: Array.get(traces, index)}), {
			onNone: () => undefined,
			onSome: selected => send({_tag: 'Pick', selection: {operation: selected.operation, traceId: selected.trace.id}})
		})
	}

	// J and K move the focused list's selection; Enter drills into it and Escape moves back one level.
	function move(delta: number) {
		if (pane === 'Operations') {
			moveOperation(delta)
			return
		}
		if (pane === 'Traces') {
			moveTrace(delta)
			return
		}
		if (delta > 0) spanNavigation.current.next()
		else spanNavigation.current.previous()
	}

	function openSelection() {
		if (pane === 'Operations') {
			Option.match(activeKey, {onNone: () => undefined, onSome: operation => send({_tag: 'Operation', operation})})
			return
		}
		if (pane === 'Traces') {
			Option.match(Option.all({operation: activeKey, trace: activeTrace}), {
				onNone: () => undefined,
				onSome: selected =>
					send({_tag: 'Trace', selection: {operation: selected.operation, traceId: selected.trace.id}})
			})
			return
		}
		spanNavigation.current.open()
	}

	const pickedSpan = Option.getOrUndefined(
		Option.flatMap(
			Option.filter(Option.fromUndefinedOr(navigation.selection), selected =>
				Option.exists(activeTrace, trace => selected.traceId === trace.id)
			),
			selected => Option.fromUndefinedOr(selected.spanId)
		)
	)
	const level = pipe(
		Match.value(pane),
		Match.when('Operations', () => 'operations'),
		Match.when('Traces', () => 'traces'),
		Match.orElse(() => 'spans')
	)

	const operationsPalette: PaletteGroup = {
		items: Option.match(value, {
			onNone: () => [],
			onSome: current =>
				Array.map(flatOperations(current), row => ({
					detail: `${row.operation.failures} failed · ${durationOf(row.operation.p50Ms)} typical`,
					icon: DEVICES[row.operation.runtime],
					id: `${row.app.name}:${row.operation.runtime}:${row.operation.name}`,
					keywords: `${row.app.name} ${row.operation.name} ${SIDES[row.operation.runtime]}`,
					label: `${row.app.name} · ${row.operation.name}`,
					run: () => selectOperation(row.app.name, row.operation)
				}))
		}),
		label: 'Operations'
	}
	const tracesPalette: PaletteGroup = {
		items: Option.match(activeOperation, {
			onNone: () => [],
			onSome: active =>
				Array.map(Array.take(active.operation.traces, 6), trace => ({
					detail: Option.match(Option.fromUndefinedOr(trace.failure), {
						onNone: () => 'ok',
						onSome: failure => `failed at ${failure.span}`
					}),
					icon: DEVICES[active.operation.runtime],
					id: trace.id,
					keywords: trace.id,
					label: `${ageOf(trace.time, now)} · ${durationOf(trace.durationMs)}`,
					run: () => selectTrace(trace)
				}))
		}),
		label: 'Traces'
	}
	const navigatePalette: PaletteGroup = {
		items: [
			{detail: level, hotkey: 'J', id: 'next-row', label: 'Next row', run: () => move(1)},
			{detail: level, hotkey: 'K', id: 'previous-row', label: 'Previous row', run: () => move(-1)},
			{detail: level, hotkey: 'Enter', id: 'open-selection', label: 'Open', run: openSelection},
			{detail: 'one level', hotkey: 'Escape', id: 'back', label: 'Back', run: () => send({_tag: 'Back'})}
		],
		label: 'Navigate'
	}
	const workspace = Boolean.match(isMobile, {
		onFalse: () =>
			Boolean.match(isWide, {
				onFalse: () => (
					<NarrowWorkspace
						active={Option.getOrUndefined(activeOperation)}
						activeKey={Option.getOrUndefined(activeKey)}
						activeTrace={Option.getOrUndefined(activeTrace)}
						now={now}
						onMoveSpan={moveSpan}
						onPickSpan={selectSpan}
						onSelectOperation={selectOperation}
						onSelectTrace={selectTrace}
						pickedSpan={pickedSpan}
						onRegisterSpanNavigation={registerSpanNavigation}
					/>
				),
				onTrue: () => (
					<WideWorkspace
						active={Option.getOrUndefined(activeOperation)}
						activeKey={Option.getOrUndefined(activeKey)}
						activeTrace={Option.getOrUndefined(activeTrace)}
						now={now}
						onMoveSpan={moveSpan}
						onPickSpan={selectSpan}
						onSelectOperation={selectOperation}
						onSelectTrace={selectTrace}
						pickedSpan={pickedSpan}
						onRegisterSpanNavigation={registerSpanNavigation}
					/>
				)
			}),
		onTrue: () => (
			<MobileWorkspace
				active={Option.getOrUndefined(activeOperation)}
				activeKey={Option.getOrUndefined(activeKey)}
				activeTrace={Option.getOrUndefined(activeTrace)}
				now={now}
				onMoveSpan={moveSpan}
				onPickSpan={selectSpan}
				onSelectOperation={selectOperation}
				onSelectTrace={selectTrace}
				pane={pane}
				pickedSpan={pickedSpan}
				onRegisterSpanNavigation={registerSpanNavigation}
			/>
		)
	})
	return (
		<div ref={root} className="flex min-h-0 flex-1 flex-col">
			<AppBar
				icon={icon}
				name="scope"
				title={Boolean.match(isMobile, {
					onFalse: () => undefined,
					onTrue: () =>
						pipe(
							Match.value(pane),
							Match.when('Operations', () => 'Operations'),
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
				palette={Boolean.match(Option.isSome(authFailure), {
					onFalse: () => [navigatePalette, tracesPalette, operationsPalette, otherApps('scope')],
					onTrue: () => [otherApps('scope')]
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
