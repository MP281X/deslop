import {useAtom, useAtomRefresh, useAtomSuspense, useAtomValue} from '@effect/atom-react'

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

import {
	CheckIcon,
	CaretRightIcon,
	CopyIcon,
	GlobeIcon,
	HardDrivesIcon,
	DeviceMobileIcon,
	DesktopIcon
} from '@phosphor-icons/react'
import {createFileRoute} from '@tanstack/react-router'
import {AsyncResult} from 'effect/reactivity'
import {Suspense, useState, useSyncExternalStore} from 'react'
import type {ReactElement, ReactNode} from 'react'

import {AppBar} from '@deslop/components-web/app-bar'
import {otherApps} from '@deslop/components-web/command-palette'
import type {PaletteGroup} from '@deslop/components-web/command-palette'
import {Error, SignIn} from '@deslop/components-web/fallbacks'
import {Problem} from '@deslop/components-web/problem'
import {Badge} from '@deslop/components-web/ui/badge'
import {Button} from '@deslop/components-web/ui/button'
import {Collapsible, CollapsibleContent, CollapsibleTrigger} from '@deslop/components-web/ui/collapsible'
import {Empty, EmptyHeader, EmptyTitle} from '@deslop/components-web/ui/empty'
import {Skeleton} from '@deslop/components-web/ui/skeleton'
import {GithubDark} from '@deslop/components-web/ui/svgs/githubDark'
import {GithubLight} from '@deslop/components-web/ui/svgs/githubLight'
import {cn} from '@deslop/components-web/utils'
import {isDenied, needsSignIn, signInUrl} from '@deslop/runtime/auth/utils'
import * as WebRuntime from '@deslop/runtime/web'

import {ageOf, arrivalsAtom, copyAtom, durationOf, nowAtom, overviewAtom, traceAtom} from '#lib/utils.ts'
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
	ci: <DesktopIcon role="img" aria-label="ci" data-side="ci" className="size-3.5 shrink-0 text-(--side)" />,
	mobile: (
		<DeviceMobileIcon role="img" aria-label="iOS" data-side="mobile" className="size-3.5 shrink-0 text-(--side)" />
	),
	server: (
		<HardDrivesIcon role="img" aria-label="server" data-side="server" className="size-3.5 shrink-0 text-(--side)" />
	),
	unknown: <HardDrivesIcon aria-hidden data-side="unknown" className="size-3.5 shrink-0 text-(--side)" />,
	web: <GlobeIcon role="img" aria-label="web" data-side="web" className="size-3.5 shrink-0 text-(--side)" />
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

type Pane = 'operations' | 'trace' | 'traces'
type OperationKey = {app: string; name: string; runtime: Runtime}
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

// Where a span's name starts: past the trace rows' age column, one step further per level.
function indentOf(span: Trace['spans'][number]) {
	return `calc(var(--spacing) * 6 + ${Number.max(0, span.depth - 1) * 12}px)`
}

