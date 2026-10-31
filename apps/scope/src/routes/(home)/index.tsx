import {useAtom, useAtomRefresh, useAtomValue} from '@effect/atom-react'

import {Array, Boolean, Cause, DateTime, Number, Option, Predicate, Record, Schema, String, pipe} from 'effect'

import {createFileRoute} from '@tanstack/react-router'
import {AsyncResult} from 'effect/reactivity'
import {RotateCw} from 'lucide-react'
import {useState} from 'react'

import {AppBar} from '@deslop/components-web/app-bar'
import {Error, Loading} from '@deslop/components-web/fallbacks'
import {Button, buttonVariants} from '@deslop/components-web/ui/button'
import {cn} from '@deslop/components-web/utils'
import {signInUrl} from '@deslop/runtime/auth/utils'

import {
	ageOf,
	arrivalsAtom,
	durationOf,
	filtersAtom,
	selectedAtom,
	selectedTraceAtom,
	servicesAtom,
	tracesAtom,
	tracesQueryAtom
} from '#lib/utils.ts'
import icon from '#routes/icon-dark.png'
import type {Trace, TraceSummary} from '#services/telemetry/schema.ts'

type TraceSpan = Trace['spans'][number]

type Attributes = typeof Attributes.Type
const Attributes = Schema.Array(Schema.Struct({key: Schema.String, value: Schema.Json}))
type Wrapped = typeof Wrapped.Type
const Wrapped = Schema.Record(Schema.String, Schema.Json)

// A failure the page can't show as data: sign-in, then anything else as an error with a reload.
function Failure(props: {cause: Cause.Cause<unknown>}) {
	return Option.match(Cause.findErrorOption(props.cause), {
		onNone: () => <Error error={Cause.squash(props.cause)} reset={() => location.reload()} />,
		onSome: error => {
			if (!Predicate.isTagged(error, 'AuthError')) return <Error error={error} reset={() => location.reload()} />
			return (
				<div className="flex flex-1 items-center justify-center">
					<a className={buttonVariants({size: 'lg'})} href={signInUrl(location.href)}>
						Sign in with GitHub
					</a>
				</div>
			)
		}
	})
}

function Toggle(props: {label: string; on: boolean; onPress: () => void}) {
	return (
		<Button
			size="sm"
			variant={Boolean.match(props.on, {onFalse: () => 'ghost' as const, onTrue: () => 'secondary' as const})}
			aria-pressed={props.on}
			onClick={props.onPress}
			className="font-mono"
		>
			{props.label}
		</Button>
	)
}

// One toggle per service that sent telemetry, every service at once, and only failed traces.
function ServiceFilter() {
	const [filters, setFilters] = useAtom(filtersAtom)
	const services = AsyncResult.getOrElse(
		AsyncResult.map(useAtomValue(servicesAtom), status =>
			Array.dedupe(Array.map(status.services, service => service.name))
		),
		Array.empty<string>
	)
	return (
		<div className="flex min-w-0 items-center gap-1 overflow-x-auto">
			<Toggle label="all" on={filters.service === ''} onPress={() => setFilters({...filters, service: ''})} />
			{Array.map(services, service => (
				<Toggle
					key={service}
					label={service}
					on={filters.service === service}
					onPress={() => setFilters({...filters, service})}
				/>
			))}
			<Toggle label="errors" on={filters.errors} onPress={() => setFilters({...filters, errors: !filters.errors})} />
		</div>
	)
}

function TraceRow(props: {
	arrived: boolean
	now: number
	onSelect: () => void
	selected: boolean
	trace: TraceSummary
}) {
	return (
		<li className={cn('border-border grid border-b', props.arrived && 'grow-in')}>
			<Button
				variant={Boolean.match(props.selected, {onFalse: () => 'ghost' as const, onTrue: () => 'secondary' as const})}
				onClick={props.onSelect}
				aria-current={props.selected}
				className="h-auto w-full flex-col items-stretch gap-0.5 rounded-none px-4 py-2.5 font-normal"
			>
				<span className="flex items-baseline justify-between gap-3">
					<span className="truncate text-sm font-medium">{props.trace.operation}</span>
					<span className="text-muted-foreground font-mono text-xs">{ageOf(props.trace.time, props.now)}</span>
				</span>
				<span className="flex items-baseline justify-between gap-3 font-mono text-xs">
					<span className="text-muted-foreground flex min-w-0 items-center gap-1.5">
						{props.trace.errors > 0 && <span className="bg-destructive size-1.5 shrink-0 rounded-full" />}
						<span className="truncate">{props.trace.service}</span>
					</span>
					{durationOf(props.trace.durationMs)}
				</span>
			</Button>
		</li>
	)
}

