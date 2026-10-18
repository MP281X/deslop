import {useAtomSuspense} from '@effect/atom-react'

import {Array, Boolean, DateTime, Number, Option, Predicate, Record, Schema, String, pipe} from 'effect'

import {createFileRoute} from '@tanstack/react-router'
import {
	ArrowLeft,
	ChevronDown,
	ChevronLeft,
	ChevronRight,
	CircleAlert,
	Copy,
	Info,
	Monitor,
	Server,
	Smartphone,
	TriangleAlert
} from 'lucide-react'
import {Suspense, useDeferredValue} from 'react'

import {Code} from '@deslop/components-web/render/code'
import {Button} from '@deslop/components-web/ui/button'
import {Collapsible, CollapsibleContent, CollapsibleTrigger} from '@deslop/components-web/ui/collapsible'
import {Input} from '@deslop/components-web/ui/input'
import {Select, SelectContent, SelectItem, SelectTrigger, SelectValue} from '@deslop/components-web/ui/select'

import {resultsAtom, servicesAtom, traceAtom} from '#lib/utils.ts'
import {attributes, displayValue, durationMs, treeBranches} from '#services/telemetry/lib/utils.ts'
import {Search, SpanDetails} from '#services/telemetry/schema.ts'
import type {Entry, Runtime, Service, TraceSpan} from '#services/telemetry/schema.ts'

export const Route = createFileRoute('/(home)/')({component: Home, validateSearch: Schema.toStandardSchemaV1(Search)})

function formatDuration(value: number) {
	if (value < 0.001) return `${(value * 1_000_000).toFixed(0)} ns`
	if (value < 1) return `${pipe((value * 1000).toFixed(2), String.replace(/\.?0+$/u, ''))} µs`
	return `${pipe(value.toFixed(2), String.replace(/\.?0+$/u, ''))} ms`
}

function RuntimeIcon(props: {runtime: Runtime}) {
	return (
		<>
			{props.runtime === 'web' && (
				<Monitor className="size-3 shrink-0" role="img" aria-label="Frontend" aria-hidden={false} />
			)}
			{props.runtime === 'mobile' && (
				<Smartphone className="size-3 shrink-0" role="img" aria-label="Mobile" aria-hidden={false} />
			)}
			{props.runtime === 'server' && (
				<Server className="size-3 shrink-0" role="img" aria-label="Backend" aria-hidden={false} />
			)}
		</>
	)
}

function RuntimeLabel(props: {service: Service}) {
	return (
		<span className="inline-flex min-w-0 items-center gap-1.5 text-xs">
			<RuntimeIcon runtime={props.service.runtime} />
			<span className="text-muted-foreground min-w-0 break-words lg:truncate" title={props.service.name}>
				{props.service.name}
			</span>
		</span>
	)
}

function barClass(runtime: Runtime, status: number) {
	if (status === 2) return 'fill-destructive'
	if (runtime === 'web') return 'fill-chart-1'
	if (runtime === 'server') return 'fill-chart-3'
	if (runtime === 'mobile') return 'fill-chart-2'
	return 'fill-muted-foreground'
}

function SpanName(props: {name: string}) {
	if (props.name.length <= 18) {
		return (
			<span className="min-w-0 text-xs break-words" title={props.name}>
				{props.name}
			</span>
		)
	}
	return (
		<span className="min-w-0 text-xs break-words lg:flex" title={props.name}>
			<span className="lg:truncate">{String.slice(0, props.name.length - 12)(props.name)}</span>
			<span className="lg:shrink-0">{String.slice(-12)(props.name)}</span>
		</span>
	)
}

