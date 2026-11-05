import {useAtom, useAtomSuspense, useAtomValue} from '@effect/atom-react'

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

import {createFileRoute} from '@tanstack/react-router'
import {AsyncResult} from 'effect/reactivity'
import {Check, ChevronRight, Copy, Globe, Server, Smartphone, Workflow} from 'lucide-react'
import {Suspense, useState} from 'react'
import type {ReactElement} from 'react'

import {AppBar} from '@deslop/components-web/app-bar'
import type {PaletteGroup} from '@deslop/components-web/command-palette'
import {Error, SignIn} from '@deslop/components-web/fallbacks'
import {ItemListSkeleton} from '@deslop/components-web/item-list'
import {Badge} from '@deslop/components-web/ui/badge'
import {Button} from '@deslop/components-web/ui/button'
import {Collapsible, CollapsibleContent, CollapsibleTrigger} from '@deslop/components-web/ui/collapsible'
import {Empty, EmptyHeader, EmptyTitle} from '@deslop/components-web/ui/empty'
import {useIsMobile} from '@deslop/components-web/ui/hooks/use-mobile'
import {Skeleton} from '@deslop/components-web/ui/skeleton'
import {GithubDark} from '@deslop/components-web/ui/svgs/githubDark'
import {GithubLight} from '@deslop/components-web/ui/svgs/githubLight'
import {cn} from '@deslop/components-web/utils'
import {AuthError} from '@deslop/runtime/auth/schema'
import {needsSignIn, signInUrl} from '@deslop/runtime/auth/utils'
import * as WebRuntime from '@deslop/runtime/web'

import {ageOf, arrivalsAtom, copyAtom, durationOf, nowAtom, overviewAtom, traceAtom} from '#lib/utils.ts'
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
	ci: <Workflow role="img" aria-label="ci" data-side="ci" className="size-3.5 shrink-0 text-(--side)" />,
	mobile: <Smartphone role="img" aria-label="iOS" data-side="mobile" className="size-3.5 shrink-0 text-(--side)" />,
	server: <Server role="img" aria-label="server" data-side="server" className="size-3.5 shrink-0 text-(--side)" />,
	unknown: <Server aria-hidden data-side="unknown" className="size-3.5 shrink-0 text-(--side)" />,
	web: <Globe role="img" aria-label="web" data-side="web" className="size-3.5 shrink-0 text-(--side)" />
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

// A failure the page can't show as data: sign-in, then anything else as an error with a reload.
function Failure(props: {cause: Cause.Cause<unknown>}) {
	return Option.match(Cause.findErrorOption(props.cause), {
		onNone: () => <Error error={Cause.squash(props.cause)} reset={() => location.reload()} />,
		onSome: error =>
			Boolean.match(needsSignIn(error), {
				onFalse: () => <Error error={error} reset={() => location.reload()} />,
				onTrue: () => <SignIn href={signInUrl(location.href)} />
			})
	})
}

