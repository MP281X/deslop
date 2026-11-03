import {useAtomSuspense, useAtomValue} from '@effect/atom-react'

import {
	Array,
	Boolean,
	Cause,
	DateTime,
	Formatter,
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
import {ChevronRight, Globe, Server, Smartphone, Workflow} from 'lucide-react'
import {Suspense, useState} from 'react'
import type {ReactElement} from 'react'

import {AppBar, useCommandQuery} from '@deslop/components-web/app-bar'
import {Error, SignIn} from '@deslop/components-web/fallbacks'
import {Page} from '@deslop/components-web/page'
import {Badge} from '@deslop/components-web/ui/badge'
import {Collapsible, CollapsibleContent, CollapsibleTrigger} from '@deslop/components-web/ui/collapsible'
import {Empty, EmptyHeader, EmptyTitle} from '@deslop/components-web/ui/empty'
import {Skeleton} from '@deslop/components-web/ui/skeleton'
import {GithubDark} from '@deslop/components-web/ui/svgs/githubDark'
import {GithubLight} from '@deslop/components-web/ui/svgs/githubLight'
import {cn} from '@deslop/components-web/utils'
import {needsSignIn, signInUrl} from '@deslop/runtime/auth/utils'

import {ageOf, arrivalsAtom, durationOf, nowAtom, overviewAtom, traceAtom} from '#lib/utils.ts'
import icon from '#routes/icon.svg'
import {appName} from '#services/telemetry/lib/utils.ts'
import type {Operation, OperationTrace, Overview, Runtime, Trace} from '#services/telemetry/schema.ts'

// The side an operation starts on, in words, so the bar's field can narrow to it.
const SIDES: Record<Runtime, string> = {ci: 'ci', mobile: 'iOS', server: 'server', unknown: '', web: 'web'}

// The device an operation starts on, as Auth marks a sign-in's, in its side's hue: a browser, a phone, a server or CI.
const DEVICES: Record<Runtime, ReactElement> = {
	ci: <Workflow role="img" aria-label="ci" data-side="ci" className="size-3.5 shrink-0 text-(--side)" />,
	mobile: <Smartphone role="img" aria-label="iOS" data-side="mobile" className="size-3.5 shrink-0 text-(--side)" />,
	server: <Server role="img" aria-label="server" data-side="server" className="size-3.5 shrink-0 text-(--side)" />,
	unknown: <Server aria-hidden data-side="unknown" className="size-3.5 shrink-0 text-(--side)" />,
	web: <Globe role="img" aria-label="web" data-side="web" className="size-3.5 shrink-0 text-(--side)" />
}

type Attributes = typeof Attributes.Type
const Attributes = Schema.Array(Schema.Struct({key: Schema.String, value: Schema.Json}))
type Wrapped = typeof Wrapped.Type
const Wrapped = Schema.Record(Schema.String, Schema.Json)

// Each Deslop app's mark by its folder, for the app a trace came from.
const marks: Record<string, string> = Record.fromEntries(
	Array.map(
		Record.toEntries(
			import.meta.glob<string>('../../../../*/src/routes/icon.svg', {eager: true, import: 'default', query: '?url'})
		),
		entry => [String.split(entry[0], '/')[4] ?? '', entry[1]]
	)
)

// A failure the page can't show as data: sign-in, then anything else as an error with a reload.
function Failure(props: {cause: Cause.Cause<unknown>}) {
	return Option.match(Cause.findErrorOption(props.cause), {
		onNone: () => <Error error={Cause.squash(props.cause)} reset={() => location.reload()} />,
		onSome: error => {
			if (!needsSignIn(error)) return <Error error={error} reset={() => location.reload()} />
			return <SignIn href={signInUrl(location.href)} />
		}
	})
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

// What a span says beyond its row: attributes, without anything that only repeats its name, such as code.function.
function attributesOf(span: Trace['spans'][number]) {
	return Array.filter(
		Array.map(
			Array.filter(
				Option.getOrElse(Schema.decodeUnknownOption(Attributes)(span.payload['attributes']), () => []),
				attribute => attribute.key !== 'service.name'
			),
			attribute => ({key: attribute.key, value: valueOf(attribute.value)})
		),
		attribute => attribute.value !== span.name
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
	return `calc(var(--spacing) * 10 + ${Number.max(0, span.depth - 1) * 12}px)`
}

// The picked span's error, attributes and logs, each a line on the same columns as the rows: key under the name, value ending under the duration.
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
						className="flex items-baseline gap-3 py-1 pr-1 pl-(--indent)"
						style={{'--indent': indentOf(props.span)}}
					>
						<dt className="text-muted-foreground shrink-0">{line.key}</dt>
						<dd className={cn('min-w-0 flex-1 text-right break-all select-text', line.failed && 'text-destructive')}>
							{/* A request's or a CI step's address opens it, such as the step's log on GitHub. */}
							{Boolean.match(line.key === 'url.full' && String.startsWith('https://')(line.value), {
								onFalse: () => line.value,
								onTrue: () => (
									<a href={line.value} target="_blank" rel="noreferrer" className="text-primary">
										{line.value}
									</a>
								)
							})}
						</dd>
						<span className="size-3.5 shrink-0" />
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
				className="flex w-36 shrink-0 items-center gap-1.5 pl-(--indent) text-left sm:w-56"
				style={{'--indent': indentOf(props.span)}}
			>
				{Option.match(props.mark, {
					onNone: () => null,
					onSome: mark => <img src={mark} alt={appName(props.span.service)} className="pixelated size-3.5 shrink-0" />
				})}
				<span className="truncate">{props.span.name}</span>
			</span>
			<span className="relative h-2 flex-1">
				<span
					data-side={props.span.runtime}
					className={cn(
						'absolute top-0 left-(--offset) h-2 w-(--length) min-w-0.5',
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

// A trace's spans under its root, each on the trace's time scale; where it broke starts picked, else the root's own details show.
function Spans(props: {id: string; size: number}) {
	const result = useAtomSuspense(traceAtom(`${props.id}:${props.size}`), {includeFailure: true})
	const [picked, setPicked] = useState<string>()
	if (AsyncResult.isFailure(result)) return <Failure cause={result.cause} />
	const trace = result.value
	const root = Array.findFirst(trace.spans, span => span.depth === 0)
	const below = Array.filter(trace.spans, span => !Option.exists(root, top => top.spanId === span.spanId))
	const services = Record.fromEntries(Array.map(trace.spans, span => [span.spanId, span.service] as const))
	// Where a trace enters another app its span shows that app's mark; the bar's hue already tells the side.
	function mark(span: Trace['spans'][number]) {
		// A parent that never arrived, such as a page's still-open call, reads as the root.
		const parent =
			services[span.parentSpanId] ?? Option.match(root, {onNone: () => span.service, onSome: top => top.service})
		return Option.filter(
			Option.fromUndefinedOr(marks[appName(span.service)]),
			() => appName(span.service) !== appName(parent)
		)
	}
	// Nothing picked yet starts on where it broke, else the root; closing a span leaves none open.
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
	return (
		<div className="flex flex-col pb-2" style={{'--trace-total': `${Number.max(trace.durationMs, 1)}`}}>
			{Option.match(
				Option.filter(focus, span => Option.exists(root, top => top.spanId === span.spanId)),
				{onNone: () => null, onSome: span => <SpanDetail span={span} />}
			)}
			{Array.map(below, span =>
				Boolean.match(hasDetail(span), {
					onFalse: () => (
						<div key={span.spanId} className="flex h-8 w-full items-center gap-3 pr-1 text-xs">
							<SpanLine mark={mark(span)} span={span} />
						</div>
					),
					// A span with more to show opens like any row; its details sit inside the same shaded block, under its name.
					onTrue: () => (
						<Collapsible
							key={span.spanId}
							open={Option.exists(focus, current => current.spanId === span.spanId)}
							onOpenChange={open => setPicked(Boolean.match(open, {onFalse: () => '', onTrue: () => span.spanId}))}
							className="data-open:bg-muted/60"
						>
							<CollapsibleTrigger className="hover:bg-muted/50 flex h-8 w-full cursor-pointer items-center gap-3 pr-1 text-left text-xs">
								<SpanLine
									mark={mark(span)}
									span={span}
									open={Option.exists(focus, current => current.spanId === span.spanId)}
								/>
							</CollapsibleTrigger>
							<CollapsibleContent>
								<SpanDetail span={span} />
							</CollapsibleContent>
						</Collapsible>
					)
				})
			)}
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

// One trace of an operation, opening on its spans; a failed one says where it broke instead of turning red.
function TraceRow(props: {
	arrived: boolean
	now: number
	onOpenChange: (open: boolean) => void
	trace: OperationTrace
}) {
	const [open, setOpen] = useState(false)
	return (
		<div className={cn(props.arrived && 'grow-in')}>
			<Collapsible
				open={open}
				onOpenChange={next => {
					setOpen(next)
					props.onOpenChange(next)
				}}
				className="border-b"
			>
				<CollapsibleTrigger className="hover:bg-muted/50 flex h-8 w-full cursor-pointer items-center gap-3 pr-1 pl-6 text-left text-xs">
					<span className="text-muted-foreground w-8 shrink-0 font-mono">{ageOf(props.trace.time, props.now)}</span>
					<span className="flex-1" />
					{/* A failed trace names where it broke in the same red badge its operation counts with; the error shows once opened. */}
					{props.trace.failure !== undefined && (
						<Badge
							variant="destructive"
							className="max-w-40 shrink-0 font-mono"
							title={`Failed at ${props.trace.failure.span}`}
						>
							<span className="truncate">{props.trace.failure.span}</span>
						</Badge>
					)}
					<span className="w-14 shrink-0 text-right font-mono whitespace-nowrap tabular-nums">
						{durationOf(props.trace.durationMs)}
					</span>
					<ChevronRight
						className={cn('text-muted-foreground size-3.5 shrink-0 transition-transform', open && 'rotate-90')}
					/>
				</CollapsibleTrigger>
				<CollapsibleContent>
					<Suspense fallback={<SpansSkeleton />}>
						<Spans id={props.trace.id} size={props.trace.durationMs} />
					</Suspense>
				</CollapsibleContent>
			</Collapsible>
		</div>
	)
}

// An operation: its failures, how often it ran and how long it typically takes, opening on its slowest traces.
function OperationRow(props: {arrived: readonly string[]; now: number; operation: Operation}) {
	const [open, setOpen] = useState(false)
	// A trace kept open stays even after others push it out of the slowest twenty.
	const [pinned, setPinned] = useState(Record.empty<string, OperationTrace>)
	const rows = [
		...props.operation.traces,
		...Array.filter(Record.values(pinned), trace => !Array.some(props.operation.traces, entry => entry.id === trace.id))
	]
	return (
		<Collapsible role="listitem" open={open} onOpenChange={setOpen} className="border-b">
			<CollapsibleTrigger className="hover:bg-muted/50 flex h-10 w-full cursor-pointer items-center gap-3 px-1 text-left text-sm">
				{DEVICES[props.operation.runtime]}
				<span className="min-w-0 flex-1 truncate">{props.operation.name}</span>
				{props.operation.failures > 0 && (
					<Badge variant="destructive" className="shrink-0 font-mono" title="Failed">
						{props.operation.failures}
						<span className="sr-only"> failed</span>
					</Badge>
				)}
				<span
					className="text-muted-foreground w-12 shrink-0 text-right font-mono text-xs whitespace-nowrap tabular-nums max-sm:hidden"
					title="Runs"
				>
					{props.operation.count}×<span className="sr-only"> runs</span>
				</span>
				<span className="w-14 shrink-0 text-right font-mono text-xs whitespace-nowrap tabular-nums" title="Typical">
					<span className="sr-only">typical </span>
					{durationOf(props.operation.p50Ms)}
				</span>
				<ChevronRight
					className={cn('text-muted-foreground size-3.5 shrink-0 transition-transform', open && 'rotate-90')}
				/>
			</CollapsibleTrigger>
			<CollapsibleContent className="border-t">
				{Array.map(rows, trace => (
					<TraceRow
						key={trace.id}
						arrived={Array.contains(props.arrived, trace.id)}
						now={props.now}
						onOpenChange={next =>
							setPinned(current =>
								Boolean.match(next, {
									onFalse: () => Record.remove(current, trace.id),
									onTrue: () => Record.set(current, trace.id, trace)
								})
							)
						}
						trace={trace}
					/>
				))}
			</CollapsibleContent>
		</Collapsible>
	)
}

// The apps that started traces, server, web and iOS together, those with failures first, each with its operations; the bar's field narrows both.
function Apps(props: {overview: Overview}) {
	const query = String.toLowerCase(useCommandQuery())
	const arrived = useAtomValue(arrivalsAtom).arrived
	const now = AsyncResult.getOrElse(useAtomValue(nowAtom), () => DateTime.toEpochMillis(DateTime.nowUnsafe()))
	const apps = Array.filter(
		Array.map(props.overview.apps, app => ({
			...app,
			operations: Array.filter(app.operations, operation =>
				String.includes(query)(
					String.toLowerCase(
						`${app.name} ${Array.join(
							Array.map(app.versions, release => release.version),
							' '
						)} ${SIDES[operation.runtime]} ${operation.name}`
					)
				)
			)
		})),
		app => Array.isReadonlyArrayNonEmpty(app.operations)
	)
	if (Array.isArrayEmpty(apps)) {
		return (
			<Empty>
				<EmptyHeader>
					<EmptyTitle>
						{Boolean.match(query === '', {onFalse: () => 'No operation matches', onTrue: () => 'No traces yet'})}
					</EmptyTitle>
				</EmptyHeader>
			</Empty>
		)
	}
	return Array.map(apps, app => (
		<section key={app.name} aria-label={app.name} className="flex flex-col">
			<h2 className="flex h-9 items-center gap-2 px-1 text-sm font-semibold">
				{Option.match(Option.fromUndefinedOr(marks[app.name]), {
					// A repository whose workflows only GitHub Actions runs, else a service Scope has no mark for.
					onNone: () =>
						Boolean.match(
							Array.every(app.operations, operation => operation.runtime === 'ci'),
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
				{app.name}
				{/* The newest release the app runs; hovering names each side's, since an iOS app ships apart from its server. */}
				{Option.match(Array.head(app.versions), {
					onNone: () => null,
					onSome: newest => (
						<span
							className="text-muted-foreground font-mono text-xs font-normal tabular-nums"
							title={Array.join(
								Array.map(
									app.versions,
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
			</h2>
			<div role="list">
				{Array.map(app.operations, operation => (
					<OperationRow
						key={`${operation.runtime} ${operation.name}`}
						arrived={arrived}
						now={now}
						operation={operation}
					/>
				))}
			</div>
		</section>
	))
}

function Live() {
	const result = useAtomSuspense(overviewAtom, {includeFailure: true})
	if (AsyncResult.isFailure(result)) return <Failure cause={result.cause} />
	return <Apps overview={result.value} />
}

function Home() {
	return (
		<>
			<AppBar icon={icon} name="scope" commands={[]} />
			<Page className="gap-6">
				{/* The first push suspends to skeleton rows; React keeps a shown fallback at least 300ms. */}
				<Suspense
					fallback={
						<div role="status" aria-label="Operations" className="flex flex-col gap-2">
							{Array.map(Array.range(1, 6), row => (
								<Skeleton key={row} className="h-9 w-full" />
							))}
						</div>
					}
				>
					<Live />
				</Suspense>
			</Page>
		</>
	)
}

export const Route = createFileRoute('/(home)/')({component: Home})