// An attribute's value as OTLP wraps it, such as {stringValue: "…"}, shown as its one value.
function valueOf(value: Schema.Json) {
	return pipe(
		Schema.decodeUnknownOption(Wrapped)(value),
		Option.flatMap(wrapped => Array.head(Record.values(wrapped))),
		Option.filter(inner => Predicate.isString(inner) || Predicate.isNumber(inner) || Predicate.isBoolean(inner)),
		Option.match({onNone: () => JSON.stringify(value), onSome: inner => `${inner}`})
	)
}

function SpanDetail(props: {span: TraceSpan}) {
	return (
		<section className="border-border flex flex-col gap-2 border-t pt-3" aria-label="Span">
			<h3 className="flex items-center gap-2 text-sm font-medium">
				{props.span.status === 2 && <span className="bg-destructive size-1.5 rounded-full" />}
				{props.span.name}
				<span className="text-muted-foreground font-mono text-xs font-normal">{durationOf(props.span.durationMs)}</span>
			</h3>
			<dl className="flex flex-col gap-1 font-mono text-xs">
				{Array.map(
					[
						{key: 'service', value: props.span.service},
						...Array.map(
							Option.getOrElse(Schema.decodeUnknownOption(Attributes)(props.span.payload['attributes']), () => []),
							attribute => ({key: attribute.key, value: valueOf(attribute.value)})
						)
					],
					attribute => (
						<div key={attribute.key} className="flex gap-4">
							<dt className="text-muted-foreground w-40 shrink-0 truncate">{attribute.key}</dt>
							<dd className="min-w-0 break-all select-text">{attribute.value}</dd>
						</div>
					)
				)}
			</dl>
			{Array.isReadonlyArrayNonEmpty(props.span.logs) && (
				<ul className="flex flex-col gap-1 font-mono text-xs">
					{Array.map(props.span.logs, log => (
						<li key={log.id} className={cn('break-words select-text', log.status === 2 && 'text-destructive')}>
							{log.name}
						</li>
					))}
				</ul>
			)}
		</section>
	)
}

// A span's bar on the trace's time axis: its offset and length in milliseconds over the list's `--trace-total`.
function Bar(props: {span: TraceSpan}) {
	return (
		<span className="relative h-2.5 flex-1">
			<span
				className={cn(
					'absolute top-0 left-(--offset) h-2.5 w-(--length) min-w-0.5 rounded-sm',
					props.span.status === 2 && 'bg-destructive',
					props.span.status !== 2 && props.span.depth === 0 && 'bg-foreground',
					props.span.status !== 2 && props.span.depth > 0 && 'bg-muted-foreground/60'
				)}
				style={{
					'--length': `calc(${props.span.durationMs} / var(--trace-total) * 100%)`,
					'--offset': `calc(${props.span.offsetMs} / var(--trace-total) * 100%)`
				}}
			/>
		</span>
	)
}

