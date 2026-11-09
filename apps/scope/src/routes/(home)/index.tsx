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

import {DeviceMobileIcon, FlowArrowIcon, GlobeIcon, HardDrivesIcon} from '@phosphor-icons/react'
import {createFileRoute, getRouteApi} from '@tanstack/react-router'
import {AsyncResult} from 'effect/reactivity'
import {Suspense, useEffect, useRef} from 'react'
import type {ReactElement, ReactNode} from 'react'

import {AppBar} from '@deslop/components-web/app-bar'
import {Denied, EmptyState, Error, SignIn} from '@deslop/components-web/fallbacks'
import {ItemListHeading, ItemListSkeleton} from '@deslop/components-web/item-list'
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
type OperationGroup = {app: Overview['apps'][number]; calls: number; operations: Operation[]}

type WorkspaceProps = {
	active?: ActiveOperation
	activeKey?: OperationKey
	activeTrace?: OperationTrace
	now: number
	onPickSpan: (id: string) => void
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

// An app's mark: its own icon, GitHub's for CI, else a server glyph; never a letter tile. A heading names the app, so the mark is decorative.
function AppMark(props: {app: Overview['apps'][number]}) {
	return Option.match(Option.fromUndefinedOr(marks[props.app.name]), {
		onNone: () =>
			Boolean.match(
				Array.every(props.app.operations, operation => operation.runtime === 'ci'),
				{
					onFalse: () => <HardDrivesIcon aria-hidden className="text-muted-foreground size-4 shrink-0" />,
					onTrue: () => (
						<>
							<GithubLight aria-hidden className="size-4 shrink-0 dark:hidden" />
							<GithubDark aria-hidden className="hidden size-4 shrink-0 dark:block" />
						</>
					)
				}
			),
		onSome: mark => <img src={mark} alt="" className="pixelated size-4 shrink-0" />
	})
}

// The apps as groups: any app with a failure leads, then the busiest; inside a group failing operations lead, then the busiest.
function groupedOperations(overview: Overview) {
	const groups: OperationGroup[] = Array.map(overview.apps, app => ({
		app,
		calls: Array.reduce(app.operations, 0, (total, operation) => total + operation.count),
		operations: Array.sort(
			app.operations,
			Order.combine(
				Order.mapInput(Order.flip(Order.Boolean), (operation: Operation) => operation.failures > 0),
				Order.mapInput(Order.flip(Order.Number), (operation: Operation) => operation.count)
			)
		)
	}))
	return Array.sort(
		groups,
		Order.combine(
			Order.mapInput(Order.flip(Order.Boolean), (group: OperationGroup) =>
				Array.some(group.operations, operation => operation.failures > 0)
			),
			Order.mapInput(Order.flip(Order.Number), (group: OperationGroup) => group.calls)
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

// One operation in its app's group: the side it starts on, its name, then errors, runs and typical duration.
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
				<ItemMedia>{DEVICES[props.operation.runtime]}</ItemMedia>
				<ItemContent>
					<ItemTitle className="w-full" title={props.operation.name}>
						{props.operation.name}
					</ItemTitle>
				</ItemContent>
				<ItemActions>
					<span className="grid-cols-operation grid items-center gap-x-2">
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

// The operations under a heading per app; the first heading is the pane's 32px band, so rows line up across panes.
function OperationsPane(props: {
	activeKey?: OperationKey
	className?: string
	onSelect: (app: string, operation: Operation) => void
}) {
	return (
		<section aria-label="Operations" className={cn('flex h-full min-h-0 flex-col overflow-hidden', props.className)}>
			<Suspense
				fallback={
					<>
						<ItemListHeading>{null}</ItemListHeading>
						<ItemListSkeleton label="Operations" media rows={8} />
					</>
				}
			>
				<OverviewContent>
					{overview =>
						Array.match(groupedOperations(overview), {
							onEmpty: () => (
								<>
									<ItemListHeading>{null}</ItemListHeading>
									<EmptyState label="No traces yet" icon={<EmptyIcon />} />
								</>
							),
							onNonEmpty: groups => (
								<ScrollArea className="min-h-0 flex-1">
									{Array.map(groups, group => (
										<div key={group.app.name}>
											<ItemListHeading icon={<AppMark app={group.app} />}>{group.app.name}</ItemListHeading>
											<div role="list">
												{Array.map(group.operations, operation => (
													<OperationRow
														key={`${group.app.name} ${operation.runtime} ${operation.name}`}
														active={
															props.activeKey !== undefined &&
															props.activeKey.app === group.app.name &&
															props.activeKey.runtime === operation.runtime &&
															props.activeKey.name === operation.name
														}
														app={group.app}
														onSelect={() => props.onSelect(group.app.name, operation)}
														operation={operation}
													/>
												))}
											</div>
										</div>
									))}
								</ScrollArea>
							)
						})
					}
				</OverviewContent>
			</Suspense>
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
			<ItemListHeading
				icon={Option.match(active, {onNone: () => undefined, onSome: current => <AppMark app={current.app} />})}
			>
				{Option.match(active, {onNone: () => null, onSome: current => current.operation.name})}
			</ItemListHeading>
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
							<ItemMedia className="w-36 sm:w-50">
								<span className="text-muted-foreground w-full truncate">error</span>
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
					<ItemListHeading>
						{Option.match(trace, {
							onNone: () => null,
							onSome: current => `${String.slice(0, 8)(current.id)} · ${ageOf(current.time, props.now)}`
						})}
					</ItemListHeading>
				),
				onTrue: () => null
			})}
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
	const navigation = navigationOf(route.useSearch())
	const navigate = route.useNavigate()
	function send(event: NavigationEvent) {
		navigate({search: previous => nextSearch(previous, event)})
	}
	const pane = navigation.path
	const root = useRef<HTMLDivElement>(null)
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
			Option.flatMap(value, current =>
				Option.flatMap(Array.head(groupedOperations(current)), group =>
					Option.map(Array.head(group.operations), operation => ({app: group.app, operation}))
				)
			)
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
				controls={<StaleMark trace={Option.getOrUndefined(activeTrace)} />}
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
