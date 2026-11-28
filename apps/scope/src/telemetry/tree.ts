import {Array, DateTime, Duration, Function, HashSet, Number, Option, Order, Record, String, Struct, pipe} from 'effect'

import {appName, Span} from './contract.ts'
import type {
	CountedOperation,
	Log,
	OperationTrace,
	Overview,
	RetainedService,
	SpanFacts,
	SpanFailure,
	SpanLink,
	TraceId,
	TraceTree
} from './contract.ts'

const byStart = Order.mapInput(DateTime.Order, (span: Pick<Span, 'start'>) => span.start)

// The diagnostic a failed span is remembered by: its exception's message or its status line, first line only, no stack trace.
export function diagnosis(span: SpanFailure) {
	return pipe(
		span.exception,
		Option.orElse(() => span.error),
		Option.map(message => pipe(message, String.split('\n'), Array.headNonEmpty, String.trim, String.slice(0, 300))),
		Option.filter(String.isNonEmpty)
	)
}

// How long a span ran; an open one has run no time yet.
function spanDuration(span: Pick<Span, 'duration'>) {
	return Option.getOrElse(span.duration, () => Duration.zero)
}

// Effect marks every span a failure passed through as failed, so where it broke is the failed span with no failed child.
function brokeAt<A extends SpanFacts>(spans: readonly A[]) {
	const failedSpans = Array.filter(spans, span => span.status === 'failed')
	const parents = HashSet.fromIterable(
		Array.getSomes(Array.map(failedSpans, span => Option.map(span.parentSpanId, parent => `${span.traceId}:${parent}`)))
	)
	return pipe(
		failedSpans,
		Array.filter(span => !HashSet.has(parents, `${span.traceId}:${span.spanId}`)),
		Array.match({
			onEmpty: () => Option.none<A>(),
			onNonEmpty: candidates => Option.some(Array.min(candidates, byStart))
		})
	)
}

// The span a trace starts from: one whose parent the trace doesn't hold, one sent without a parent before one whose parent is missing, the earliest if a skewed clock leaves several.
function traceRoot<A extends SpanFacts>(spans: Array.NonEmptyReadonlyArray<A>) {
	const ids = HashSet.fromIterable(Array.map(spans, span => span.spanId))
	const candidates = pipe(
		spans,
		Array.filter(span => !Option.exists(span.parentSpanId, parent => HashSet.has(ids, parent))),
		Array.match({onEmpty: () => spans, onNonEmpty: Function.identity})
	)
	return pipe(
		candidates,
		Array.filter(span => Option.isNone(span.parentSpanId)),
		Array.match({onEmpty: () => candidates, onNonEmpty: Function.identity}),
		Array.min<A>(byStart)
	)
}

// A trace's start and length, without assembling its tree.
function timingOf(spans: Array.NonEmptyReadonlyArray<SpanFacts>) {
	const start = pipe(
		spans,
		Array.map(span => span.start),
		Array.min<DateTime.Utc>(DateTime.Order)
	)
	return {
		durationMs: Array.reduce(spans, Duration.zero, (end, span) =>
			pipe(DateTime.distance(start, span.start), Duration.sum(spanDuration(span)), Duration.max(end))
		),
		start
	}
}

// Each linked trace's root hangs under the span it links to, its own link first.
function linkedParents(spans: readonly Span[], links: readonly SpanLink[]) {
	const ids = HashSet.fromIterable(Array.map(spans, span => `${span.traceId}:${span.spanId}`))
	const linksOf = Array.groupBy(links, link => `${link.traceId}:${link.spanId}`)
	return Record.fromEntries(
		Array.flatMap(Record.values(Array.groupBy(spans, span => span.traceId)), group => {
			const root = traceRoot(group)
			return pipe(
				[root, ...group],
				Array.findFirst(span =>
					pipe(
						linksOf,
						Record.get(`${span.traceId}:${span.spanId}`),
						Option.flatMap(Option.fromUndefinedOr),
						Option.getOrElse(Array.empty<SpanLink>),
						Array.findFirst(link => HashSet.has(ids, `${link.linkedTraceId}:${link.linkedSpanId}`))
					)
				),
				Option.match({
					onNone: () => [],
					onSome: link => [[`${root.traceId}:${root.spanId}`, `${link.linkedTraceId}:${link.linkedSpanId}`] as const]
				})
			)
		})
	)
}

// The spans a tree walk has still to visit, first on top.
type Pending = Option.Option<{readonly depth: number; readonly node: TreeNode; readonly rest: Pending}>

// A span in start order, with the span it hangs under when the trace holds it.
type TreeNode = {
	readonly index: number
	readonly parent: Option.Option<{readonly index: number; readonly span: Span}>
	readonly span: Span
}

function pendingOf(steps: readonly {depth: number; node: TreeNode}[], rest: Pending) {
	return Array.reduceRight(steps, rest, (tail, step) => Option.some({...step, rest: tail}))
}