// The picked span's error, attributes and logs, each key over its value so a long key or URL never truncates.
function SpanDetail(props: {span: Trace['spans'][number]}) {
	return (
		<dl className="flex flex-col pb-1 font-mono text-xs">
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
						className="flex flex-col gap-0.5 py-1 pr-1 pl-(--indent)"
						style={{'--indent': indentOf(props.span)}}
					>
						<dt className={cn('text-muted-foreground', line.failed && 'text-destructive')}>{line.key}</dt>
						<dd className={cn('min-w-0 break-words select-text', line.failed && 'text-destructive')}>
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

// A span on the trace rows' columns: its name, another app's mark where it entered one, its bar in its side's hue on the trace's time scale, its duration and, when it opens, a chevron.
function SpanLine(props: {mark: Option.Option<string>; open?: boolean; span: Trace['spans'][number]}) {
	return (
		<>
			<span
				className="flex w-40 shrink-0 items-center gap-1.5 pl-(--indent) text-left"
				style={{'--indent': indentOf(props.span)}}
			>
				{Option.match(props.mark, {
					onNone: () => null,
					onSome: mark => <img src={mark} alt={appName(props.span.service)} className="pixelated size-3.5 shrink-0" />
				})}
				<span className="truncate font-mono">{props.span.name}</span>
			</span>
			<span className="bg-muted/60 relative h-1.5 flex-1 rounded-full">
				<span
					data-side={props.span.runtime}
					className={cn(
						'absolute top-0 left-(--offset) h-1.5 w-(--length) min-w-0.5 rounded-full',
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
					<CaretRightIcon
						className={cn('text-muted-foreground size-3.5 shrink-0 transition-transform', open && 'rotate-90')}
					/>
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

// One span row: a plain line when it has nothing more to show, an accordion with its attributes and logs when it has.
function SpanRow(props: {
	focus?: string
	mark: (span: Trace['spans'][number]) => Option.Option<string>
	onPick: (id: string) => void
	span: Trace['spans'][number]
}) {
	const open = props.focus === props.span.spanId
	if (!hasDetail(props.span)) {
		return (
			<div className="flex h-8 w-full items-center gap-3 pr-1 text-xs max-sm:h-11">
				<SpanLine mark={props.mark(props.span)} span={props.span} />
			</div>
		)
	}
	return (
		<Collapsible
			open={open}
			onOpenChange={value => props.onPick(Boolean.match(value, {onFalse: () => '', onTrue: () => props.span.spanId}))}
			className="data-open:bg-muted/60"
		>
			<CollapsibleTrigger className="hover:bg-muted/50 flex h-8 w-full cursor-pointer items-center gap-3 pr-1 text-left text-xs max-sm:h-11">
				<SpanLine mark={props.mark(props.span)} span={props.span} open={open} />
			</CollapsibleTrigger>
			<CollapsibleContent>
				<SpanDetail span={props.span} />
			</CollapsibleContent>
		</Collapsible>
	)
}

function TraceSpans(props: {trace: Trace}) {
	const [picked, setPicked] = useState<string>()
	const trace = props.trace
	const root = Array.findFirst(trace.spans, span => span.depth === 0)
	const below = Array.filter(trace.spans, span => !Option.exists(root, top => top.spanId === span.spanId))
	const services = Record.fromEntries(Array.map(trace.spans, span => [span.spanId, span.service] as const))
	function mark(span: Trace['spans'][number]) {
		const parent =
			services[span.parentSpanId] ?? Option.match(root, {onNone: () => span.service, onSome: top => top.service})
		return Option.filter(
			Option.fromUndefinedOr(marks[appName(span.service)]),
			() => appName(span.service) !== appName(parent)
		)
	}
	const focus = Option.filter(
		Boolean.match(picked === undefined, {
			onFalse: () => Array.findFirst(trace.spans, span => span.spanId === picked),
			onTrue: () =>
				pipe(
					brokeAt(trace.spans),
					Option.orElse(() => root)
				)
		}),
		hasDetail
	)
	const focusId = Option.getOrUndefined(Option.map(focus, span => span.spanId))
	return (
		<div className="flex flex-col pb-2" style={{'--trace-total': `${Number.max(trace.durationMs, 1)}`}}>
			{Option.match(root, {
				onNone: () => null,
				onSome: span => <SpanRow focus={focusId} mark={mark} onPick={id => setPicked(id)} span={span} />
			})}
			{Array.map(below, span => (
				<SpanRow key={span.spanId} focus={focusId} mark={mark} onPick={id => setPicked(id)} span={span} />
			))}
		</div>
	)
}

// A failed refresh keeps the last trace, but authorization failures never expose retained spans.
function Spans(props: {id: string}) {
	const atom = traceAtom(props.id)
	const result = useAtomSuspense(atom, {includeFailure: true})
	const refresh = useAtomRefresh(atom)
	const value = AsyncResult.value(result)
	if (AsyncResult.isFailure(result) && (Option.isNone(value) || Option.exists(AsyncResult.error(result), isDenied))) {
		return <FailureContent error={Cause.squash(result.cause)} reset={refresh} />
	}
	return (
		<>
			{AsyncResult.isFailure(result) && (
				<div className="flex shrink-0 justify-end px-3">
					<Problem label="Trace out of date" warning reset={refresh} />
				</div>
			)}
			{Option.match(value, {onNone: () => null, onSome: trace => <TraceSpans trace={trace} />})}
		</>
	)
}

function SpansSkeleton() {
	return (
		<div aria-busy="true" role="status" aria-label="Spans" className="flex flex-col pb-2">
			{Array.map(Array.range(1, 4), row => (
				<div key={row} aria-hidden className="flex h-8 items-center gap-3 pr-1 max-sm:h-11">
					<span className="w-40 shrink-0 pl-6">
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

// Suspend the rows, not their shell. Home owns failures; ordinary outages retain the last overview.
function OverviewContent(props: {children: (overview: Overview) => ReactNode}) {
	return Option.match(AsyncResult.value(useAtomSuspense(overviewAtom, {includeFailure: true})), {
		onNone: () => null,
		onSome: props.children
	})
}

function OverviewRowsSkeleton(props: {label: string; appHeading?: boolean}) {
	return (
		<div aria-busy="true" role="status" aria-label={props.label}>
			{props.appHeading === true && (
				<div aria-hidden className="flex h-8 items-center gap-2 border-b px-2.5">
					<Skeleton className="size-5" />
					<Skeleton className="h-3 w-24" />
				</div>
			)}
			{Array.map(Array.range(1, 8), row => (
				<div key={row} aria-hidden className="border-b">
					<div className="flex h-8 items-center gap-2 px-2.5 max-sm:h-11">
						<Skeleton className="size-3.5 shrink-0" />
						<Skeleton className="h-3 w-1/3" />
						<Skeleton className="ml-auto h-3 w-12" />
					</div>
				</div>
			))}
		</div>
	)
}

// An app's mark, name and newest release at the top of its operations.
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
				onSome: mark => <img src={mark} alt="" className="pixelated size-5" />
			})}
			<span className="min-w-0 truncate text-xs font-semibold">{props.app.name}</span>
		</div>
	)
}

// One operation in the list: its device, name, failures, runs and typical duration; the row selects it.
function OperationRow(props: {active: boolean; onSelect: () => void; operation: Operation}) {
	return (
		<div role="listitem" className="border-b">
			<Button
				size="lg"
				variant={Boolean.match(props.active, {onFalse: () => 'ghost' as const, onTrue: () => 'secondary' as const})}
				className="w-full justify-start text-left max-sm:h-11"
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
	return (
		<section
			aria-label="Operations"
			className={cn('pb-safe-bottom flex min-h-0 flex-col overflow-y-auto', props.className)}
		>
			<header className="bg-background sticky top-0 z-30 flex h-8 shrink-0 items-center gap-1 border-b px-2.5 max-sm:h-11">
				<span className="text-sm font-semibold">Operations</span>
				{AsyncResult.isFailure(current) && Option.isSome(AsyncResult.value(current)) && (
					<Problem className="ml-auto" label="Operations out of date" warning reset={refresh} />
				)}
			</header>
			<Suspense fallback={<OverviewRowsSkeleton appHeading label="Operations" />}>
				<OverviewContent>
					{overview =>
						Array.match(overview.apps, {
							onEmpty: () => (
								<Empty>
									<EmptyHeader>
										<EmptyTitle>No traces yet</EmptyTitle>
									</EmptyHeader>
								</Empty>
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

// Where it broke: the failing span's name, or its status when that span is the operation itself.
function failureLabel(failure: NonNullable<OperationTrace['failure']>, operation: string) {
	if (failure.span !== operation) return failure.span
	return Option.match(String.match(/StatusCode error \((\d{3})/u)(failure.message), {
		onNone: () => 'Failed',
		onSome: parts =>
			Option.match(Option.fromUndefinedOr(parts[1]), {
				onNone: () => 'Failed',
				onSome: code => String.trim(`${code} ${Option.getOrElse(Record.get(STATUS, code), () => '')}`)
			})
	})
}

// One trace of the operation: its age, where it broke and its duration; the row selects it.
function TraceListRow(props: {
	arrived: boolean
	active: boolean
	now: number
	onSelect: () => void
	operation: string
	trace: OperationTrace
}) {
	return (
		<div
			role="listitem"
			className={cn(
				props.arrived &&
					'grid-rows-single animate-grow-in grid motion-reduce:animate-none [&>*]:min-h-0 [&>*]:overflow-clip'
			)}
		>
			<div className="border-b">
				<Button
					size="lg"
					variant={Boolean.match(props.active, {onFalse: () => 'ghost' as const, onTrue: () => 'secondary' as const})}
					className="w-full justify-start text-left max-sm:h-11"
					aria-current={Boolean.match(props.active, {onFalse: () => undefined, onTrue: () => 'true' as const})}
					onClick={props.onSelect}
				>
					<span className="text-muted-foreground w-8 shrink-0 font-mono text-xs">
						{ageOf(props.trace.time, props.now)}
					</span>
					<span className="text-muted-foreground min-w-0 flex-1 truncate font-mono text-xs">
						{String.slice(0, 8)(props.trace.id)}
					</span>
					<span className="flex w-32 shrink-0 justify-end">
						{props.trace.failure !== undefined && (
							<Badge
								variant="destructive"
								className="max-w-32 shrink-0 font-mono"
								title={`Failed at ${props.trace.failure.span}: ${props.trace.failure.message}`}
							>
								<span className="truncate">{failureLabel(props.trace.failure, props.operation)}</span>
							</Badge>
						)}
					</span>
					<span className="w-14 shrink-0 text-right font-mono whitespace-nowrap tabular-nums">
						{durationOf(props.trace.durationMs)}
					</span>
					<CaretRightIcon className="text-muted-foreground size-3.5 shrink-0 xl:hidden" />
				</Button>
			</div>
		</div>
	)
}

function TracesPane(props: {
	active?: ActiveOperation
	arrived: readonly string[]
	className?: string
	now: number
	onSelect: (trace: OperationTrace) => void
	pending: boolean
	selectedTrace?: OperationTrace
}) {
	const active = Option.fromUndefinedOr(props.active)
	return (
		<section
			aria-label="Traces"
			className={cn('pb-safe-bottom flex min-h-0 flex-col overflow-y-auto', props.className)}
		>
			<header className="bg-background sticky top-0 z-20 flex h-8 shrink-0 items-center gap-2 border-b px-2.5">
				{Option.match(
					Option.flatMap(active, current => Option.fromUndefinedOr(marks[current.app.name])),
					{
						onNone: () => <HardDrivesIcon className="text-muted-foreground size-4 shrink-0" />,
						onSome: mark => <img src={mark} alt="" className="pixelated size-4 shrink-0" />
					}
				)}
				<span className="min-w-0 flex-1 truncate text-sm font-semibold max-xl:hidden">
					{Option.match(active, {onNone: () => 'Traces', onSome: current => current.operation.name})}
				</span>
				<span className="flex shrink-0 items-center gap-2 max-sm:ml-auto">
					{Option.getOrUndefined(
						Option.map(
							Option.filter(active, current => current.operation.failures > 0),
							current => (
								<Badge variant="destructive" className="shrink-0 font-mono" title="Failed">
									{current.operation.failures}
									<span className="sr-only"> failed</span>
								</Badge>
							)
						)
					)}
					<span className="text-muted-foreground shrink-0 font-mono text-xs whitespace-nowrap">
						{Option.match(active, {
							onNone: () => props.pending && <Skeleton className="h-3 w-20" />,
							onSome: current => `${durationOf(current.operation.p50Ms)} typical`
						})}
					</span>
				</span>
			</header>
			<div className="bg-background text-muted-foreground sticky top-8 z-10 flex h-8 shrink-0 items-center gap-1 border-b px-2.5 text-xs">
				<span className="w-8">Age</span>
				<span className="min-w-0 flex-1">Trace</span>
				<span className="w-32 text-right">Failure</span>
				<span className="w-14 text-right">Duration</span>
				<span className="size-3.5 xl:hidden" />
			</div>
			<Suspense fallback={<OverviewRowsSkeleton label="Traces" />}>
				<OverviewContent>
					{() =>
						Option.match(active, {
							onNone: () => (
								<Empty>
									<EmptyHeader>
										<EmptyTitle>Select an operation</EmptyTitle>
									</EmptyHeader>
								</Empty>
							),
							onSome: current => (
								<div role="list">
									{Array.map(current.operation.traces, trace => (
										<TraceListRow
											key={trace.id}
											active={props.selectedTrace?.id === trace.id}
											arrived={Array.contains(props.arrived, trace.id)}
											now={props.now}
											onSelect={() => props.onSelect(trace)}
											operation={current.operation.name}
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

// The trace's full id copies from its short form, the button confirming in place.
function CopyTrace(props: {id: string}) {
	const [copy, copyText] = useAtom(copyAtom)
	const copied = AsyncResult.isWaiting(copy)
	return (
		<>
			<Button
				variant="ghost"
				size="icon"
				className="max-sm:size-11"
				aria-label={Boolean.match(copied, {onFalse: () => 'Copy trace ID', onTrue: () => 'Copied'})}
				onClick={() => copyText(props.id)}
			>
				{Boolean.match(copied, {onFalse: () => <CopyIcon />, onTrue: () => <CheckIcon className="text-primary" />})}
			</Button>
			<span role="status" className="sr-only">
				{copied && 'Copied'}
			</span>
		</>
	)
}

// The picked trace: its age, failure and duration, then its spans and the picked span's detail.
function TracePane(props: {className?: string; now: number; pending: boolean; trace?: OperationTrace}) {
	const trace = Option.fromUndefinedOr(props.trace)
	return (
		<section aria-label="Trace" className={cn('pb-safe-bottom flex min-h-0 flex-col overflow-y-auto', props.className)}>
			<header className="bg-background sticky top-0 z-20 flex h-8 shrink-0 items-center gap-2 border-b px-3 max-sm:h-11">
				<span
					className="text-muted-foreground w-14 shrink-0 font-mono text-xs"
					title={Option.getOrUndefined(
						Option.map(trace, current =>
							clock.format(Option.getOrElse(Number.parse(String.slice(0, -6)(current.time)), () => props.now))
						)
					)}
				>
					{Option.match(trace, {
						onNone: () =>
							Boolean.match(props.pending, {onFalse: () => 'Trace', onTrue: () => <Skeleton className="h-3 w-10" />}),
						onSome: current =>
							Boolean.match(ageOf(current.time, props.now) === 'now', {
								onFalse: () => `${ageOf(current.time, props.now)} ago`,
								onTrue: () => 'now'
							})
					})}
				</span>
				<span className="min-w-0 flex-1 truncate font-mono text-xs" title={props.trace?.id}>
					{Option.match(trace, {
						onNone: () => props.pending && <Skeleton className="h-3 w-16" />,
						onSome: current => String.slice(0, 8)(current.id)
					})}
				</span>
				{Option.match(trace, {
					onNone: () => (
						<span className="flex size-7 shrink-0 items-center justify-center max-sm:size-11">
							{props.pending && <Skeleton className="size-4" />}
						</span>
					),
					onSome: current => <CopyTrace id={current.id} />
				})}
				<span className="shrink-0 font-mono text-xs whitespace-nowrap tabular-nums">
					{Option.match(trace, {
						onNone: () => props.pending && <Skeleton className="h-3 w-12" />,
						onSome: current => durationOf(current.durationMs)
					})}
				</span>
			</header>
			<div className="bg-background text-muted-foreground sticky top-8 z-10 flex h-8 shrink-0 items-center gap-3 border-b pr-4 pl-3 text-xs max-sm:top-11">
				<span className="w-40 pl-6">Span</span>
				<span className="min-w-0 flex-1">Timeline</span>
				<span className="w-14 text-right">Duration</span>
				<span className="size-3.5" />
			</div>
			<Suspense
				fallback={
					<div className="min-w-0 px-3">
						<SpansSkeleton />
					</div>
				}
			>
				<OverviewContent>
					{() =>
						Option.match(trace, {
							onNone: () => (
								<Empty>
									<EmptyHeader>
										<EmptyTitle>Select a trace</EmptyTitle>
									</EmptyHeader>
								</Empty>
							),
							onSome: current => (
								<div className="min-w-0 px-3">
									<Suspense fallback={<SpansSkeleton />}>
										<Spans key={current.id} id={current.id} />
									</Suspense>
								</div>
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
	// Three panes need readable trace and failure columns, not merely a non-phone viewport.
	const isMobile = useSyncExternalStore(
		onChange => {
			const query = window.matchMedia(COMPACT_LAYOUT)
			query.addEventListener('change', onChange)
			return () => query.removeEventListener('change', onChange)
		},
		() => window.matchMedia(COMPACT_LAYOUT).matches,
		() => false
	)
	const [pane, setPane] = useState<Pane>('operations')
	const [selection, setSelection] = useState<OperationKey>()
	const [selectedTrace, setSelectedTrace] = useState<OperationTrace>()
	const overview = useAtomValue(overviewAtom)
	const refresh = useAtomRefresh(overviewAtom)
	const value = AsyncResult.value(overview)
	const authFailure = Option.filter(AsyncResult.error(overview), isDenied)
	const now = AsyncResult.getOrElse(useAtomValue(nowAtom), () => DateTime.toEpochMillis(DateTime.nowUnsafe()))
	const arrived = useAtomValue(arrivalsAtom).arrived

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
			Option.flatMap(Option.fromUndefinedOr(selectedTrace), selected =>
				Array.findFirst(active.operation.traces, trace => trace.id === selected.id)
			),
			() => Array.head(active.operation.traces)
		)
	)

	function selectOperation(app: string, operation: Operation) {
		setSelection({app, name: operation.name, runtime: operation.runtime})
		setSelectedTrace(Option.getOrUndefined(Array.head(operation.traces)))
		setPane('traces')
	}

	function selectTrace(trace: OperationTrace) {
		setSelectedTrace(trace)
		setPane('trace')
	}

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
		<div className="flex min-h-0 flex-1 flex-col">
			<AppBar
				icon={icon}
				name="scope"
				title={Boolean.match(isMobile, {
					onFalse: () => undefined,
					onTrue: () =>
						pipe(
							Match.value(pane),
							Match.when('operations', () => 'scope'),
							Match.when('traces', () =>
								Option.match(activeOperation, {onNone: () => 'Traces', onSome: active => active.operation.name})
							),
							Match.orElse(() => 'Trace')
						)
				})}
				back={Boolean.match(isMobile && pane !== 'operations', {
					onFalse: () => undefined,
					onTrue: () => ({
						label: Boolean.match(pane === 'trace', {onFalse: () => 'Operations', onTrue: () => 'Traces'}),
						onClick: () =>
							setPane(
								Boolean.match(pane === 'trace', {onFalse: () => 'operations' as const, onTrue: () => 'traces' as const})
							)
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
												<OperationsPane
													activeKey={Option.getOrUndefined(activeKey)}
													className="min-w-0 border-r"
													onSelect={selectOperation}
												/>
												<TracesPane
													active={Option.getOrUndefined(activeOperation)}
													arrived={arrived}
													className="min-w-0 border-r"
													now={now}
													onSelect={selectTrace}
													pending={Option.isNone(value)}
													selectedTrace={Option.getOrUndefined(activeTrace)}
												/>
												<TracePane
													className="min-w-0"
													now={now}
													pending={Option.isNone(value)}
													trace={Option.getOrUndefined(activeTrace)}
												/>
											</div>
										),
										onTrue: () => (
											<>
												{pipe(
													Match.value(pane),
													Match.when('operations', () => (
														<OperationsPane
															activeKey={Option.getOrUndefined(activeKey)}
															className="min-h-0 flex-1"
															onSelect={selectOperation}
														/>
													)),
													Match.when('traces', () => (
														<TracesPane
															active={Option.getOrUndefined(activeOperation)}
															arrived={arrived}
															className="min-h-0 flex-1"
															now={now}
															onSelect={selectTrace}
															pending={Option.isNone(value)}
															selectedTrace={Option.getOrUndefined(activeTrace)}
														/>
													)),
													Match.orElse(() => (
														<TracePane
															className="min-h-0 flex-1"
															now={now}
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
