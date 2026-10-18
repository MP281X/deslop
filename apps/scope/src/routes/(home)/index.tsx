import {useAtomSuspense} from '@effect/atom-react'

import {Array, Boolean, DateTime, HashSet, Number, Option, Schema, String, pipe} from 'effect'

import {createFileRoute} from '@tanstack/react-router'
import {ArrowLeft, ChevronLeft, ChevronRight, CircleAlert} from 'lucide-react'
import {Suspense} from 'react'

import {Button} from '@deslop/components-web/ui/button'
import {Input} from '@deslop/components-web/ui/input'
import {Select, SelectContent, SelectItem, SelectTrigger, SelectValue} from '@deslop/components-web/ui/select'

import {resultsAtom, traceAtom} from '#lib/utils.ts'
import {displayValue, durationMs} from '#services/telemetry/lib/utils.ts'
import {Search} from '#services/telemetry/schema.ts'
import type {Entry} from '#services/telemetry/schema.ts'

export const Route = createFileRoute('/(home)/')({component: Home, validateSearch: Schema.toStandardSchemaV1(Search)})

function time(nanos: string) {
	return DateTime.formatLocal(
		DateTime.makeUnsafe(pipe(Number.parse(`${BigInt(nanos) / 1_000_000n}`), Option.getOrThrow)),
		{hour: '2-digit', minute: '2-digit', second: '2-digit'}
	)
}

function millis(value: number) {
	return `${value.toFixed(2)} ms`
}

function severityLabel(entry: Entry) {
	if (String.isString(entry.payload['severityText'])) return entry.payload['severityText']
	if (entry.status === 2) return 'Error'
	if (Number.isNumber(entry.payload['severityNumber'])) return `Severity ${entry.payload['severityNumber']}`
	return ''
}

function RawEntry(props: {entry: Entry; onTrace?: (id: string) => void}) {
	return (
		<div className="border-b px-4 py-3">
			<div className="text-muted-foreground mb-2 flex flex-wrap items-center gap-2 text-xs">
				<span
					className={Boolean.match(props.entry.status === 2, {onFalse: () => '', onTrue: () => 'text-destructive'})}
				>
					{severityLabel(props.entry)}
				</span>
				<span className="min-w-0 break-words">
					{props.entry.service} · {time(props.entry.time)}
				</span>
				{props.onTrace !== undefined && String.isNonEmpty(props.entry.traceId) && (
					<Button variant="link" size="xs" onClick={() => props.onTrace?.(props.entry.traceId)}>
						Open trace
					</Button>
				)}
			</div>
			<details>
				<summary className="cursor-pointer text-sm break-words">{props.entry.name}</summary>
				<pre className="mt-3 overflow-x-auto text-xs break-words whitespace-pre-wrap">
					{displayValue({
						payload: props.entry.payload,
						resource: props.entry.resource,
						resourceSchemaUrl: props.entry.resourceSchemaUrl,
						scope: props.entry.scope,
						scopeSchemaUrl: props.entry.scopeSchemaUrl
					})}
				</pre>
			</details>
		</div>
	)
}

