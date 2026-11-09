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
	Predicate,
	Record,
	Schema,
	String,
	pipe
} from 'effect'

import {CaretRightIcon, GlobeIcon, HardDrivesIcon, DeviceMobileIcon, DesktopIcon} from '@phosphor-icons/react'
import {createFileRoute, getRouteApi} from '@tanstack/react-router'
import {AsyncResult} from 'effect/reactivity'
import {Suspense, useEffect, useRef} from 'react'
import type {ReactElement, ReactNode} from 'react'

import {AppBar} from '@deslop/components-web/app-bar'
import {otherApps} from '@deslop/components-web/command-palette'
import type {PaletteGroup} from '@deslop/components-web/command-palette'
import {EmptyState, Error, SignIn} from '@deslop/components-web/fallbacks'
import {Page, Section} from '@deslop/components-web/page'
import {Problem, problemSinceAtom} from '@deslop/components-web/problem'
import {StatusDot} from '@deslop/components-web/status-dot'
import {Badge} from '@deslop/components-web/ui/badge'
import {Button} from '@deslop/components-web/ui/button'
import {ResizableHandle, ResizablePanel, ResizablePanelGroup} from '@deslop/components-web/ui/resizable'
import {ScrollArea} from '@deslop/components-web/ui/scroll-area'
import {Skeleton} from '@deslop/components-web/ui/skeleton'
import {GithubDark} from '@deslop/components-web/ui/svgs/githubDark'
import {GithubLight} from '@deslop/components-web/ui/svgs/githubLight'
import {Tabs, TabsContent, TabsList, TabsTrigger} from '@deslop/components-web/ui/tabs'
import {cn, useMediaQuery} from '@deslop/components-web/utils'
import {isDenied, needsSignIn, signInUrl} from '@deslop/runtime/auth/utils'
import * as WebRuntime from '@deslop/runtime/web'

import {ageOf, durationOf, navigationOf, nextSearch, nowAtom, overviewAtom, Search, traceAtom} from '#lib/utils.ts'
import type {NavigationEvent, OperationKey} from '#lib/utils.ts'
import icon from '#routes/icon.svg'
import {appName} from '#services/telemetry/lib/utils.ts'
import type {Operation, OperationTrace, Overview, Runtime, Trace} from '#services/telemetry/schema.ts'

// The side an operation starts on, in words, so a search or a row can name it.
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

// The device an operation starts on, as Auth marks a sign-in's, in its side's hue: a browser, a phone, a server or CI.
const DEVICES: Record<Runtime, ReactElement> = {
	ci: <DesktopIcon role="img" alt="CI" aria-label="ci" data-side="ci" className="size-3.5 shrink-0 text-(--side)" />,
	mobile: (
		<DeviceMobileIcon
			role="img"
			alt="iOS"
			aria-label="iOS"
			data-side="mobile"
			className="size-3.5 shrink-0 text-(--side)"
		/>
	),
	server: (
		<HardDrivesIcon
			role="img"
			alt="Server"
			aria-label="server"
			data-side="server"
			className="size-3.5 shrink-0 text-(--side)"
		/>
	),
	unknown: <HardDrivesIcon aria-hidden data-side="unknown" className="size-3.5 shrink-0 text-(--side)" />,
	web: <GlobeIcon role="img" alt="Web" aria-label="web" data-side="web" className="size-3.5 shrink-0 text-(--side)" />
}

const clock = new Intl.DateTimeFormat(undefined, {
	hour: '2-digit',
	hourCycle: 'h23',
	minute: '2-digit',
	second: '2-digit'
})
const count = new Intl.NumberFormat(undefined, {maximumFractionDigits: 0})
const route = getRouteApi('/(home)/')

type Attributes = typeof Attributes.Type
const Attributes = Schema.Array(Schema.Struct({key: Schema.String, value: Schema.Json}))
type Wrapped = typeof Wrapped.Type
const Wrapped = Schema.Record(Schema.String, Schema.Json)

// Each Deslop app's mark, for the app a trace came from.
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
}

// A pane with nothing selected keeps its mark alone, never a sentence that repeats the pane's name.
function EmptyIcon() {
	return <img src={icon} alt="" className="pixelated size-8 opacity-50" />
}