function TreePrefix(props: {branches: boolean[]; branch?: boolean}) {
	return (
		<span className="pointer-events-none flex shrink-0 self-stretch opacity-70" aria-hidden data-tree>
			{Array.map(props.branches, (continues, index) => (
				<span key={index} className="relative w-3 shrink-0 lg:w-3.5">
					{(continues || (props.branch === true && index === props.branches.length - 1)) && (
						<span
							className={Boolean.match(props.branch === true && index === props.branches.length - 1 && !continues, {
								onFalse: () =>
									'border-muted-foreground absolute top-0 -bottom-px left-1.25 border-l lg:-top-px lg:-bottom-0.5',
								onTrue: () =>
									'border-muted-foreground absolute top-0 left-1.25 h-1.75 border-l lg:-top-px lg:bottom-1/2 lg:h-auto'
							})}
						/>
					)}
					{props.branch === true && index === props.branches.length - 1 && (
						<span className="border-muted-foreground absolute top-1.75 right-0.75 left-1.25 border-t lg:top-1/2" />
					)}
				</span>
			))}
		</span>
	)
}

function LogEntry(props: {entry: Entry; branches?: boolean[]; offset?: number}) {
	const severity = props.entry.payload['severityNumber']
	return (
		<div className="bg-muted relative mx-px flex border-b px-3 text-xs" data-log={props.entry.id}>
			<TreePrefix branches={props.branches ?? []} />
			<div className="flex min-w-0 flex-1 items-start gap-1.5 py-1.5">
				{props.entry.status === 2 && (
					<CircleAlert className="text-destructive size-3 shrink-0" role="img" aria-label="Error" aria-hidden={false} />
				)}
				{props.entry.status !== 2 && Predicate.isNumber(severity) && severity >= 13 && (
					<TriangleAlert className="text-warning size-3 shrink-0" role="img" aria-label="Warning" aria-hidden={false} />
				)}
				{props.entry.status !== 2 && (!Predicate.isNumber(severity) || severity < 13) && (
					<Info className="text-info size-3 shrink-0" role="img" aria-label="Info" aria-hidden={false} />
				)}
				<span className="min-w-0 flex-1 break-words whitespace-pre-wrap">{props.entry.name}</span>
			</div>
			{props.offset !== undefined && (
				<span className="text-muted-foreground ml-3 w-16 shrink-0 py-1.5 text-right tabular-nums lg:w-22 lg:border-l lg:px-3">
					{formatDuration(props.offset)}
				</span>
			)}
		</div>
	)
}

function spanError(span: TraceSpan) {
	if (Schema.is(Schema.Struct({message: Schema.String}))(span.payload['status'])) return span.payload['status'].message
	return ''
}

function SpanEvent(props: {event: NonNullable<SpanDetails['events']>[number]; span: TraceSpan}) {
	const values = attributes(props.event)
	return Option.match(Option.liftPredicate(values['exception.stacktrace'], String.isString), {
		onNone: () => (
			<div className="min-w-0">
				<p className="text-muted-foreground px-2 text-xs">
					{props.event.name} ·{' '}
					{formatDuration(props.span.offsetMs + durationMs(props.span.time, props.event.timeUnixNano))}
				</p>
				<Code
					lang="json"
					className="text-xs [&_pre]:m-0 [&_pre]:px-2 [&_pre]:py-1 [&_pre]:break-words [&_pre]:whitespace-pre-wrap"
				>
					{displayValue(values)}
				</Code>
			</div>
		),
		onSome: stack => {
			const extra = Record.filter(
				values,
				(value, key) =>
					key !== 'exception.stacktrace' &&
					(!Array.contains(['exception.type', 'exception.message'], key) ||
						!String.isString(value) ||
						!String.includes(value)(stack))
			)
			return (
				<div className="min-w-0">
					<Code className="text-xs [&_pre]:m-0 [&_pre]:px-2 [&_pre]:py-1 [&_pre]:break-words [&_pre]:whitespace-pre-wrap">
						{stack}
					</Code>
					{!Record.isEmptyRecord(extra) && (
						<Code
							lang="json"
							className="text-xs [&_pre]:m-0 [&_pre]:px-2 [&_pre]:py-1 [&_pre]:break-words [&_pre]:whitespace-pre-wrap"
						>
							{displayValue(extra)}
						</Code>
					)}
				</div>
			)
		}
	})
}