function TraceDetail(props: {id: string; onBack: () => void}) {
	const trace = useAtomSuspense(traceAtom(props.id)).value
	const spans = Array.filter(trace.entries, entry => entry.signal === 'trace')
	const logs = Array.filter(trace.entries, entry => entry.signal === 'log')
	const first = Option.getOrElse(Array.head(spans), () => Option.getOrThrow(Array.head(trace.entries)))
	const spanIds = HashSet.fromIterable(Array.map(spans, span => span.spanId))
	const missing = Array.filter(spans, span => {
		const parent = span.payload['parentSpanId']
		return String.isString(parent) && parent !== '' && !HashSet.has(spanIds, String.toLowerCase(parent))
	})
	const extent = Array.reduce(spans, 0, (end, span) =>
		Number.max(end, durationMs(first.time, span.time) + span.durationMs)
	)
	const scale = Boolean.match(extent > 0, {onFalse: () => 1, onTrue: () => extent})
	return (
		<section className="min-w-0 flex-1 overflow-auto">
			<header className="flex items-start gap-3 border-b p-4">
				<Button aria-label="Back to search" variant="ghost" size="icon" onClick={props.onBack}>
					<ArrowLeft />
				</Button>
				<div className="min-w-0">
					<h1 className="text-lg break-words">{first.name}</h1>
					<p className="text-muted-foreground mt-1 text-xs break-all">{props.id}</p>
				</div>
			</header>
			<div className="flex flex-wrap gap-4 border-b px-4 py-3 text-sm">
				<span>{spans.length} received spans</span>
				<span>{logs.length} logs</span>
				<span>{millis(extent)} observed extent</span>
			</div>
			{!Array.isReadonlyArrayEmpty(missing) && (
				<p className="text-destructive flex items-center gap-2 border-b p-4 text-sm">
					<CircleAlert className="size-4 shrink-0" />
					{missing.length} parent spans not received
				</p>
			)}
			<div className="text-muted-foreground flex justify-between px-4 pt-4 text-xs">
				<span>Waterfall</span>
				<span>0 → {millis(extent)}</span>
			</div>
			{Array.map(spans, span => (
				<div key={span.id} className="border-b px-4 py-3">
					<div className="flex items-start justify-between gap-3 text-sm">
						<span className="min-w-0 break-words">{span.name}</span>
						<span className="shrink-0 tabular-nums">{millis(span.durationMs)}</span>
					</div>
					<div className="text-muted-foreground mt-1 flex justify-between gap-3 text-xs">
						<span className="min-w-0 break-words">{span.service}</span>
						{span.status === 2 && <span className="text-destructive">Error</span>}
					</div>
					{span.status === 2 && (
						<pre className="text-destructive mt-2 text-xs break-words whitespace-pre-wrap">
							{displayValue(span.payload['status'])}
						</pre>
					)}
					<svg
						className="mt-2 h-3 w-full"
						viewBox="0 0 1000 12"
						preserveAspectRatio="none"
						role="img"
						aria-label={`${span.name}: ${millis(span.durationMs)}`}
					>
						<rect
							x={(durationMs(first.time, span.time) / scale) * 1000}
							y={0}
							width={Number.max(1, (span.durationMs / scale) * 1000)}
							height={12}
							className={Boolean.match(span.status === 2, {
								onFalse: () => 'fill-primary',
								onTrue: () => 'fill-destructive'
							})}
						/>
					</svg>
					<details className="mt-2 text-xs">
						<summary className="text-muted-foreground cursor-pointer">OTLP fields</summary>
						<pre className="mt-2 overflow-auto break-words whitespace-pre-wrap">{displayValue(span)}</pre>
					</details>
				</div>
			))}
			{Array.isReadonlyArrayEmpty(spans) && (
				<p className="text-muted-foreground p-4 text-sm">
					No spans received yet. The trace may be sampled out or still exporting.
				</p>
			)}
			<h2 className="border-b px-4 py-3 text-sm">Correlated logs</h2>
			{Array.map(logs, log => (
				<RawEntry key={log.id} entry={log} />
			))}
			{Array.isReadonlyArrayEmpty(logs) && (
				<p className="text-muted-foreground p-4 text-sm">No correlated logs received.</p>
			)}
		</section>
	)
}

