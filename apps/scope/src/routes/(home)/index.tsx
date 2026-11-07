import {useAtomRefresh, useAtomSet, useAtomSuspense, useAtomValue} from '@effect/atom-react'

import {
	Array,
	Boolean,
	Cause,
	DateTime,
	Formatter,
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
import {createFileRoute} from '@tanstack/react-router'
import {AsyncResult} from 'effect/reactivity'
import {Suspense, useEffect, useRef, useSyncExternalStore} from 'react'
import type {ReactElement, ReactNode} from 'react'

import {AppBar} from '@deslop/components-web/app-bar'
import {otherApps} from '@deslop/components-web/command-palette'
import type {PaletteGroup} from '@deslop/components-web/command-palette'
import {EmptyState, Error, SignIn} from '@deslop/components-web/fallbacks'
import {ItemListSkeleton} from '@deslop/components-web/item-list'
import {Problem, problemSinceAtom} from '@deslop/components-web/problem'
import {StatusDot} from '@deslop/components-web/status-dot'
import {Badge} from '@deslop/components-web/ui/badge'
import {Button} from '@deslop/components-web/ui/button'
import {Skeleton} from '@deslop/components-web/ui/skeleton'
import {GithubDark} from '@deslop/components-web/ui/svgs/githubDark'
import {GithubLight} from '@deslop/components-web/ui/svgs/githubLight'
import {cn} from '@deslop/components-web/utils'
import {isDenied, needsSignIn, signInUrl} from '@deslop/runtime/auth/utils'
import * as WebRuntime from '@deslop/runtime/web'

import {ageOf, durationOf, navigationAtom, nowAtom, overviewAtom, traceAtom} from '#lib/utils.ts'
import type {OperationKey} from '#lib/utils.ts'
import icon from '#routes/icon.svg'
import {appName} from '#services/telemetry/lib/utils.ts'
import type {Operation, OperationTrace, Overview, Runtime, Trace} from '#services/telemetry/schema.ts'

// The side an operation starts on, in words, so a search or a row can name it.
const SIDES: Record<Runtime, string> = {ci: 'ci', mobile: 'iOS', server: 'server', unknown: '', web: 'web'}

const COMPACT_LAYOUT = '(width < 80rem)'

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

type Attributes = typeof Attributes.Type
const Attributes = Schema.Array(Schema.Struct({key: Schema.String, value: Schema.Json}))
type Wrapped = typeof Wrapped.Type
const Wrapped = Schema.Record(Schema.String, Schema.Json)

// Each Deslop app's mark, for the app a trace came from.
const marks = WebRuntime.appIcons(
	import.meta.glob<string>('../../../../*/src/routes/icon.svg', {eager: true, import: 'default', query: '?url'})
)

type ActiveOperation = {app: Overview['apps'][number]; operation: Operation}

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
	const failed = Option.isSome(errorOf(span))
	const attributes = Array.map(
		Array.filter(
			Option.getOrElse(Schema.decodeUnknownOption(Attributes)(span.payload['attributes']), () => []),
			attribute => attribute.key !== 'service.name'
		),
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

// The picked span's error, attributes and logs, each key over its value so a long key or URL never truncates; short pairs share a row, so the inspector fills its width before it scrolls.
function SpanDetail(props: {span: Trace['spans'][number]}) {
	return (
		<dl className="grid-cols-attributes grid gap-x-6 pb-1 font-mono text-xs">
			{Array.map(
				[
					...Option.match(errorOf(props.span), {
						onNone: () => [],
						onSome: message => [{failed: true, key: 'error', value: message}]
					}),
					...Array.map(attributesOf(props.span), attribute => ({...attribute, failed: false})),
					...Array.map(props.span.logs, log => ({failed: log.status === 2, key: 'log', value: log.name}))
				],
				(line, index) => (
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
				)
			)}
		</dl>
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
			<span className="bg-muted/60 relative h-1.5 flex-1 rounded">
				<span
					data-side={props.span.runtime}
					className={cn(
						'absolute top-0 left-(--offset) h-1.5 w-(--length) min-w-0.5 rounded',
						Boolean.match(props.span.status === 2, {onFalse: () => 'bg-(--side)', onTrue: () => 'bg-destructive'})
					)}
					style={{
						'--length': `calc(${props.span.durationMs} / var(--trace-total) * 100%)`,
						'--offset': `calc(${props.span.offsetMs} / var(--trace-total) * 100%)`
					}}
				/>
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
	const parents = Array.map(failed, span =>
		Option.getOrElse(Option.filter(Option.fromNullishOr(span.payload['parentSpanId']), String.isString), () => '')
	)
	return Array.findFirst(failed, span => !Array.some(parents, parent => String.toLowerCase(parent) === span.spanId))
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
			<div className="list-row flex h-8 w-full items-center gap-3 px-3 text-xs max-sm:h-11">
				<SpanLine mark={props.mark(props.span)} span={props.span} />
			</div>
		)
	}
	return (
		<div data-selected={open} className="list-row">
			<Button
				variant="ghost"
				aria-current={Boolean.match(open, {onFalse: () => undefined, onTrue: () => 'true' as const})}
				onClick={() => props.onPick(props.span.spanId)}
				className="aria-current:bg-accent aria-current:hover:bg-accent flex h-8 w-full items-center gap-3 px-3 py-0 text-left text-xs max-sm:h-11"
			>
				<SpanLine mark={props.mark(props.span)} span={props.span} open={open} />
			</Button>
		</div>
	)
}

// One inspector: beside the waterfall from a large desktop up, below it on a smaller one, where its divider meets the list's; a separate phone screen.
function TraceLayout(props: {detailOnly?: boolean; details: ReactNode; problem?: ReactNode; spans: ReactNode}) {
	return (
		<div className="inspection:grid-cols-trace inspection:grid-rows-1 grid min-h-0 flex-1 grid-rows-2 max-xl:grid-rows-1">
			<section
				aria-label="Spans"
				className={cn('flex min-h-0 min-w-0 flex-col overflow-y-auto', props.detailOnly === true && 'max-xl:hidden')}
			>
				{props.spans}
				{props.problem !== undefined && (
					<div className="bg-background sticky bottom-0 mt-auto flex shrink-0 justify-end px-3">{props.problem}</div>
				)}
			</section>
			<section
				aria-label="Span details"
				className={cn(
					'inspection:border-t-0 inspection:border-l flex min-h-0 min-w-0 flex-col overflow-y-auto border-t p-3 max-xl:border-t-0',
					props.detailOnly !== true && 'max-xl:hidden'
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
	const focus = Option.orElse(
		Array.findFirst(props.trace.spans, span => span.spanId === props.pickedSpan && hasDetail(span)),
		() =>
			pipe(
				brokeAt(props.trace.spans),
				Option.orElse(() => root),
				Option.filter(hasDetail),
				Option.orElse(() => Array.findFirst(props.trace.spans, hasDetail))
			)
	)
	const focusId = Option.getOrUndefined(Option.map(focus, span => span.spanId))
	return (
		<TraceLayout
			detailOnly={props.detailOnly}
			problem={props.problem}
			details={Option.match(focus, {
				onNone: () => (
					<EmptyState label="Select a span" icon={<img src={icon} alt="" className="pixelated size-8 opacity-50" />} />
				),
				onSome: span => <SpanDetail span={span} />
			})}
			spans={Boolean.match(Array.isReadonlyArrayNonEmpty(props.trace.spans), {
				onFalse: () => (
					<EmptyState label="No spans" icon={<img src={icon} alt="" className="pixelated size-8 opacity-50" />} />
				),
				onTrue: () => (
					<div className="flex flex-col pb-2" style={{'--trace-total': `${Number.max(props.trace.durationMs, 1)}`}}>
						{Option.match(root, {
							onNone: () => null,
							onSome: span => <SpanRow focus={focusId} mark={mark} onPick={props.onPick} span={span} />
						})}
						{Array.map(below, span => (
							<SpanRow key={span.spanId} focus={focusId} mark={mark} onPick={props.onPick} span={span} />
						))}
					</div>
				)
			})}
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
				details={
					<EmptyState label="Select a span" icon={<img src={icon} alt="" className="pixelated size-8 opacity-50" />} />
				}
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
				<div key={row} aria-hidden className="flex h-8 items-center gap-3 px-3 max-sm:h-11">
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

function TraceLoading(props: {detailOnly?: boolean}) {
	return (
		<TraceLayout
			detailOnly={props.detailOnly}
			spans={<SpansSkeleton />}
			details={
				<div role="status" aria-label="Span details" aria-busy="true" className="flex flex-col gap-3">
					{Array.map(Array.range(1, 4), row => (
						<div key={row} aria-hidden className="flex flex-col gap-1 py-1">
							<Skeleton className="h-3 w-24" />
							<Skeleton className="h-3 w-1/2" />
						</div>
					))}
				</div>
			}
		/>
	)
}

// Suspend the rows, not their shell. Home owns failures; ordinary outages retain the last overview.
function OverviewContent(props: {children: (overview: Overview) => ReactNode}) {
	return Option.match(AsyncResult.value(useAtomSuspense(overviewAtom, {includeFailure: true})), {
		onNone: () => null,
		onSome: props.children
	})
}

function OverviewRowsSkeleton(props: {label: string; appHeading?: boolean}) {
	return (
		<>
			{props.appHeading === true && (
				<div aria-hidden className="flex h-8 items-center gap-2 border-b px-2.5">
					<Skeleton className="size-5" />
					<Skeleton className="h-3 w-24" />
				</div>
			)}
			<ItemListSkeleton
				label={props.label}
				media
				mediaClassName="size-3.5"
				rowClassName="gap-1 border border-transparent px-2.5"
				rows={8}
			/>
		</>
	)
}

// An app's mark and name at the top of its operations.
function AppHeading(props: {app: Overview['apps'][number]}) {
	return (
		<div className="bg-background sticky top-8 z-20 flex h-8 shrink-0 items-center gap-2 border-b px-2.5 max-sm:top-11">
			{Option.match(Option.fromUndefinedOr(marks[props.app.name]), {
				onNone: () =>
					Boolean.match(
						Array.every(props.app.operations, operation => operation.runtime === 'ci'),
						{
							onFalse: () => <HardDrivesIcon className="text-muted-foreground size-4" />,
							onTrue: () => (
								<>
									<GithubLight className="size-4 dark:hidden" />
									<GithubDark className="hidden size-4 dark:block" />
								</>
							)
						}
					),
				onSome: mark => <img src={mark} alt="" className="pixelated size-5 opacity-60" />
			})}
			<span className="text-muted-foreground min-w-0 truncate text-xs font-medium">{props.app.name}</span>
		</div>
	)
}

// One operation in the list: its device, name, failures, runs and typical duration; the row selects it.
function OperationRow(props: {active: boolean; onSelect: () => void; operation: Operation}) {
	return (
		<div role="listitem" className="list-row" data-selected={props.active}>
			<Button
				size="lg"
				variant="ghost"
				className="aria-current:bg-accent aria-current:hover:bg-accent w-full justify-start text-left max-sm:h-11"
				aria-current={Boolean.match(props.active, {onFalse: () => undefined, onTrue: () => 'true' as const})}
				onClick={props.onSelect}
			>
				{DEVICES[props.operation.runtime]}
				<span className="min-w-0 flex-1 truncate font-mono">{props.operation.name}</span>
				<span className="flex w-8 shrink-0 justify-end">
					{props.operation.failures > 0 && (
						<Badge variant="destructive" className="shrink-0 font-mono" title="Failed">
							{props.operation.failures}
							<span className="sr-only"> failed</span>
						</Badge>
					)}
				</span>
				<span
					className="text-muted-foreground w-10 shrink-0 text-right font-mono text-xs whitespace-nowrap tabular-nums max-lg:hidden"
					title="Runs"
				>
					{count.format(props.operation.count)}×<span className="sr-only"> runs</span>
				</span>
				<span
					className="text-muted-foreground w-12 shrink-0 text-right font-mono text-xs whitespace-nowrap tabular-nums"
					title="Typical"
				>
					<span className="sr-only">typical </span>
					{durationOf(props.operation.p50Ms)}
				</span>
				<CaretRightIcon className="text-muted-foreground size-3.5 shrink-0 xl:hidden" />
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
		<section
			aria-label="Operations"
			className={cn('pb-safe-bottom flex min-h-0 flex-col overflow-y-auto', props.className)}
		>
			<header className="bg-background sticky top-0 z-30 flex h-8 shrink-0 items-center gap-1 border-b px-2.5 max-sm:h-11">
				<span className="text-muted-foreground text-sm font-medium">Operations</span>
				{AsyncResult.isFailure(current) && Option.isSome(AsyncResult.value(current)) && (
					<Problem className="ml-auto" label="Operations out of date" warning reset={refresh} since={since} />
				)}
			</header>
			<Suspense fallback={<OverviewRowsSkeleton appHeading label="Operations" />}>
				<OverviewContent>
					{overview =>
						Array.match(overview.apps, {
							onEmpty: () => (
								<EmptyState
									label="No traces yet"
									icon={<img src={icon} alt="" className="pixelated size-8 opacity-50" />}
								/>
							),
							onNonEmpty: apps => (
								<>
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
								</>
							)
						})
					}
				</OverviewContent>
			</Suspense>
		</section>
	)
}

// One trace of the operation: its age, where it broke and its duration; the row selects it.
function TraceListRow(props: {active: boolean; now: number; onSelect: () => void; trace: OperationTrace}) {
	return (
		<div role="listitem" className="list-row" data-selected={props.active}>
			<Button
				size="lg"
				variant="ghost"
				className="aria-current:bg-accent aria-current:hover:bg-accent w-full justify-start text-left max-sm:h-11"
				aria-current={Boolean.match(props.active, {onFalse: () => undefined, onTrue: () => 'true' as const})}
				onClick={props.onSelect}
			>
				<span
					className="text-muted-foreground w-10 shrink-0 font-mono text-xs whitespace-nowrap tabular-nums"
					title={clock.format(Option.getOrElse(Number.parse(String.slice(0, -6)(props.trace.time)), () => props.now))}
				>
					{ageOf(props.trace.time, props.now)}
				</span>
				<span className="text-muted-foreground min-w-20 flex-1 truncate font-mono text-xs">
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
				<CaretRightIcon className="text-muted-foreground size-3.5 shrink-0 xl:hidden" />
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
		<section
			aria-label="Traces"
			className={cn('pb-safe-bottom flex min-h-0 flex-col overflow-y-auto', props.className)}
		>
			<header className="bg-background sticky top-0 z-20 flex h-8 shrink-0 items-center gap-2 border-b px-2.5 max-xl:hidden">
				{Option.match(
					Option.flatMap(active, current => Option.fromUndefinedOr(marks[current.app.name])),
					{
						onNone: () => <HardDrivesIcon className="text-muted-foreground size-4 shrink-0" />,
						onSome: mark => <img src={mark} alt="" className="pixelated size-4 shrink-0" />
					}
				)}
				<span className="text-muted-foreground min-w-0 flex-1 truncate text-sm font-medium">
					{Option.match(active, {onNone: () => 'Traces', onSome: current => current.operation.name})}
				</span>
			</header>
			<Suspense fallback={<OverviewRowsSkeleton label="Traces" />}>
				<OverviewContent>
					{() =>
						Option.match(active, {
							onNone: () => (
								<EmptyState
									label="Select an operation"
									icon={<img src={icon} alt="" className="pixelated size-8 opacity-50" />}
								/>
							),
							onSome: current => (
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
							)
						})
					}
				</OverviewContent>
			</Suspense>
		</section>
	)
}

// The picked trace's spans and the picked span's detail; its age, id and duration are already on its selected row.
function TracePane(props: {
	className?: string
	detailOnly?: boolean
	now: number
	onPickSpan: (id: string) => void
	pending: boolean
	pickedSpan?: string
	trace?: OperationTrace
}) {
	const trace = Option.fromUndefinedOr(props.trace)
	return (
		<section aria-label="Trace" className={cn('pb-safe-bottom flex min-h-0 flex-col overflow-hidden', props.className)}>
			<Suspense fallback={<TraceLoading detailOnly={props.detailOnly} />}>
				<OverviewContent>
					{() =>
						Option.match(trace, {
							onNone: () => (
								<TraceLayout
									detailOnly={props.detailOnly}
									spans={
										<EmptyState
											label="Select a trace"
											icon={<img src={icon} alt="" className="pixelated size-8 opacity-50" />}
										/>
									}
									details={
										<EmptyState
											label="Select a span"
											icon={<img src={icon} alt="" className="pixelated size-8 opacity-50" />}
										/>
									}
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

function Home() {
	// Below desktop width, the same selection navigates one screen at a time.
	const isMobile = useSyncExternalStore(
		onChange => {
			const query = window.matchMedia(COMPACT_LAYOUT)
			query.addEventListener('change', onChange)
			return () => query.removeEventListener('change', onChange)
		},
		() => window.matchMedia(COMPACT_LAYOUT).matches,
		() => false
	)
	const navigation = useAtomValue(navigationAtom)
	const send = useAtomSet(navigationAtom)
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
	const selection = navigation.selection?.operation
	const overview = useAtomValue(overviewAtom)
	useAtomValue(problemSinceAtom(overviewAtom))
	const refresh = useAtomRefresh(overviewAtom)
	const value = AsyncResult.value(overview)
	const authFailure = Option.filter(AsyncResult.error(overview), isDenied)
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
							Match.when('Operations', () => 'scope'),
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
					Option.match(
						Option.filter(AsyncResult.cause(overview), () => Option.isNone(value)),
						{
							onNone: () => (
								<div className="flex min-h-0 flex-1">
									{Boolean.match(isMobile, {
										onFalse: () => (
											<div className="grid-cols-scope grid min-h-0 flex-1">
												<div className="grid min-h-0 grid-rows-2 border-r">
													<OperationsPane
														activeKey={Option.getOrUndefined(activeKey)}
														className="min-w-0"
														onSelect={selectOperation}
													/>
													<TracesPane
														active={Option.getOrUndefined(activeOperation)}
														className="min-w-0 border-t"
														now={now}
														onSelect={selectTrace}
														selectedTrace={Option.getOrUndefined(activeTrace)}
													/>
												</div>
												<TracePane
													className="min-w-0"
													now={now}
													onPickSpan={selectSpan}
													pickedSpan={pickedSpan}
													pending={Option.isNone(value)}
													trace={Option.getOrUndefined(activeTrace)}
												/>
											</div>
										),
										onTrue: () => (
											<>
												{pipe(
													Match.value(pane),
													Match.when('Operations', () => (
														<OperationsPane
															activeKey={Option.getOrUndefined(activeKey)}
															className="min-h-0 flex-1"
															onSelect={selectOperation}
														/>
													)),
													Match.when('Traces', () => (
														<TracesPane
															active={Option.getOrUndefined(activeOperation)}
															className="min-h-0 flex-1"
															now={now}
															onSelect={selectTrace}
															selectedTrace={Option.getOrUndefined(activeTrace)}
														/>
													)),
													Match.orElse(() => (
														<TracePane
															className="min-h-0 flex-1"
															detailOnly={pane === 'Span'}
															now={now}
															onPickSpan={selectSpan}
															pickedSpan={pickedSpan}
															pending={Option.isNone(value)}
															trace={Option.getOrUndefined(activeTrace)}
														/>
													))
												)}
											</>
										)
									})}
								</div>
							),
							onSome: cause => <FailureContent error={Cause.squash(cause)} reset={refresh} />
						}
					),
				onSome: error => <FailureContent error={error} reset={refresh} />
			})}
		</div>
	)
}

export const Route = createFileRoute('/(home)/')({component: Home})