function SpanExtras(props: {span: TraceSpan}) {
	if (!Schema.is(SpanDetails)(props.span.payload)) return null
	const values = attributes(props.span.payload)
	return (
		<div className="flex min-w-0 flex-1 flex-col gap-1 py-2 pl-3">
			{!Record.isEmptyRecord(values) && (
				<Code
					lang="json"
					className="min-w-0 text-xs [&_pre]:m-0 [&_pre]:px-2 [&_pre]:py-1 [&_pre]:break-words [&_pre]:whitespace-pre-wrap"
				>
					{displayValue(values)}
				</Code>
			)}
			{Array.map(props.span.payload.events ?? [], (event, index) => (
				<SpanEvent key={index} event={event} span={props.span} />
			))}
			{!Array.isReadonlyArrayEmpty(props.span.payload.links ?? []) && (
				<Code
					lang="json"
					className="text-xs [&_pre]:m-0 [&_pre]:px-2 [&_pre]:py-1 [&_pre]:break-words [&_pre]:whitespace-pre-wrap"
				>
					{displayValue({
						links: Array.map(props.span.payload.links ?? [], link => ({
							attributes: attributes(link),
							spanId: link.spanId,
							traceId: link.traceId
						}))
					})}
				</Code>
			)}
			{Record.isEmptyRecord(values) &&
				Array.isReadonlyArrayEmpty(props.span.payload.events ?? []) &&
				Array.isReadonlyArrayEmpty(props.span.payload.links ?? []) && (
					<p className="text-muted-foreground px-2 text-xs">No additional attributes.</p>
				)}
		</div>
	)
}