function Results(props: {search: Search; onPage: (offset: number) => void; onTrace: (id: string) => void}) {
	const results = useAtomSuspense(resultsAtom(props.search)).value
	return (
		<>
			<div className="text-muted-foreground flex items-center justify-between border-b px-4 py-2 text-xs">
				<span>
					{results.page.total} matching {results.kind}
				</span>
				<span>Live · all received data</span>
			</div>
			<div className="min-h-0 flex-1 overflow-auto" data-scroll-restoration-id="telemetry-results">
				{results.kind === 'traces' &&
					Array.map(results.page.entries, trace => (
						<Button
							key={trace.id}
							variant="ghost"
							className="h-auto w-full justify-start border-b p-4 whitespace-normal"
							onClick={() => props.onTrace(trace.id)}
						>
							<div className="flex w-full min-w-0 flex-col gap-2 text-left">
								<div className="flex justify-between gap-3">
									<span className="min-w-0 text-sm break-words">{trace.operation}</span>
									<span className="shrink-0 tabular-nums">{millis(trace.durationMs)}</span>
								</div>
								<div className="text-muted-foreground flex flex-wrap justify-between gap-2 text-xs">
									<span className="break-words">{trace.service}</span>
									<span>
										{trace.spans} spans · {time(trace.time)}
										{trace.errors > 0 && <span className="text-destructive"> · {trace.errors} errors</span>}
									</span>
								</div>
							</div>
						</Button>
					))}
				{results.kind === 'logs' &&
					Array.map(results.page.entries, log => <RawEntry key={log.id} entry={log} onTrace={props.onTrace} />)}
				{results.page.total === 0 && (
					<div className="mx-auto max-w-lg p-8">
						<h2 className="text-lg">No telemetry matches</h2>
						<p className="text-muted-foreground mt-3 text-sm">
							Clear the filters, or point your Effect OTLP/HTTP JSON exporters at this server’s /v1/traces and /v1/logs
							endpoints.
						</p>
					</div>
				)}
			</div>
			{results.page.total > 100 && (
				<footer className="flex items-center justify-between border-t p-3 text-xs">
					<Button
						aria-label="Previous page"
						variant="ghost"
						size="icon"
						disabled={props.search.offset === 0}
						onClick={() => props.onPage(Number.max(0, props.search.offset - 100))}
					>
						<ChevronLeft />
					</Button>
					<span>
						{props.search.offset + 1}–{Number.min(props.search.offset + 100, results.page.total)} of{' '}
						{results.page.total}
					</span>
					<Button
						aria-label="Next page"
						variant="ghost"
						size="icon"
						disabled={props.search.offset + 100 >= results.page.total}
						onClick={() => props.onPage(props.search.offset + 100)}
					>
						<ChevronRight />
					</Button>
				</footer>
			)}
		</>
	)
}

function Home() {
	const search = Route.useSearch()
	const navigate = Route.useNavigate()
	function change(next: Partial<Omit<Search, 'trace'>>) {
		return navigate({search: previous => ({...previous, offset: 0, trace: undefined, ...next})})
	}
	return (
		<main className="flex min-h-0 flex-1 flex-col">
			<header className="flex flex-wrap items-center gap-3 border-b px-4 py-3">
				<span className="mr-auto text-lg">scope</span>
				<Button
					variant={Boolean.match(search.kind === 'traces', {onFalse: () => 'ghost', onTrue: () => 'secondary'})}
					onClick={() => change({kind: 'traces'})}
				>
					Traces
				</Button>
				<Button
					variant={Boolean.match(search.kind === 'logs', {onFalse: () => 'ghost', onTrue: () => 'secondary'})}
					onClick={() => change({kind: 'logs'})}
				>
					Logs
				</Button>
			</header>
			{Boolean.match(search.trace !== undefined, {
				onFalse: () => (
					<>
						<div className="flex flex-wrap gap-2 border-b p-4">
							<div className="min-w-48 flex-1">
								<Input
									aria-label="Search telemetry"
									placeholder="Search operations, attributes, logs…"
									value={search.query}
									onChange={event => change({query: event.target.value})}
								/>
							</div>
							<div className="w-48">
								<Input
									aria-label="Service name"
									placeholder="All services"
									value={search.service}
									onChange={event => change({service: event.target.value})}
								/>
							</div>
							<Select
								value={search.sort}
								onValueChange={value => {
									if (value === null) return
									return change({sort: value})
								}}
							>
								<SelectTrigger aria-label="Sort results">
									<SelectValue />
								</SelectTrigger>
								<SelectContent>
									<SelectItem value="recent">Recent</SelectItem>
									<SelectItem value="slowest">Slowest</SelectItem>
								</SelectContent>
							</Select>
							<Button
								variant={Boolean.match(search.errors, {onFalse: () => 'outline', onTrue: () => 'secondary'})}
								onClick={() => change({errors: !search.errors})}
							>
								Errors
							</Button>
						</div>
						<Suspense fallback={<p className="text-muted-foreground p-4 text-sm">Loading telemetry…</p>}>
							<Results
								search={search}
								onPage={offset => change({offset})}
								onTrace={trace => navigate({search: previous => ({...previous, trace})})}
							/>
						</Suspense>
					</>
				),
				onTrue: () => (
					<Suspense fallback={<p className="text-muted-foreground p-4 text-sm">Loading trace…</p>}>
						<TraceDetail
							id={search.trace ?? ''}
							onBack={() => navigate({search: previous => ({...previous, trace: undefined})})}
						/>
					</Suspense>
				)
			})}
		</main>
	)
}
