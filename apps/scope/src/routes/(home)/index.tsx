import {useAtom, useAtomRefresh, useAtomSet, useAtomSuspense, useAtomValue} from '@effect/atom-react'

import {Array, Boolean, Cause, DateTime, Number, Option, Order, Predicate, Record, Schema, String, pipe} from 'effect'

import {createFileRoute} from '@tanstack/react-router'
import {AsyncResult} from 'effect/reactivity'
import {ChevronLeft, OctagonAlert, RotateCw, Server, X} from 'lucide-react'
import {Suspense, useState} from 'react'
import type {ReactNode} from 'react'

import {AppBar, useCommandQuery} from '@deslop/components-web/app-bar'
import {Error, SignIn} from '@deslop/components-web/fallbacks'
import {ItemList, ItemListSkeleton} from '@deslop/components-web/item-list'
import {StatusDot} from '@deslop/components-web/status-dot'
import {Badge} from '@deslop/components-web/ui/badge'
import {Button} from '@deslop/components-web/ui/button'
import {Empty, EmptyHeader, EmptyTitle} from '@deslop/components-web/ui/empty'
import {Item, ItemContent, ItemDescription, ItemTitle} from '@deslop/components-web/ui/item'
import {Skeleton} from '@deslop/components-web/ui/skeleton'
import {cn} from '@deslop/components-web/utils'
import {needsSignIn, signInUrl} from '@deslop/runtime/auth/utils'

import {
	ageOf,
	arrivalsAtom,
	durationOf,
	filtersAtom,
	selectedAtom,
	selectedTraceAtom,
	serviceLabel,
	servicesAtom,
	tracesAtom,
	tracesQueryAtom
} from '#lib/utils.ts'
import icon from '#routes/icon.svg'
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
			if (!needsSignIn(error)) return <Error error={error} reset={() => location.reload()} />
			return <SignIn href={signInUrl(location.href)} />
		}
	})
}

// The filters the command field set, each a chip that clears it; nothing while every trace shows.
function ActiveFilters() {
	const [filters, setFilters] = useAtom(filtersAtom)
	if (filters.service === '' && !filters.errors) return null
	return (
		<div className="border-border flex flex-wrap items-center gap-1 border-b px-2 py-1.5">
			{filters.service !== '' && (
				<Badge
					variant="secondary"
					render={
						<button
							type="button"
							aria-label={`Show every service, not only ${serviceLabel(filters.service)}`}
							onClick={() => setFilters({...filters, service: ''})}
						/>
					}
				>
					{serviceLabel(filters.service)}
					<X data-icon="inline-end" />
				</Badge>
			)}
			{filters.errors && (
				<Badge
					variant="secondary"
					render={
						<button
							type="button"
							aria-label="Show every trace, not only failures"
							onClick={() => setFilters({...filters, errors: false})}
						/>
					}
				>
					Failures only
					<X data-icon="inline-end" />
				</Badge>
			)}
		</div>
	)
}

// Refresh, failures only, and one service at a time, all from the command field.
function useCommands() {
	const [filters, setFilters] = useAtom(filtersAtom)
	const refresh = useAtomRefresh(useAtomValue(tracesQueryAtom))
	const services = AsyncResult.getOrElse(
		AsyncResult.map(useAtomValue(servicesAtom), status =>
			Array.dedupe(Array.map(status.services, service => service.name))
		),
		Array.empty<string>
	)
	return [
		{icon: <RotateCw />, label: 'Refresh traces', run: refresh},
		{
			icon: <OctagonAlert />,
			label: Boolean.match(filters.errors, {onFalse: () => 'Only failures', onTrue: () => 'All traces'}),
			run: () => setFilters({...filters, errors: !filters.errors})
		},
		...Array.map(
			Array.filter(services, service => service !== filters.service),
			service => ({
				icon: <Server />,
				label: `Only ${serviceLabel(service)}`,
				run: () => setFilters({...filters, service})
			})
		)
	]
}