function FailureContent(props: {error: unknown; reset: () => void}) {
	if (needsSignIn(props.error)) return <SignIn href={signInUrl(location.href)} />
	if (isDenied(props.error)) return <Error error={props.error} label="Access denied" reset={props.reset} />
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

// A failed span's own error message, which its details lead with.
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

// What a span says beyond its row: attributes, without anything that only repeats its name, such as code.function, or the status code the error line already carries.
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

type DetailLine = {failed: boolean; key: string; value: string}

// A key over its value so a long key or URL never truncates; short pairs share a row, so the inspector fills its width before it scrolls.
function DetailLines(props: {lines: readonly DetailLine[]}) {
	return (
		<dl className="grid-cols-attributes grid gap-x-6 pb-1 font-mono text-xs">
			{Array.map(props.lines, (line, index) => (
				<div
					key={`${line.key}:${index}`}
					className={cn(
						'flex min-w-0 flex-col gap-0.5 py-1',
						(line.key === 'error' || line.key === 'log' || String.length(line.value) > 48) && 'col-span-full'
					)}
				>
					<dt className={cn('text-muted-foreground wrap-anywhere', line.failed && 'text-destructive')}>{line.key}</dt>
					<dd
						className={cn('min-w-0 wrap-anywhere whitespace-pre-wrap select-text', line.failed && 'text-destructive')}
					>
						{Boolean.match(line.key === 'error', {
							onFalse: () =>
								Boolean.match(line.key === 'url.full' && String.startsWith('https://')(line.value), {
									onFalse: () => line.value,
									onTrue: () => (
										<a href={line.value} target="_blank" rel="noreferrer" className="text-primary">
											{line.value}
										</a>
									)
								}),
							onTrue: () => <ErrorText message={line.value} />
						})}
					</dd>
				</div>
			))}
		</dl>
	)
}

type DetailTab = {content: ReactNode; label: string; value: string}

// The picked span's error, attributes and logs as line views; the failure opens first because it is why the span was picked.
function SpanDetail(props: {span: Trace['spans'][number]}) {
	const error = errorOf(props.span)
	const attributes = attributesOf(props.span)
	const attributeTabs: readonly DetailTab[] = Boolean.match(Array.isReadonlyArrayNonEmpty(attributes), {
		onFalse: () => [],
		onTrue: () => [
			{
				content: (
					<DetailLines
						lines={Array.map(attributes, attribute => ({failed: false, key: attribute.key, value: attribute.value}))}
					/>
				),
				label: 'Span',
				value: 'span'
			}
		]
	})
	const errorTabs: readonly DetailTab[] = Option.match(error, {
		onNone: () => [],
		onSome: message => [
			{content: <DetailLines lines={[{failed: true, key: 'error', value: message}]} />, label: 'Error', value: 'error'}
		]
	})
	const logTabs: readonly DetailTab[] = Boolean.match(Array.isReadonlyArrayNonEmpty(props.span.logs), {
		onFalse: () => [],
		onTrue: () => [
			{
				content: (
					<DetailLines
						lines={Array.map(props.span.logs, log => ({failed: log.status === 2, key: 'log', value: log.name}))}
					/>
				),
				label: 'Logs',
				value: 'logs'
			}
		]
	})
	const tabs = [...attributeTabs, ...errorTabs, ...logTabs]
	const only = tabs[0]
	if (only === undefined) return <EmptyState label="Select a span" icon={<EmptyIcon />} />
	if (tabs.length === 1) {
		return (
			<ScrollArea className="h-full">
				<div className="p-3">{only.content}</div>
			</ScrollArea>
		)
	}
	return (
		<Tabs
			key={props.span.spanId}
			defaultValue={Option.match(error, {
				onNone: () =>
					Option.getOrElse(
						Option.map(Array.head(tabs), tab => tab.value),
						() => 'span'
					),
				onSome: () => 'error'
			})}
			className="min-h-0 flex-1"
		>
			<TabsList variant="line" className="w-full shrink-0 max-lg:group-data-horizontal/tabs:h-11">
				{Array.map(tabs, tab => (
					<TabsTrigger key={tab.value} value={tab.value}>
						{tab.label}
					</TabsTrigger>
				))}
			</TabsList>
			{Array.map(tabs, tab => (
				<TabsContent key={tab.value} value={tab.value} className="min-h-0 flex-1">
					<ScrollArea className="h-full">
						<div className="p-3">{tab.content}</div>
					</ScrollArea>
				</TabsContent>
			))}
		</Tabs>
	)
}

// One waterfall row: name, cross-app mark, side-coloured timing, duration and an inspector affordance.
function SpanLine(props: {mark: Option.Option<string>; open?: boolean; span: Trace['spans'][number]}) {
	return (
		<>
			<span
				className="flex w-40 min-w-0 shrink-0 items-center gap-1.5 pl-(--indent) text-left xl:w-80"
				style={{'--indent': `calc(var(--spacing) * 3 + ${Number.min(props.span.depth, 6) * 12}px)`}}
			>
				{Option.match(props.mark, {
					onNone: () => null,
					onSome: mark => <img src={mark} alt={appName(props.span.service)} className="pixelated size-3.5 shrink-0" />
				})}
				<span className="truncate font-mono" title={props.span.name}>
					{props.span.name}
				</span>
			</span>
			<span className="bg-secondary/50 relative mx-2 h-1.5 flex-1">
				<span
					data-side={props.span.runtime}
					className={cn(
						'absolute top-0 left-(--offset) h-1.5 w-(--length) min-w-0.5',
						Boolean.match(props.span.status === 2, {onFalse: () => 'bg-(--side)', onTrue: () => 'bg-destructive'})
					)}
					style={{
						'--length': `calc(${props.span.durationMs} / var(--trace-total) * 100%)`,
						'--offset': `calc(${props.span.offsetMs} / var(--trace-total) * 100%)`
					}}
				/>
				{/* The trace's head is the one live edge: cyan, and the only glow in the waterfall. */}
				{Boolean.match(props.span.depth === 0, {
					onFalse: () => null,
					onTrue: () => (
						<span
							aria-hidden="true"
							className="bg-primary live-glow absolute top-0 left-(--offset) h-1.5 w-0.5"
							style={{'--offset': `calc(${props.span.offsetMs} / var(--trace-total) * 100%)`}}
						/>
					)
				})}
			</span>
			<span className="text-muted-foreground w-14 shrink-0 text-right font-mono whitespace-nowrap tabular-nums">
				{durationOf(props.span.durationMs)}
			</span>
			{Option.match(Option.fromUndefinedOr(props.open), {
				onNone: () => <span className="size-3.5 shrink-0" />,
				onSome: open => (
					<CaretRightIcon className={cn('text-muted-foreground size-3.5 shrink-0', open && 'text-foreground')} />
				)
			})}
		</>
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

// The picked span when it has detail, else where the failure broke, else the root.
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

// Only a span with additional information opens the inspector.
function SpanRow(props: {
	focus?: string
	mark: (span: Trace['spans'][number]) => Option.Option<string>
	onPick: (id: string) => void
	span: Trace['spans'][number]
}) {
	const open = props.focus === props.span.spanId
	if (!hasDetail(props.span)) {
		return (
			<div className="mx-1 flex h-8 w-full items-center gap-1 rounded-lg px-3 text-xs max-sm:h-12 pointer-coarse:h-12">
				<SpanLine mark={props.mark(props.span)} span={props.span} />
			</div>
		)
	}
	return (
		<div data-selected={open} className="hover:bg-accent/40 mx-1 rounded-lg transition-colors">
			<Button
				size="xs"
				variant={Boolean.match(open, {onFalse: () => 'ghost' as const, onTrue: () => 'secondary' as const})}
				aria-current={Boolean.match(open, {onFalse: () => undefined, onTrue: () => 'true' as const})}
				onClick={() => props.onPick(props.span.spanId)}
				className="h-8 w-full max-sm:h-12 pointer-coarse:h-12"
			>
				<span className="flex w-full min-w-0 items-center gap-1 font-normal tracking-normal normal-case">
					<SpanLine mark={props.mark(props.span)} span={props.span} open={open} />
				</span>
			</Button>
		</div>
	)
}

// The waterfall in trace order, independently scrolling; its time scale is the trace's own duration.
function SpansList(props: {focus: Option.Option<Trace['spans'][number]>; onPick: (id: string) => void; trace: Trace}) {
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
			<div className="flex flex-col pb-2" style={{'--trace-total': `${Number.max(props.trace.durationMs, 1)}`}}>
				{Option.match(root, {
					onNone: () => null,
					onSome: span => <SpanRow focus={focusId} mark={mark} onPick={props.onPick} span={span} />
				})}
				{Array.map(below, span => (
					<SpanRow key={span.spanId} focus={focusId} mark={mark} onPick={props.onPick} span={span} />
				))}
			</div>
		</ScrollArea>
	)
}

// The picked span's inspector, or the mark alone when nothing has detail.
function SpanDetails(props: {focus: Option.Option<Trace['spans'][number]>}) {
	return Option.match(props.focus, {
		onNone: () => <EmptyState label="Select a span" icon={<EmptyIcon />} />,
		onSome: span => <SpanDetail key={span.spanId} span={span} />
	})
}

// One inspector: below the waterfall on a narrower desktop, beside it from 1600px, a separate phone screen.
function TraceLayout(props: {detailOnly?: boolean; details: ReactNode; problem?: ReactNode; spans: ReactNode}) {
	return (
		<div
			className={cn(
				'grid min-h-0 flex-1 gap-3',
				Boolean.match(props.detailOnly === true, {
					onFalse: () => 'grid-rows-2 max-lg:grid-rows-1',
					onTrue: () => 'grid-rows-1'
				})
			)}
		>
			<section
				aria-label="Spans"
				className={cn('glass flex min-h-0 min-w-0 flex-col rounded-2xl', props.detailOnly === true && 'max-lg:hidden')}
			>
				{props.spans}
				{props.problem !== undefined && <div className="flex shrink-0 justify-end px-3">{props.problem}</div>}
			</section>
			<section
				aria-label="Span details"
				className={cn(
					'glass flex min-h-0 min-w-0 flex-col rounded-2xl',
					Boolean.match(props.detailOnly === true, {onFalse: () => 'max-lg:hidden', onTrue: () => 'max-lg:border-t-0'})
				)}
			>
				{props.details}
			</section>
		</div>
	)
}

function TraceSpans(props: {
	detailOnly?: boolean
	onPick: (id: string) => void
	pickedSpan?: string
	problem: ReactNode
	trace: Trace
}) {
	const focus = focusOf(props.trace, props.pickedSpan)
	return (
		<TraceLayout
			detailOnly={props.detailOnly}
			problem={props.problem}
			spans={<SpansList focus={focus} onPick={props.onPick} trace={props.trace} />}
			details={<SpanDetails focus={focus} />}
		/>
	)
}

function TraceProblem(props: {id: string}) {
	const atom = traceAtom(props.id)
	const result = useAtomValue(atom)
	const refresh = useAtomRefresh(atom)
	const since = Option.getOrUndefined(useAtomValue(problemSinceAtom(atom)))
	if (!AsyncResult.isFailure(result) || Option.isNone(AsyncResult.value(result))) return null
	return <Problem label="Trace out of date" warning reset={refresh} since={since} />
}

// A failed refresh keeps the last trace, but authorization failures never expose retained spans.
function Spans(props: {detailOnly?: boolean; id: string; onPick: (id: string) => void; pickedSpan?: string}) {
	const atom = traceAtom(props.id)
	const result = useAtomSuspense(atom, {includeFailure: true})
	const refresh = useAtomRefresh(atom)
	const value = AsyncResult.value(result)
	if (AsyncResult.isFailure(result) && (Option.isNone(value) || Option.exists(AsyncResult.error(result), isDenied))) {
		if (props.detailOnly === true) {
			return (
				<TraceLayout
					detailOnly
					details={<FailureContent error={Cause.squash(result.cause)} reset={refresh} />}
					spans={null}
				/>
			)
		}
		return (
			<TraceLayout
				spans={<FailureContent error={Cause.squash(result.cause)} reset={refresh} />}
				details={<EmptyState label="Select a span" icon={<EmptyIcon />} />}
			/>
		)
	}
	return Option.match(value, {
		onNone: () => null,
		onSome: trace => (
			<TraceSpans
				detailOnly={props.detailOnly}
				onPick={props.onPick}
				pickedSpan={props.pickedSpan}
				problem={<TraceProblem id={props.id} />}
				trace={trace}
			/>
		)
	})
}

function SpansSkeleton() {
	return (
		<div aria-busy="true" role="status" aria-label="Spans" className="flex flex-col pb-2">
			{Array.map(Array.range(1, 4), row => (
				<div key={row} aria-hidden className="flex h-8 items-center gap-3 px-3 max-sm:h-12 pointer-coarse:h-12">
					<span className="w-40 shrink-0 pl-3 xl:w-80">
						<Skeleton className="h-3 w-28" />
					</span>
					<Skeleton className="h-1.5 flex-1" />
					<Skeleton className="h-3 w-14 shrink-0" />
					<span className="size-3.5 shrink-0" />
				</div>
			))}
		</div>
	)
}

function DetailsSkeleton() {
	return (
		<div aria-busy="true" role="status" aria-label="Span details" className="flex flex-col gap-3 p-3">
			{Array.map(Array.range(1, 4), row => (
				<div key={row} aria-hidden className="flex flex-col gap-1 py-1">
					<Skeleton className="h-3 w-24" />
					<Skeleton className="h-3 w-1/2" />
				</div>
			))}
		</div>
	)
}

function TraceLoading(props: {detailOnly?: boolean}) {
	return <TraceLayout detailOnly={props.detailOnly} spans={<SpansSkeleton />} details={<DetailsSkeleton />} />
}

// Suspend the rows, not their shell. Home owns failures; ordinary outages retain the last overview.
function OverviewContent(props: {children: (overview: Overview) => ReactNode}) {
	return Option.match(AsyncResult.value(useAtomSuspense(overviewAtom, {includeFailure: true})), {
		onNone: () => null,
		onSome: props.children
	})
}

function OperationsSkeleton() {
	return (
		<div aria-busy="true" role="status" aria-label="Operations" className="flex flex-col">
			<div aria-hidden className="flex h-9 items-center gap-2 border-b px-3">
				<Skeleton className="size-4" />
				<Skeleton className="h-3 w-24" />
			</div>
			{Array.map(Array.range(1, 8), row => (
				<div key={row} aria-hidden className="flex h-14 items-center gap-2 px-3 max-sm:h-12 pointer-coarse:h-12">
					<Skeleton className="size-3.5 shrink-0" />
					<Skeleton className="h-3.5 min-w-0 flex-1" />
					<Skeleton className="h-3 w-6 shrink-0" />
					<Skeleton className="hidden h-3 w-10 shrink-0 lg:block" />
					<Skeleton className="h-3 w-14 shrink-0" />
					<Skeleton className="size-3.5 shrink-0 lg:hidden" />
				</div>
			))}
		</div>
	)
}

function TracesSkeleton() {
	return (
		<div aria-busy="true" role="status" aria-label="Traces" className="flex flex-col">
			{Array.map(Array.range(1, 8), row => (
				<div key={row} aria-hidden className="flex h-14 items-center gap-3 px-3 max-sm:h-12 pointer-coarse:h-12">
					<Skeleton className="h-3 w-8 shrink-0" />
					<Skeleton className="h-3 min-w-0 flex-1" />
					<Skeleton className="size-1.5 shrink-0" />
					<Skeleton className="h-3 w-14 shrink-0" />
					<Skeleton className="size-3.5 shrink-0 lg:hidden" />
				</div>
			))}
		</div>
	)
}

// An app's mark: its own icon, GitHub's for CI, else a server glyph; never a letter tile.
function AppMark(props: {app: Overview['apps'][number]}) {
	return Option.match(Option.fromUndefinedOr(marks[props.app.name]), {
		onNone: () =>
			Boolean.match(
				Array.every(props.app.operations, operation => operation.runtime === 'ci'),
				{
					onFalse: () => <HardDrivesIcon className="text-muted-foreground size-4 shrink-0" />,
					onTrue: () => (
						<>
							<GithubLight className="size-4 shrink-0 dark:hidden" />
							<GithubDark className="hidden size-4 shrink-0 dark:block" />
						</>
					)
				}
			),
		onSome: mark => <img src={mark} alt="" className="pixelated size-4 shrink-0 opacity-80" />
	})
}

// An app's mark and name at the top of its operations, sticky so the group stays named while its rows scroll.
function AppHeading(props: {app: Overview['apps'][number]}) {
	return (
		<div className="bg-surface border-border sticky top-0 z-10 flex h-9 shrink-0 items-center gap-2 border-b px-3">
			<AppMark app={props.app} />
			<span className="tracking-label text-muted-foreground text-2xs min-w-0 truncate font-mono font-medium uppercase">
				{props.app.name}
			</span>
		</div>
	)
}

// One operation in the list: its device, name, failures, runs and typical duration; the row selects it.
function OperationRow(props: {active: boolean; onSelect: () => void; operation: Operation}) {
	return (
		<div role="listitem" className="hover:bg-accent/40 mx-1 rounded-lg transition-colors" data-selected={props.active}>
			<Button
				size="xs"
				variant={Boolean.match(props.active, {onFalse: () => 'ghost' as const, onTrue: () => 'secondary' as const})}
				className="h-14 w-full max-sm:h-12 pointer-coarse:h-12"
				aria-current={Boolean.match(props.active, {onFalse: () => undefined, onTrue: () => 'true' as const})}
				onClick={props.onSelect}
			>
				<span className="flex w-full min-w-0 items-center gap-2 font-normal tracking-normal normal-case">
					{DEVICES[props.operation.runtime]}
					<span className="min-w-0 flex-1 truncate text-left font-mono text-sm">{props.operation.name}</span>
					{props.operation.failures > 0 && (
						<span className="flex w-10 shrink-0 justify-end max-sm:w-8">
							<Badge variant="destructive" className="shrink-0" title={`${props.operation.failures} failed`}>
								<StatusDot status="error" />
								{props.operation.failures}
								<span className="sr-only"> failed</span>
							</Badge>
						</span>
					)}
					<span
						className="text-muted-foreground w-10 shrink-0 text-right font-mono text-xs whitespace-nowrap tabular-nums max-lg:hidden"
						title="Runs"
					>
						{count.format(props.operation.count)}×<span className="sr-only"> runs</span>
					</span>
					<span
						className="text-muted-foreground w-14 shrink-0 text-right font-mono text-xs whitespace-nowrap tabular-nums max-sm:w-12"
						title="Typical"
					>
						<span className="sr-only">typical </span>
						{durationOf(props.operation.p50Ms)}
					</span>
					<CaretRightIcon className="text-muted-foreground hidden size-3.5 shrink-0 sm:max-lg:block" />
				</span>
			</Button>
		</div>
	)
}

// The operations of every app, failures first, as the page's root list.
function OperationsPane(props: {
	activeKey?: OperationKey
	className?: string
	onSelect: (app: string, operation: Operation) => void
}) {
	const current = useAtomValue(overviewAtom)
	const refresh = useAtomRefresh(overviewAtom)
	const since = Option.getOrUndefined(useAtomValue(problemSinceAtom(overviewAtom)))
	return (
		<Section
			title="By app"
			headerClassName="px-3"
			meta={Option.match(AsyncResult.value(current), {
				onNone: () => undefined,
				onSome: overview => {
					const operations = Array.flatMap(overview.apps, app => app.operations)
					const total = Array.length(operations)
					const failing = Array.countBy(operations, operation => operation.failures > 0)
					return Array.join(
						[
							`${count.format(total)} ${Boolean.match(total === 1, {onFalse: () => 'operations', onTrue: () => 'operation'})}`,
							...Boolean.match(failing > 0, {onFalse: () => [], onTrue: () => [`${count.format(failing)} failing`]})
						],
						' · '
					)
				}
			})}
			actions={Boolean.match(AsyncResult.isFailure(current) && Option.isSome(AsyncResult.value(current)), {
				onFalse: () => undefined,
				onTrue: () => <Problem label="Operations out of date" warning reset={refresh} since={since} />
			})}
			className={cn('min-h-0 flex-1 gap-0', props.className)}
		>
			<Suspense fallback={<OperationsSkeleton />}>
				<OverviewContent>
					{overview =>
						Array.match(overview.apps, {
							onEmpty: () => <EmptyState label="No traces yet" icon={<EmptyIcon />} />,
							onNonEmpty: apps => (
								<ScrollArea className="min-h-0 flex-1">
									<div className="flex flex-col">
										{Array.map(apps, app => (
											<section key={app.name} aria-label={app.name}>
												<AppHeading app={app} />
												<div role="list">
													{Array.map(app.operations, operation => (
														<OperationRow
															key={`${operation.runtime} ${operation.name}`}
															active={
																props.activeKey !== undefined &&
																props.activeKey.app === app.name &&
																props.activeKey.runtime === operation.runtime &&
																props.activeKey.name === operation.name
															}
															onSelect={() => props.onSelect(app.name, operation)}
															operation={operation}
														/>
													))}
												</div>
											</section>
										))}
									</div>
								</ScrollArea>
							)
						})
					}
				</OverviewContent>
			</Suspense>
		</Section>
	)
}

// One trace of the operation: its age, short id, where it broke and its duration; the row selects it.
function TraceListRow(props: {active: boolean; now: number; onSelect: () => void; trace: OperationTrace}) {
	return (
		<div role="listitem" className="hover:bg-accent/40 mx-1 rounded-lg transition-colors" data-selected={props.active}>
			<Button
				size="xs"
				variant={Boolean.match(props.active, {onFalse: () => 'ghost' as const, onTrue: () => 'secondary' as const})}
				className="h-14 w-full max-sm:h-12 pointer-coarse:h-12"
				aria-current={Boolean.match(props.active, {onFalse: () => undefined, onTrue: () => 'true' as const})}
				onClick={props.onSelect}
			>
				<span className="flex w-full min-w-0 items-center gap-3 font-normal tracking-normal normal-case">
					<span
						className="text-muted-foreground w-10 shrink-0 font-mono text-xs whitespace-nowrap tabular-nums"
						title={Option.match(Number.parse(String.slice(0, -6)(props.trace.time)), {
							onNone: () => '—',
							onSome: timestamp => clock.format(timestamp)
						})}
					>
						{ageOf(props.trace.time, props.now)}
					</span>
					<span className="text-muted-foreground min-w-0 flex-1 truncate text-left font-mono text-xs">
						{String.slice(0, 8)(props.trace.id)}
					</span>
					<span className="flex w-4 shrink-0 justify-end">
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
					<span className="w-14 shrink-0 text-right font-mono whitespace-nowrap tabular-nums">
						{durationOf(props.trace.durationMs)}
					</span>
					<CaretRightIcon className="text-muted-foreground size-3.5 shrink-0 lg:hidden" />
				</span>
			</Button>
		</div>
	)
}

function TracesPane(props: {
	active?: ActiveOperation
	className?: string
	now: number
	onSelect: (trace: OperationTrace) => void
	selectedTrace?: OperationTrace
}) {
	const active = Option.fromUndefinedOr(props.active)
	return (
		<Section
			title="Traces"
			headerClassName="px-3"
			meta={Option.match(active, {
				onNone: () => undefined,
				onSome: current =>
					`${count.format(current.operation.traces.length)} ${Boolean.match(current.operation.traces.length === 1, {onFalse: () => 'traces', onTrue: () => 'trace'})}`
			})}
			actions={Option.match(active, {
				onNone: () => undefined,
				onSome: current => (
					<span className="flex min-w-0 items-center gap-2 max-lg:hidden">
						<AppMark app={current.app} />
						<span className="text-muted-foreground max-w-40 truncate font-mono text-xs" title={current.operation.name}>
							{current.operation.name}
						</span>
					</span>
				)
			})}
			className={cn('min-h-0 flex-1 gap-0', props.className)}
		>
			<Suspense fallback={<TracesSkeleton />}>
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
		</Section>
	)
}

// The picked trace's waterfall and the picked span's detail; its age, id and duration are already on its selected row.
function TracePane(props: {
	className?: string
	detailOnly?: boolean
	onPickSpan: (id: string) => void
	pickedSpan?: string
	trace?: OperationTrace
}) {
	const trace = Option.fromUndefinedOr(props.trace)
	return (
		<section aria-label="Trace" className={cn('flex min-h-0 flex-col overflow-hidden', props.className)}>
			<Suspense fallback={<TraceLoading detailOnly={props.detailOnly} />}>
				<OverviewContent>
					{() =>
						Option.match(trace, {
							onNone: () => (
								<TraceLayout
									detailOnly={props.detailOnly}
									spans={<EmptyState label="Select a trace" icon={<EmptyIcon />} />}
									details={<EmptyState label="Select a span" icon={<EmptyIcon />} />}
								/>
							),
							onSome: current => (
								<Suspense fallback={<TraceLoading detailOnly={props.detailOnly} />}>
									<Spans
										key={current.id}
										detailOnly={props.detailOnly}
										id={current.id}
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

// The 1600px workspace: the waterfall and the selected detail side by side, each scrolling on its own.
function WidePanels(props: {details: ReactNode; problem?: ReactNode; spans: ReactNode}) {
	return (
		<ResizablePanelGroup orientation="horizontal" className="min-h-0 flex-1">
			<ResizablePanel defaultSize="62" minSize="30">
				<section aria-label="Spans" className="glass flex h-full min-h-0 flex-col rounded-2xl">
					{props.spans}
					{props.problem !== undefined && <div className="flex shrink-0 justify-end px-3">{props.problem}</div>}
				</section>
			</ResizablePanel>
			<ResizableHandle />
			<ResizablePanel defaultSize="38" minSize="20">
				<section aria-label="Span details" className="glass flex h-full min-h-0 flex-col rounded-2xl">
					{props.details}
				</section>
			</ResizablePanel>
		</ResizablePanelGroup>
	)
}

function WideTraceLoading() {
	return <WidePanels details={<DetailsSkeleton />} spans={<SpansSkeleton />} />
}

function WideEmptyTrace() {
	return (
		<WidePanels
			details={<EmptyState label="Select a span" icon={<EmptyIcon />} />}
			spans={<EmptyState label="Select a trace" icon={<EmptyIcon />} />}
		/>
	)
}

// The wide trace boundary: a failed refresh keeps the last spans, while an authorization failure never shows them.
function WideSpans(props: {id: string; onPick: (id: string) => void; pickedSpan?: string}) {
	const atom = traceAtom(props.id)
	const result = useAtomSuspense(atom, {includeFailure: true})
	const refresh = useAtomRefresh(atom)
	const value = AsyncResult.value(result)
	if (AsyncResult.isFailure(result) && (Option.isNone(value) || Option.exists(AsyncResult.error(result), isDenied))) {
		return (
			<WidePanels
				details={<EmptyState label="Select a span" icon={<EmptyIcon />} />}
				spans={<FailureContent error={Cause.squash(result.cause)} reset={refresh} />}
			/>
		)
	}
	return Option.match(value, {
		onNone: () => <WideTraceLoading />,
		onSome: trace => {
			const focus = focusOf(trace, props.pickedSpan)
			return (
				<WidePanels
					details={<SpanDetails focus={focus} />}
					problem={<TraceProblem id={props.id} />}
					spans={<SpansList focus={focus} onPick={props.onPick} trace={trace} />}
				/>
			)
		}
	})
}

function WideTracePane(props: {onPickSpan: (id: string) => void; pickedSpan?: string; trace?: OperationTrace}) {
	const trace = Option.fromUndefinedOr(props.trace)
	return (
		<section aria-label="Trace" className="flex h-full min-h-0 flex-col overflow-hidden">
			<Suspense fallback={<WideTraceLoading />}>
				<OverviewContent>
					{() =>
						Option.match(trace, {
							onNone: () => <WideEmptyTrace />,
							onSome: current => (
								<Suspense fallback={<WideTraceLoading />}>
									<WideSpans key={current.id} id={current.id} onPick={props.onPickSpan} pickedSpan={props.pickedSpan} />
								</Suspense>
							)
						})
					}
				</OverviewContent>
			</Suspense>
		</section>
	)
}

// From 1024px to 1599px: operations and traces beside the waterfall, with the inspector below it.
function NarrowWorkspace(props: WorkspaceProps) {
	return (
		<div className="grid-cols-scope grid min-h-0 flex-1 gap-3">
			<div className="grid min-h-0 grid-rows-2 gap-3">
				<OperationsPane activeKey={props.activeKey} onSelect={props.onSelectOperation} />
				<TracesPane
					active={props.active}
					now={props.now}
					onSelect={props.onSelectTrace}
					selectedTrace={props.activeTrace}
				/>
			</div>
			<TracePane onPickSpan={props.onPickSpan} pickedSpan={props.pickedSpan} trace={props.activeTrace} />
		</div>
	)
}

// From 1600px: operations and traces, the waterfall, then the selected detail at full height, all resizable.
function WideWorkspace(props: WorkspaceProps) {
	return (
		<ResizablePanelGroup orientation="horizontal" className="min-h-0 flex-1">
			<ResizablePanel defaultSize={320} minSize={240} maxSize={420}>
				<div className="grid h-full min-h-0 grid-rows-2">
					<OperationsPane activeKey={props.activeKey} onSelect={props.onSelectOperation} />
					<TracesPane
						active={props.active}
						now={props.now}
						onSelect={props.onSelectTrace}
						selectedTrace={props.activeTrace}
					/>
				</div>
			</ResizablePanel>
			<ResizableHandle />
			<ResizablePanel minSize="40">
				<WideTracePane onPickSpan={props.onPickSpan} pickedSpan={props.pickedSpan} trace={props.activeTrace} />
			</ResizablePanel>
		</ResizablePanelGroup>
	)
}

// On a phone the URL's pane fills the screen; Back moves up one level and keeps the selection.
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
						onPickSpan={props.onPickSpan}
						pickedSpan={props.pickedSpan}
						trace={props.activeTrace}
					/>
				))
			)}
		</div>
	)
}

// The operation the key names, with the app that owns it.
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
		<Page width="full" className="h-full min-h-0">
			<h1 className="sr-only">Scope</h1>
			<div className="flex min-h-0 flex-1 flex-col">{children}</div>
		</Page>
	)
}