function SpanRow(props: {
	span: TraceSpan
	parent?: TraceSpan
	previous?: TraceSpan
	extent: number
	branches: boolean[]
	hasChildren: boolean
	selected: boolean
	onSelect: (id: string) => void
}) {
	const scale = Boolean.match(props.extent > 0, {onFalse: () => 1, onTrue: () => props.extent})
	const handoff =
		props.parent === undefined ||
		props.parent.service !== props.span.service ||
		props.previous?.service !== props.span.service
	const continuations = Boolean.match(props.hasChildren, {
		onFalse: () => props.branches,
		onTrue: () => [...props.branches, true]
	})
	return (
		<Collapsible open={props.selected} onOpenChange={() => props.onSelect(props.span.spanId)}>
			<div className="flex border-b">
				<CollapsibleTrigger
					render={<Button variant="ghost" className="group h-auto w-full p-0 text-left whitespace-normal" />}
					aria-label={`Inspect ${props.span.name}`}
				>
					<div
						className="flex w-full min-w-0 flex-wrap items-start lg:flex-nowrap lg:items-center"
						data-span={props.span.spanId}
					>
						<div className="order-1 flex min-w-0 flex-1 flex-col px-3 pt-2 lg:w-80 lg:flex-none lg:py-0">
							<div className="relative flex min-h-4 min-w-0 items-center lg:min-h-8">
								<TreePrefix branches={props.branches} branch />
								<SpanName name={props.span.name} />
								{props.span.status === 2 && (
									<CircleAlert
										className="text-destructive ml-1.5 size-3 shrink-0"
										role="img"
										aria-label="Error"
										aria-hidden={false}
									/>
								)}
							</div>
							{handoff && (
								<div className="flex min-w-0 items-center text-xs lg:hidden">
									<span className="invisible flex shrink-0" aria-hidden>
										<TreePrefix branches={props.branches} />
									</span>
									<RuntimeLabel service={{name: props.span.service, runtime: props.span.runtime}} />
								</div>
							)}
						</div>
						<div className="order-2 hidden h-8 w-44 shrink-0 items-center border-l px-3 lg:flex">
							{handoff && <RuntimeLabel service={{name: props.span.service, runtime: props.span.runtime}} />}
						</div>
						<div
							className="order-4 flex w-full min-w-0 items-center px-3 pt-1 pb-2 lg:order-3 lg:h-8 lg:w-auto lg:flex-1 lg:border-l lg:py-0"
							data-timing
						>
							<svg
								className="size-2 w-full min-w-0 shrink-0"
								viewBox="0 0 1000 8"
								preserveAspectRatio="none"
								role="img"
								aria-label={`${props.span.name}: ${formatDuration(props.span.offsetMs)} offset, ${formatDuration(props.span.durationMs)} duration`}
							>
								<rect
									x={(props.span.offsetMs / scale) * 1000}
									y={0}
									width={Number.max(2, (props.span.durationMs / scale) * 1000)}
									height={8}
									className={barClass(props.span.runtime, props.span.status)}
								/>
							</svg>
						</div>
						<span
							className="order-2 flex w-22 shrink-0 items-center justify-end gap-1 pt-2 pr-3 pl-2 text-xs tabular-nums lg:order-4 lg:h-8 lg:border-l lg:py-0"
							data-duration
						>
							<ChevronDown className="text-muted-foreground size-3 shrink-0 -rotate-90 group-aria-expanded:rotate-0" />
							{formatDuration(props.span.durationMs)}
						</span>
					</div>
				</CollapsibleTrigger>
			</div>
			{props.span.status === 2 &&
				!Array.some(props.span.logs, log => log.status === 2) &&
				String.isNonEmpty(spanError(props.span)) && (
					<div className="text-destructive flex border-b px-3 text-xs">
						<TreePrefix branches={continuations} />
						<p className="py-1">{spanError(props.span)}</p>
					</div>
				)}
			{Array.map(props.span.logs, log => (
				<LogEntry
					key={log.id}
					entry={log}
					branches={continuations}
					offset={props.span.offsetMs + durationMs(props.span.time, log.time)}
				/>
			))}
			<CollapsibleContent className="bg-muted border-b">
				<div className="mx-px flex min-w-0 px-3" data-span-details={props.span.spanId}>
					<TreePrefix branches={continuations} />
					<SpanExtras span={props.span} />
				</div>
			</CollapsibleContent>
		</Collapsible>
	)
}