function FailureContent(props: {error: unknown}) {
	if (needsSignIn(props.error)) return <SignIn href={signInUrl(location.href)} />
	return <Error error={props.error} reset={() => location.reload()} />
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
					<a href={url} target="_blank" rel="noreferrer" className="underline underline-offset-2">
						{String.replace(/^https?:\/\//u, '')(url)}
					</a>
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
				<span className="truncate">{props.span.name}</span>
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
					<ChevronRight
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
			<div className="flex h-8 w-full items-center gap-3 pr-1 text-xs">
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
			<CollapsibleTrigger className="hover:bg-muted/50 flex h-8 w-full cursor-pointer items-center gap-3 pr-1 text-left text-xs">
				<SpanLine mark={props.mark(props.span)} span={props.span} open={open} />
			</CollapsibleTrigger>
			<CollapsibleContent>
				<SpanDetail span={props.span} />
			</CollapsibleContent>
		</Collapsible>
	)
}

// A trace's spans under its root, each on the trace's time scale; where it broke starts picked, else the root's own details show.
function Spans(props: {id: string; size: number}) {
	const result = useAtomSuspense(traceAtom(`${props.id}:${props.size}`), {includeFailure: true})
	const [picked, setPicked] = useState<string>()
	if (AsyncResult.isFailure(result)) return <Failure cause={result.cause} />
	const trace = result.value
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

function SpansSkeleton() {
	return (
		<div aria-busy="true" role="status" aria-label="Spans" className="flex flex-col gap-2 py-2 pr-1 pl-10">
			{Array.map(Array.range(1, 4), row => (
				<div key={row} className="flex items-center gap-3">
					<Skeleton className="h-4 w-32" />
					<Skeleton className="h-2 flex-1" />
				</div>
			))}
		</div>
	)
}

// A pane's header and rows while the overview loads, so the shell keeps its three columns.
function PaneSkeleton(props: {className?: string; label: string; rows: number}) {
	return (
		<section
			aria-busy="true"
			role="status"
			aria-label={props.label}
			className={cn('flex min-h-0 flex-col', props.className)}
		>
			<header className="bg-background flex h-8 shrink-0 items-center gap-2 border-b px-3">
				<Skeleton className="h-4 w-24" />
			</header>
			<div className="p-2">
				<ItemListSkeleton label={props.label} media rows={props.rows} />
			</div>
		</section>
	)
}

function TraceSkeleton(props: {className?: string}) {
	return (
		<section aria-busy="true" role="status" aria-label="Trace" className={cn('flex min-h-0 flex-col', props.className)}>
			<header className="bg-background flex h-8 shrink-0 items-center gap-2 border-b px-3">
				<Skeleton className="h-4 w-32" />
			</header>
			<SpansSkeleton />
		</section>
	)
}

function ScopeSkeleton(props: {isMobile: boolean}) {
	if (props.isMobile) return <PaneSkeleton className="min-h-0 flex-1" label="Operations" rows={8} />
	return (
		<div className="grid-cols-scope grid min-h-0 flex-1">
			<PaneSkeleton className="min-w-0 border-r" label="Operations" rows={8} />
			<PaneSkeleton className="min-w-0 border-r" label="Traces" rows={6} />
			<TraceSkeleton className="min-w-0" />
		</div>
	)
}

// An app's mark, name and newest release at the top of its operations.
function AppHeading(props: {app: Overview['apps'][number]}) {
	return (
		<div className="bg-background sticky top-8 z-20 flex h-8 shrink-0 items-center gap-2 border-b px-2">
			{Option.match(Option.fromUndefinedOr(marks[props.app.name]), {
				onNone: () =>
					Boolean.match(
						Array.every(props.app.operations, operation => operation.runtime === 'ci'),
						{
							onFalse: () => <Server className="text-muted-foreground size-4" />,
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
			{Option.match(Array.head(props.app.versions), {
				onNone: () => null,
				onSome: newest => (
					<span
						className="text-muted-foreground shrink-0 font-mono text-xs tabular-nums"
						title={Array.join(
							Array.map(
								props.app.versions,
								release =>
									`${Array.join(
										Array.map(release.runtimes, runtime => SIDES[runtime]),
										', '
									)} ${release.version}`
							),
							'\n'
						)}
					>
						{newest.version}
					</span>
				)
			})}
		</div>
	)
}

// One operation in the list: its device, name, failures, runs and typical duration; the row selects it.
function OperationRow(props: {active: boolean; onSelect: () => void; operation: Operation}) {
	return (
		<div className="border-b">
			<Button
				size="lg"
				variant={Boolean.match(props.active, {onFalse: () => 'ghost' as const, onTrue: () => 'secondary' as const})}
				className="w-full justify-start text-left"
				aria-current={Boolean.match(props.active, {onFalse: () => undefined, onTrue: () => 'true' as const})}
				onClick={props.onSelect}
			>
				{DEVICES[props.operation.runtime]}
				<span className="min-w-0 flex-1 truncate">{props.operation.name}</span>
				{props.operation.failures > 0 && (
					<Badge variant="destructive" className="shrink-0 font-mono" title="Failed">
						{props.operation.failures}
						<span className="sr-only"> failed</span>
					</Badge>
				)}
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
			</Button>
		</div>
	)
}

// The operations of every app, failures first, as the page's root list.
function OperationsPane(props: {
	activeKey?: OperationKey
	className?: string
	onSelect: (app: string, operation: Operation) => void
	overview: Overview
}) {
	return (
		<section
			aria-label="Operations"
			className={cn('pb-safe-bottom flex min-h-0 flex-col overflow-y-auto', props.className)}
		>
			<header className="bg-background sticky top-0 z-30 flex h-8 shrink-0 items-center gap-1 border-b px-3">
				<span className="text-sm font-semibold">Operations</span>
				<span className="text-muted-foreground font-mono text-xs">
					{count.format(Array.reduce(props.overview.apps, 0, (sum, app) => sum + app.operations.length))}
				</span>
				<span className="ml-auto flex items-center gap-1">
					<span className="text-muted-foreground w-10 text-right text-xs max-lg:hidden">Runs</span>
					<span className="text-muted-foreground w-12 text-right text-xs">Typical</span>
				</span>
			</header>
			{Array.match(props.overview.apps, {
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
			})}
		</section>
	)
}

// Where it broke: the failing span's name, or its status when that span is the operation itself.
function failureLabel(failure: NonNullable<OperationTrace['failure']>, operation: string) {
	if (failure.span !== operation) return failure.span
	return Option.match(String.match(/StatusCode error \((\d{3})/u)(failure.message), {
		onNone: () => 'Failed',
		onSome: parts => parts[1] ?? 'Failed'
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
			className={cn(
				props.arrived &&
					'grid-rows-single animate-grow-in grid motion-reduce:animate-none [&>*]:min-h-0 [&>*]:overflow-clip'
			)}
		>
			<div className="border-b">
				<Button
					size="lg"
					variant={Boolean.match(props.active, {onFalse: () => 'ghost' as const, onTrue: () => 'secondary' as const})}
					className="w-full justify-start text-left"
					aria-current={Boolean.match(props.active, {onFalse: () => undefined, onTrue: () => 'true' as const})}
					onClick={props.onSelect}
				>
					<span className="text-muted-foreground w-8 shrink-0 font-mono text-xs">
						{ageOf(props.trace.time, props.now)}
					</span>
					<span className="text-muted-foreground min-w-0 flex-1 truncate font-mono text-xs">
						{String.slice(0, 8)(props.trace.id)}
					</span>
					{props.trace.failure !== undefined && (
						<Badge
							variant="destructive"
							className="max-w-32 shrink-0 font-mono"
							title={`Failed at ${props.trace.failure.span}: ${props.trace.failure.message}`}
						>
							<span className="truncate">{failureLabel(props.trace.failure, props.operation)}</span>
						</Badge>
					)}
					<span className="w-14 shrink-0 text-right font-mono whitespace-nowrap tabular-nums">
						{durationOf(props.trace.durationMs)}
					</span>
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
	selectedTrace?: OperationTrace
}) {
	return Option.match(Option.fromUndefinedOr(props.active), {
		onNone: () => (
			<section aria-label="Traces" className={cn('flex min-h-0 flex-col', props.className)}>
				<Empty>
					<EmptyHeader>
						<EmptyTitle>Select an operation</EmptyTitle>
					</EmptyHeader>
				</Empty>
			</section>
		),
		onSome: active => (
			<section
				aria-label="Traces"
				className={cn('pb-safe-bottom flex min-h-0 flex-col overflow-y-auto', props.className)}
			>
				<header className="bg-background sticky top-0 z-20 flex h-8 shrink-0 items-center gap-2 border-b px-3">
					{Option.match(Option.fromUndefinedOr(marks[active.app.name]), {
						onNone: () => <Server className="text-muted-foreground size-4 shrink-0" />,
						onSome: mark => <img src={mark} alt="" className="pixelated size-4 shrink-0" />
					})}
					<span className="min-w-0 flex-1 truncate text-sm font-semibold">{active.operation.name}</span>
					{active.operation.failures > 0 && (
						<Badge variant="destructive" className="shrink-0 font-mono" title="Failed">
							{active.operation.failures}
							<span className="sr-only"> failed</span>
						</Badge>
					)}
					<span className="text-muted-foreground shrink-0 font-mono text-xs whitespace-nowrap">
						{durationOf(active.operation.p50Ms)} typical
					</span>
				</header>
				<div className="bg-background text-muted-foreground sticky top-8 z-10 flex h-8 shrink-0 items-center gap-1 border-b px-2.5 text-xs">
					<span className="w-8">Age</span>
					<span className="min-w-0 flex-1">Trace</span>
					<span className="w-32 text-right">Failure</span>
					<span className="w-14 text-right">Duration</span>
				</div>
				<div role="list">
					{Array.map(active.operation.traces, trace => (
						<TraceListRow
							key={trace.id}
							active={props.selectedTrace?.id === trace.id}
							arrived={Array.contains(props.arrived, trace.id)}
							now={props.now}
							onSelect={() => props.onSelect(trace)}
							operation={active.operation.name}
							trace={trace}
						/>
					))}
				</div>
			</section>
		)
	})
}

// The trace's full id copies from its short form, the button confirming in place.
function CopyTrace(props: {id: string}) {
	const [copy, copyText] = useAtom(copyAtom)
	const copied = AsyncResult.isWaiting(copy)
	return (
		<>
			<Button
				variant="ghost"
				size="icon-xs"
				aria-label={Boolean.match(copied, {onFalse: () => 'Copy trace ID', onTrue: () => 'Copied'})}
				title="Copy trace ID"
				onClick={() => copyText(props.id)}
			>
				{Boolean.match(copied, {onFalse: () => <Copy />, onTrue: () => <Check className="text-primary" />})}
			</Button>
			<span role="status" className="sr-only">
				{copied && 'Copied'}
			</span>
		</>
	)
}

// The picked trace: its age, failure and duration, then its spans and the picked span's detail.
function TracePane(props: {className?: string; now: number; trace?: OperationTrace}) {
	return Option.match(Option.fromUndefinedOr(props.trace), {
		onNone: () => (
			<section aria-label="Trace" className={cn('flex min-h-0 flex-col', props.className)}>
				<Empty>
					<EmptyHeader>
						<EmptyTitle>Select a trace</EmptyTitle>
					</EmptyHeader>
				</Empty>
			</section>
		),
		onSome: trace => (
			<section
				aria-label="Trace"
				className={cn('pb-safe-bottom flex min-h-0 flex-col overflow-y-auto', props.className)}
			>
				<header className="bg-background sticky top-0 z-20 flex h-8 shrink-0 items-center gap-2 border-b px-3">
					<span
						className="text-muted-foreground w-14 shrink-0 font-mono text-xs"
						title={clock.format(Option.getOrElse(Number.parse(String.slice(0, -6)(trace.time)), () => props.now))}
					>
						{ageOf(trace.time, props.now)}
					</span>
					<span className="min-w-0 flex-1 truncate font-mono text-xs" title={trace.id}>
						{String.slice(0, 8)(trace.id)}
					</span>
					<CopyTrace id={trace.id} />
					<span className="shrink-0 font-mono text-xs whitespace-nowrap tabular-nums">
						{durationOf(trace.durationMs)}
					</span>
				</header>
				<div className="bg-background text-muted-foreground sticky top-8 z-10 flex h-8 shrink-0 items-center gap-3 border-b pr-4 pl-3 text-xs">
					<span className="w-40 pl-6">Span</span>
					<span className="min-w-0 flex-1">Timeline</span>
					<span className="w-14 text-right">Duration</span>
					<span className="size-3.5" />
				</div>
				<div className="min-w-0 px-3">
					<Suspense fallback={<SpansSkeleton />}>
						<Spans key={trace.id} id={trace.id} size={trace.durationMs} />
					</Suspense>
				</div>
			</section>
		)
	})
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
	const isMobile = useIsMobile()
	const [pane, setPane] = useState<Pane>('operations')
	const [selection, setSelection] = useState<OperationKey>()
	const [selectedTrace, setSelectedTrace] = useState<OperationTrace>()
	const overview = useAtomValue(overviewAtom)
	const value = AsyncResult.value(overview)
	const overviewError = AsyncResult.error(overview)
	const authFailure = Option.filter(overviewError, Schema.is(AuthError))
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
							Match.when('traces', () => 'Traces'),
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
				palette={Boolean.match(Option.isSome(authFailure), {onFalse: () => [traces, operations], onTrue: () => []})}
			/>
			{Option.match(authFailure, {
				onNone: () =>
					Option.match(value, {
						onNone: () =>
							Option.match(overviewError, {
								onNone: () => <ScopeSkeleton isMobile={isMobile} />,
								onSome: error => <FailureContent error={error} />
							}),
						onSome: current => (
							<div className="flex min-h-0 flex-1">
								{Boolean.match(isMobile, {
									onFalse: () => (
										<div className="grid-cols-scope grid min-h-0 flex-1">
											<OperationsPane
												activeKey={Option.getOrUndefined(activeKey)}
												className="min-w-0 border-r"
												onSelect={selectOperation}
												overview={current}
											/>
											<TracesPane
												active={Option.getOrUndefined(activeOperation)}
												arrived={arrived}
												className="min-w-0 border-r"
												now={now}
												onSelect={selectTrace}
												selectedTrace={Option.getOrUndefined(activeTrace)}
											/>
											<TracePane className="min-w-0" now={now} trace={Option.getOrUndefined(activeTrace)} />
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
														overview={current}
													/>
												)),
												Match.when('traces', () => (
													<TracesPane
														active={Option.getOrUndefined(activeOperation)}
														arrived={arrived}
														className="min-h-0 flex-1"
														now={now}
														onSelect={selectTrace}
														selectedTrace={Option.getOrUndefined(activeTrace)}
													/>
												)),
												Match.orElse(() => (
													<TracePane className="min-h-0 flex-1" now={now} trace={Option.getOrUndefined(activeTrace)} />
												))
											)}
										</>
									)
								})}
							</div>
						)
					}),
				onSome: error => <FailureContent error={error} />
			})}
		</div>
	)
}

export const Route = createFileRoute('/(home)/')({component: Home})