function Home() {
	// Below desktop width, the same selection navigates one screen at a time; from 1600px the detail stands beside the waterfall.
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
			Match.when('Trace', () => 'section[aria-label="Spans"] button[aria-current="true"]'),
			Match.when('Traces', () => 'section[aria-label="Traces"] button[aria-current="true"]'),
			Match.orElse(() => 'section[aria-label="By app"] button[aria-current="true"]')
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
	const selection = navigation.selection?.operation
	const overview = useAtomValue(overviewAtom)
	useAtomValue(problemSinceAtom(overviewAtom))
	const refresh = useAtomRefresh(overviewAtom)
	const value = AsyncResult.value(overview)
	const authFailure = Option.filter(AsyncResult.error(overview), isDenied)
	const blockingFailure = Option.filter(AsyncResult.cause(overview), () => Option.isNone(value))
	const now = AsyncResult.getOrElse(useAtomValue(nowAtom), () => DateTime.toEpochMillis(DateTime.nowUnsafe()))

	const activeOperation = Option.orElse(
		Option.flatMap(Option.fromUndefinedOr(selection), key =>
			Option.flatMap(value, current => findOperation(current, key))
		),
		() =>
			Option.flatMap(value, current =>
				Option.flatMap(
					Option.flatMap(Array.head(current.apps), app =>
						Option.map(
							Array.head(app.operations),
							operation => ({app: app.name, name: operation.name, runtime: operation.runtime}) as const
						)
					),
					key => findOperation(current, key)
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

	const operations: PaletteGroup = {
		items: Option.match(value, {
			onNone: () => [],
			onSome: current =>
				Array.flatMap(current.apps, app =>
					Array.map(app.operations, operation => ({
						detail: `${operation.failures} failed · ${durationOf(operation.p50Ms)} typical`,
						icon: DEVICES[operation.runtime],
						id: `${app.name}:${operation.runtime}:${operation.name}`,
						keywords: `${app.name} ${operation.name} ${SIDES[operation.runtime]}`,
						label: `${app.name} · ${operation.name}`,
						run: () => selectOperation(app.name, operation)
					}))
				)
		}),
		label: 'Operations'
	}
	const traces: PaletteGroup = {
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
				palette={Boolean.match(Option.isSome(authFailure), {
					onFalse: () => [traces, operations, otherApps('scope')],
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