function TraceDetail(props: {
	id: string
	expanded: Search['expanded']
	onBack: () => void
	onSelect: (id: string) => void
}) {
	const trace = useAtomSuspense(traceAtom(props.id)).value
	const title = Option.match(Array.head(trace.spans), {onNone: () => 'Waiting for spans', onSome: span => span.name})
	const missing = Array.filter(
		trace.spans,
		span => span.parentSpanId !== '' && !Array.some(trace.spans, parent => parent.spanId === span.parentSpanId)
	)
	return (
		<section className="flex min-h-0 min-w-0 flex-1 flex-col">
			<header className="flex items-center gap-2 border-b px-3 py-2">
				<Button aria-label="Back to traces" variant="ghost" size="icon" onClick={props.onBack}>
					<ArrowLeft />
				</Button>
				<div className="flex min-w-0 flex-1 flex-wrap items-center gap-x-3 gap-y-1">
					<h1 className="text-sm break-words">{title}</h1>
					<span className="text-muted-foreground text-xs tabular-nums">{formatDuration(trace.durationMs)}</span>
					<span className="text-muted-foreground text-xs">{trace.spans.length} spans</span>
				</div>
				<Button
					aria-label="Copy trace ID"
					variant="ghost"
					size="icon"
					onClick={() => navigator.clipboard.writeText(props.id)}
				>
					<Copy />
				</Button>
			</header>
			<div
				className="text-muted-foreground mx-px flex h-8 shrink-0 items-center border-b text-xs tabular-nums"
				aria-label="Trace timeline scale"
			>
				<span className="hidden w-80 shrink-0 px-3 lg:block">Operation</span>
				<span className="hidden w-44 shrink-0 border-l px-3 lg:block">Service</span>
				<div className="flex min-w-0 flex-1 justify-between px-3 lg:border-l">
					<span>0 ms</span>
					<span>{formatDuration(trace.durationMs)}</span>
				</div>
				<span className="hidden w-22 shrink-0 border-l px-3 text-right lg:block">Duration</span>
			</div>
			<div className="min-h-0 flex-1 overflow-auto" data-scroll-restoration-id="trace-detail">
				{!Array.isReadonlyArrayEmpty(missing) && (
					<p className="text-muted-foreground border-b px-3 py-2 text-xs">
						{missing.length} parent spans not received yet.
					</p>
				)}
				{Array.map(trace.spans, (span, index) => (
					<SpanRow
						key={span.id}
						span={span}
						previous={Option.getOrUndefined(Array.get(trace.spans, index - 1))}
						parent={Option.getOrUndefined(Array.findFirst(trace.spans, parent => parent.spanId === span.parentSpanId))}
						extent={trace.durationMs}
						branches={treeBranches(trace.spans, span)}
						hasChildren={Array.some(trace.spans, child => child.parentSpanId === span.spanId)}
						selected={Array.contains(props.expanded, span.spanId)}
						onSelect={props.onSelect}
					/>
				))}
				{!Array.isReadonlyArrayEmpty(trace.logs) && (
					<div>
						<p className="text-muted-foreground px-3 py-2 text-xs">Logs waiting for their span</p>
						{Array.map(trace.logs, log => (
							<LogEntry key={log.id} entry={log} />
						))}
					</div>
				)}
				{Array.isReadonlyArrayEmpty(trace.spans) && Array.isReadonlyArrayEmpty(trace.logs) && (
					<p className="text-muted-foreground p-4 text-sm">
						This trace belongs to a previous app run. Choose a current trace.
					</p>
				)}
			</div>
		</section>
	)
}

function TraceResults(props: {search: Search; onChange: (next: Partial<Search>) => void}) {
	const services = useAtomSuspense(servicesAtom).value
	const deferredSearch = useDeferredValue(props.search)
	return (
		<section className="flex min-h-0 min-w-0 flex-1 flex-col">
			<header className="flex flex-wrap gap-2 border-b p-3">
				<Select
					value={props.search.service}
					onValueChange={value => {
						if (value !== null) props.onChange({offset: 0, service: value})
					}}
				>
					<SelectTrigger aria-label="Service">
						<SelectValue>
							{Boolean.match(String.isNonEmpty(props.search.service), {
								onFalse: () => 'All services',
								onTrue: () => props.search.service
							})}
						</SelectValue>
					</SelectTrigger>
					<SelectContent>
						<SelectItem value="">All services</SelectItem>
						{Array.map(services, service => (
							<SelectItem key={service.name} value={service.name}>
								{service.name}
							</SelectItem>
						))}
					</SelectContent>
				</Select>
				<Input
					className="min-w-40 flex-1"
					aria-label="Search traces"
					placeholder="Search traces…"
					value={props.search.query}
					onChange={event => props.onChange({offset: 0, query: event.target.value})}
				/>
			</header>
			<Suspense fallback={<p className="text-muted-foreground p-4 text-sm">Loading traces…</p>}>
				<Results search={deferredSearch} onChange={props.onChange} />
			</Suspense>
		</section>
	)
}