// A trace and the traces its links join, as one tree in start order with each span's logs beside it.
export function traceTree(id: TraceId, spans: readonly Span[], logs: readonly Log[], links: readonly SpanLink[]) {
	const ordered = Array.sort(spans, byStart)
	const indexed = Array.map(ordered, (span, index) => ({index, span}))
	const byId = Record.fromIterableBy(indexed, item => `${item.span.traceId}:${item.span.spanId}`)
	const linked = linkedParents(ordered, links)
	function parentOf(span: Span) {
		return pipe(
			linked,
			Record.get(`${span.traceId}:${span.spanId}`),
			Option.orElse(() => Option.map(span.parentSpanId, parent => `${span.traceId}:${parent}`))
		)
	}
	const sortedLogs = Array.sort(
		logs,
		Order.mapInput(DateTime.Order, (log: Log) => log.time)
	)
	const timing = Array.match(ordered, {
		onEmpty: () => ({durationMs: Duration.zero, start: Option.map(Array.head(sortedLogs), log => log.time)}),
		onNonEmpty: retained => {
			const bounds = timingOf(retained)
			return {...bounds, start: Option.some(bounds.start)}
		}
	})
	const bySpan = pipe(
		sortedLogs,
		Array.map(log =>
			Option.map(Option.all({spanId: log.spanId, traceId: log.traceId}), ids => ({
				log,
				spanId: `${ids.traceId}:${ids.spanId}`
			}))
		),
		Array.getSomes,
		Array.groupBy(entry => entry.spanId),
		Record.map(entries => Array.map(entries, entry => entry.log))
	)
	const nodes = Array.map(
		indexed,
		item =>
			({
				...item,
				parent: pipe(
					parentOf(item.span),
					Option.flatMap(parent => Record.get(byId, parent)),
					Option.filter(parent => parent.index !== item.index)
				)
			}) satisfies TreeNode
	)
	const children = pipe(
		nodes,
		Array.flatMap(node => Option.toArray(Option.map(node.parent, parent => ({child: node, parent: parent.index})))),
		Array.groupBy(entry => `${entry.parent}`)
	)
	// One walk from the roots in start order, each span's children after it; a span whose parents loop through links starts its own branch.
	const walk = Array.getSomes(
		Array.unfold<{pending: Pending; seen: HashSet.HashSet<number>}, Option.Option<{depth: number; node: TreeNode}>>(
			{
				pending: pendingOf(
					Array.map([...Array.filter(nodes, node => Option.isNone(node.parent)), ...nodes], node => ({depth: 0, node})),
					Option.none()
				),
				seen: HashSet.empty<number>()
			},
			state =>
				Option.map(state.pending, top => {
					if (HashSet.has(state.seen, top.node.index)) return [Option.none(), {...state, pending: top.rest}] as const
					const next = pipe(
						children,
						Record.get(`${top.node.index}`),
						Option.getOrElse(() => []),
						Array.map(entry => ({depth: top.depth + 1, node: entry.child}))
					)
					return [
						Option.some(top),
						{pending: pendingOf(next, top.rest), seen: HashSet.add(state.seen, top.node.index)}
					] as const
				})
		)
	)
	const tree = Array.flatMap(Option.toArray(timing.start), start =>
		Array.map(walk, step => ({
			...Struct.pick(step.node.span, Struct.keys(Span.fields)),
			depth: step.depth,
			durationMs: spanDuration(step.node.span),
			logs: pipe(
				bySpan,
				Record.get(`${step.node.span.traceId}:${step.node.span.spanId}`),
				Option.getOrElse(Array.empty)
			),
			offsetMs: DateTime.distance(start, step.node.span.start),
			parentSpanId: Option.map(step.node.parent, parent => parent.span.spanId)
		}))
	)
	return {
		durationMs: timing.durationMs,
		failureSpanId: Option.map(brokeAt(ordered), span => span.spanId),
		id,
		logs: Array.filter(
			sortedLogs,
			log =>
				!Option.exists(Option.all({spanId: log.spanId, traceId: log.traceId}), ids =>
					Record.has(byId, `${ids.traceId}:${ids.spanId}`)
				)
		),
		spans: tree
	} satisfies TraceTree
}

// Apps with failures lead, then the busiest; each app's operations count only the traces started in the page's time frame, so a quiet app keeps its tab with no rows.
export function overviewOf(
	traces: readonly (CountedOperation & {traces: Array.NonEmptyReadonlyArray<OperationTrace>})[],
	services: readonly RetainedService[]
) {
	const operations = pipe(
		traces,
		Array.groupBy(item => item.app),
		Record.map(group =>
			pipe(
				group,
				Array.sort(
					pipe(
						Order.flip(Order.Boolean),
						Order.mapInput((item: CountedOperation) => item.failures > 0),
						Order.combine(Order.mapInput(Order.flip(DateTime.Order), (item: CountedOperation) => item.latest))
					)
				),
				Array.map(item => Struct.omit(item, ['app', 'latest']))
			)
		)
	)
	return {
		apps: pipe(
			Record.values(Array.groupBy(services, item => appName(item.service))),
			Array.map(group => ({
				ci: Option.some(Array.every(group, item => item.ci)),
				count: Number.sumAll(Array.map(group, item => item.count)),
				failures: Number.sumAll(Array.map(group, item => item.failures)),
				name: appName(Array.headNonEmpty(group).service)
			})),
			Array.sort(
				pipe(
					Order.flip(Order.Number),
					Order.mapInput((app: {failures: number; count: number}) => app.failures),
					Order.combine(Order.mapInput(Order.flip(Order.Number), (app: {failures: number; count: number}) => app.count))
				)
			),
			Array.map(app => ({
				ci: app.ci,
				name: app.name,
				operations: pipe(
					operations,
					Record.get(app.name),
					Option.getOrElse(() => [])
				)
			}))
		)
	} satisfies Overview
}