function TraceRow(props: {
	arrived: boolean
	now: number
	onSelect: () => void
	selected: boolean
	trace: TraceSummary
}) {
	return (
		<div role="listitem" className={cn('grid', props.arrived && 'grow-in')}>
			<Item
				size="sm"
				variant={Boolean.match(props.selected, {onFalse: () => 'default' as const, onTrue: () => 'muted' as const})}
				render={
					<button
						type="button"
						onClick={props.onSelect}
						aria-current={props.selected}
						aria-label={`${props.trace.operation}, ${serviceLabel(props.trace.service)}, ${durationOf(props.trace.durationMs)}`}
					/>
				}
			>
				<ItemContent>
					<ItemTitle>{props.trace.operation}</ItemTitle>
					{/* A failed trace says so in its second line, in the error's colour. */}
					<ItemDescription className={cn('font-mono', props.trace.errors > 0 && 'text-destructive')}>
						{Boolean.match(props.trace.errors > 0, {onFalse: () => '', onTrue: () => 'Failed · '})}
						{serviceLabel(props.trace.service)}
					</ItemDescription>
				</ItemContent>
				<ItemContent className="items-end">
					<ItemDescription className="font-mono">{ageOf(props.trace.time, props.now)}</ItemDescription>
					<ItemDescription className="text-foreground font-mono">{durationOf(props.trace.durationMs)}</ItemDescription>
				</ItemContent>
			</Item>
		</div>
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
				{props.span.status === 2 && <StatusDot status="error" />}
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

// A trace's span rows of label and bar, while the trace loads.
function WaterfallSkeleton() {
	return (
		<div aria-busy="true" aria-label="Trace" role="status" className="flex flex-col gap-3">
			{Array.map(Array.range(1, 5), row => (
				<div key={row} className="flex items-center gap-3">
					<Skeleton className="h-4 w-32" />
					<Skeleton className="h-3 flex-1" />
				</div>
			))}
		</div>
	)
}

function Detail() {
	const setSelected = useAtomSet(selectedAtom)
	return Option.match(useAtomValue(selectedTraceAtom), {
		onNone: () => (
			<Empty>
				<EmptyHeader>
					<EmptyTitle>No trace picked</EmptyTitle>
				</EmptyHeader>
			</Empty>
		),
		onSome: result => (
			<>
				{/* On a phone the trace replaces the list, so this is the way back. */}
				<Button variant="ghost" size="sm" className="mb-2 -ml-2 md:hidden" onClick={() => setSelected(Option.none())}>
					<ChevronLeft />
					Traces
				</Button>
				{AsyncResult.match(result, {
					onFailure: failure => <Failure cause={failure.cause} />,
					onInitial: () => <WaterfallSkeleton />,
					// The previous trace stays dimmed while the picked one loads.
					onSuccess: trace => (
						<div
							aria-busy={trace.waiting}
							className={cn('transition-opacity duration-150', trace.waiting && 'opacity-50')}
						>
							<Waterfall trace={trace.value} />
						</div>
					)
				})}
			</>
		)
	})
}

// A phone shows the list or the picked trace; wider screens show both side by side.
function Panes(props: {children: ReactNode; waiting: boolean}) {
	const selected = useAtomValue(selectedAtom)
	return (
		<div className="flex min-h-0 flex-1 flex-col md:flex-row">
			<nav
				className={cn(
					'border-border pb-safe min-h-0 flex-1 overflow-y-auto md:w-80 md:flex-none md:border-r',
					Option.isSome(selected) && 'hidden md:block'
				)}
				aria-label="Traces"
				aria-busy={props.waiting}
			>
				<ActiveFilters />
				{/* The list a refresh or filter replaces stays dimmed until its answer arrives. */}
				<div className={cn('transition-opacity duration-150', props.waiting && 'opacity-50')}>{props.children}</div>
			</nav>
			<main
				className={cn(
					'pb-safe min-h-0 flex-1 overflow-y-auto px-4 pt-4 md:block md:px-6',
					Option.isNone(selected) && 'hidden'
				)}
			>
				<Detail />
			</main>
		</div>
	)
}

function Traces() {
	const [selected, setSelected] = useAtom(selectedAtom)
	const arrived = useAtomValue(arrivalsAtom).arrived
	const now = DateTime.toEpochMillis(DateTime.nowUnsafe())
	const query = useCommandQuery()
	const page = useAtomSuspense(tracesAtom, {includeFailure: true})
	if (AsyncResult.isFailure(page)) return <Failure cause={page.cause} />
	return (
		<Panes waiting={page.waiting}>
			{Array.match(
				Array.filter(
					// A failed trace leads; the rest keep their newest-first order.
					Array.sort(
						page.value.entries,
						Order.mapInput(Order.Boolean, (trace: TraceSummary) => trace.errors === 0)
					),
					trace => String.includes(query)(String.toLowerCase(`${trace.operation} ${trace.service}`))
				),
				{
					onEmpty: () => (
						<Empty>
							<EmptyHeader>
								<EmptyTitle>No traces match</EmptyTitle>
							</EmptyHeader>
						</Empty>
					),
					onNonEmpty: entries => (
						<ItemList label="Recent traces">
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
						</ItemList>
					)
				}
			)}
		</Panes>
	)
}

function Home() {
	return (
		<>
			<AppBar icon={icon} name="scope" commands={useCommands()} />
			{/* The first load suspends to the panes with skeleton rows; React keeps a shown fallback at least 300ms. */}
			<Suspense
				fallback={
					<Panes waiting={false}>
						<ItemListSkeleton label="Recent traces" rows={8} />
					</Panes>
				}
			>
				<Traces />
			</Suspense>
		</>
	)
}

export const Route = createFileRoute('/(home)/')({component: Home})