function Results(props: {search: Search; onChange: (next: Partial<Search>) => void}) {
	const results = useAtomSuspense(resultsAtom(props.search)).value
	return (
		<section className="flex min-h-0 min-w-0 flex-1 flex-col">
			<div className="min-h-0 flex-1 overflow-auto" data-scroll-restoration-id="telemetry-results">
				{Array.map(
					Record.toEntries(Array.groupBy(results.entries, trace => `${trace.service} / ${trace.operation}`)),
					group => (
						<div key={group[0]}>
							<header className="bg-muted/30 flex items-center justify-between gap-2 border-b px-3 py-2 text-xs">
								<span className="min-w-0 break-words">{group[0]}</span>
								<span className="text-muted-foreground shrink-0">{group[1].length}</span>
							</header>
							{Array.map(group[1], trace => (
								<Button
									key={trace.id}
									variant={Boolean.match(trace.id === props.search.trace, {
										onFalse: () => 'ghost',
										onTrue: () => 'secondary'
									})}
									className="h-auto w-full justify-start border-b px-3 py-2 text-left whitespace-normal"
									onClick={() => props.onChange({expanded: [], trace: trace.id})}
									aria-label={`Open ${trace.operation} ${trace.id}`}
								>
									<div className="w-full min-w-0">
										<div className="flex items-center justify-between gap-3 text-sm">
											<span className="text-muted-foreground text-xs">
												{pipe(
													DateTime.make(durationMs('0', trace.time)),
													Option.map(DateTime.formatLocal({hour: '2-digit', minute: '2-digit', second: '2-digit'})),
													Option.getOrElse(() => trace.time)
												)}
											</span>
											<span className="tabular-nums">{formatDuration(trace.durationMs)}</span>
										</div>
										<div className="mt-1 flex flex-wrap items-center gap-2 text-xs">
											{Array.map(trace.services, service => (
												<RuntimeLabel key={service.name} service={service} />
											))}
											{trace.errors > 0 && (
												<CircleAlert
													className="text-destructive size-3 shrink-0"
													role="img"
													aria-label="Trace contains errors"
													aria-hidden={false}
												/>
											)}
										</div>
									</div>
								</Button>
							))}
						</div>
					)
				)}
				{results.total === 0 && (
					<div className="p-6">
						<h2 className="text-sm">No current traces</h2>
						<p className="text-muted-foreground mt-2 text-xs">Run an action in your app, or clear the filters.</p>
					</div>
				)}
			</div>
			{results.total > 100 && (
				<footer className="flex items-center justify-between border-t p-2 text-xs">
					<Button
						aria-label="Previous page"
						variant="ghost"
						size="icon"
						disabled={props.search.offset === 0}
						onClick={() => props.onChange({offset: Number.max(0, props.search.offset - 100)})}
					>
						<ChevronLeft />
					</Button>
					<span>
						{props.search.offset + 1}–{Number.min(props.search.offset + 100, results.total)} of {results.total}
					</span>
					<Button
						aria-label="Next page"
						variant="ghost"
						size="icon"
						disabled={props.search.offset + 100 >= results.total}
						onClick={() => props.onChange({offset: props.search.offset + 100})}
					>
						<ChevronRight />
					</Button>
				</footer>
			)}
		</section>
	)
}

function Home() {
	const search = Route.useSearch()
	const navigate = Route.useNavigate()
	function change(next: Partial<Search>) {
		return navigate({resetScroll: false, search: previous => ({...previous, ...next})})
	}
	return (
		<main className="flex min-h-0 flex-1 flex-col">
			<Suspense fallback={<p className="text-muted-foreground p-4 text-sm">Loading traces…</p>}>
				{Boolean.match(search.trace !== undefined, {
					onFalse: () => <TraceResults search={search} onChange={change} />,
					onTrue: () =>
						search.trace !== undefined && (
							<TraceDetail
								id={search.trace}
								expanded={search.expanded}
								onBack={() => change({expanded: [], trace: undefined})}
								onSelect={id =>
									change({
										expanded: Boolean.match(Array.contains(search.expanded, id), {
											onFalse: () => [...search.expanded, id],
											onTrue: () => Array.filter(search.expanded, span => span !== id)
										})
									})
								}
							/>
						)
				})}
			</Suspense>
		</main>
	)
}