// The trace as a waterfall: each span at its offset and length on one shared time axis.
function Waterfall(props: {trace: Trace}) {
	const [picked, setPicked] = useState<string>()
	const focus = pipe(
		Array.findFirst(props.trace.spans, span => span.spanId === picked),
		Option.orElse(() => Array.findFirst(props.trace.spans, span => span.status === 2)),
		Option.orElse(() => Array.head(props.trace.spans))
	)
	return (
		<div className="flex flex-col gap-4">
			<div className="flex flex-col gap-0.5">
				<div className="flex items-baseline justify-between gap-3">
					<h2 className="truncate text-base font-semibold">
						{Option.match(Array.head(props.trace.spans), {onNone: () => props.trace.id, onSome: span => span.name})}
					</h2>
					<span className="text-muted-foreground font-mono text-xs">{durationOf(props.trace.durationMs)}</span>
				</div>
				<p className="text-muted-foreground font-mono text-xs">
					trace {pipe(props.trace.id, String.slice(0, 8))} · {props.trace.spans.length} spans ·{' '}
					{Array.countBy(props.trace.spans, span => span.status === 2)} errors
				</p>
			</div>
			<ol className="trace-axis flex flex-col" style={{'--trace-total': `${Number.max(props.trace.durationMs, 1)}`}}>
				{Array.map(props.trace.spans, span => (
					<li key={span.spanId}>
						<Button
							variant={Boolean.match(
								Option.exists(focus, current => current.spanId === span.spanId),
								{onFalse: () => 'ghost' as const, onTrue: () => 'secondary' as const}
							)}
							onClick={() => setPicked(span.spanId)}
							className="w-full gap-3 px-1 font-normal"
						>
							<span
								className="w-48 shrink-0 truncate pl-(--indent) text-left"
								style={{'--indent': `${span.depth * 12}px`}}
							>
								{span.name}
							</span>
							<Bar span={span} />
							<span className="text-muted-foreground w-16 shrink-0 text-right font-mono">
								{durationOf(span.durationMs)}
							</span>
						</Button>
					</li>
				))}
			</ol>
			{Option.match(focus, {onNone: () => null, onSome: span => <SpanDetail span={span} />})}
		</div>
	)
}

function Detail() {
	return Option.match(useAtomValue(selectedTraceAtom), {
		onNone: () => <p className="text-muted-foreground text-sm">Pick a trace to see its spans.</p>,
		onSome: result =>
			AsyncResult.match(result, {
				onFailure: failure => <Failure cause={failure.cause} />,
				onInitial: () => <Loading />,
				// The previous trace stays dimmed while the picked one loads.
				onSuccess: trace => (
					<div
						aria-busy={trace.waiting}
						className={cn('transition-opacity duration-150', trace.waiting && 'opacity-50')}
					>
						<Waterfall trace={trace.value} />
					</div>
				)
			})
	})
}

function Traces() {
	const [selected, setSelected] = useAtom(selectedAtom)
	const arrived = useAtomValue(arrivalsAtom).arrived
	const now = DateTime.toEpochMillis(DateTime.nowUnsafe())
	return AsyncResult.match(useAtomValue(tracesAtom), {
		onFailure: failure => <Failure cause={failure.cause} />,
		onInitial: () => <Loading />,
		onSuccess: page => (
			<div className="flex min-h-0 flex-1 flex-col md:flex-row">
				<nav
					className="border-border min-h-0 shrink-0 overflow-y-auto border-b md:w-80 md:border-r md:border-b-0"
					aria-label="Traces"
				>
					<p className="text-muted-foreground border-border flex items-center gap-2 border-b px-4 py-2 font-mono text-xs">
						{page.value.total} traces · last 3 days
						{page.waiting && <span className="bg-primary size-1.5 rounded-full motion-safe:animate-pulse" />}
					</p>
					{Array.match(page.value.entries, {
						onEmpty: () => <p className="text-muted-foreground px-4 py-6 text-sm">No traces match.</p>,
						onNonEmpty: entries => (
							<ul>
								{Array.map(entries, trace => (
									<TraceRow
										key={trace.id}
										arrived={Array.contains(arrived, trace.id)}
										now={now}
										onSelect={() => setSelected(Option.some(trace.id))}
										selected={Option.contains(selected, trace.id)}
										trace={trace}
									/>
								))}
							</ul>
						)
					})}
				</nav>
				<main className="min-h-0 flex-1 overflow-y-auto px-4 py-4 md:px-6">
					<Detail />
				</main>
			</div>
		)
	})
}

// Asks the server again for the traces under the current filters.
function Refresh() {
	return (
		<Button
			variant="ghost"
			size="icon-sm"
			aria-label="Refresh traces"
			onClick={useAtomRefresh(useAtomValue(tracesQueryAtom))}
		>
			<RotateCw />
		</Button>
	)
}

function Home() {
	return (
		<>
			<AppBar icon={icon} name="scope">
				<div className="flex min-w-0 items-center gap-2">
					<ServiceFilter />
					<Refresh />
				</div>
			</AppBar>
			<Traces />
		</>
	)
}

export const Route = createFileRoute('/(home)/')({component: Home})
