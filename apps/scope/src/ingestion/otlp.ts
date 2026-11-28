import {
	Array,
	Boolean,
	DateTime,
	Duration,
	Function,
	HashMap,
	Number,
	Option,
	Predicate,
	Record,
	Schema,
	String,
	pipe
} from 'effect'

import {Nano} from './contract.ts'
import type {Attribute, ExportedLog, ExportedSpan, Origin, Resource, TracesRequest} from './contract.ts'

import {ReleaseVersion, Runtime, ServiceName, SpanId, TraceId, appName} from '#telemetry/contract.ts'
import type {Attributes, Log, LogId, Span} from '#telemetry/contract.ts'

// A GitHub repository's full name, as GitHub Actions runs are stored under.
const REPOSITORY = /^[A-Za-z\d][A-Za-z\d-]{0,38}\/[\w.-]{1,100}$/u

// An OTLP attribute's one primitive value, unwrapped; an integer past what a number holds exactly stays the string OTLP sent.
function primitiveOf(value: unknown) {
	if (Predicate.isString(value) || Predicate.isNumber(value) || Predicate.isBoolean(value)) return Option.some(value)
	if (value === null || !Predicate.isObject(value) || Array.isArray(value)) return Option.none<Schema.Json>()
	const integer = value['intValue']
	if (Predicate.isNumber(integer)) return Option.some(integer)
	if (Predicate.isString(integer)) {
		return Option.some(
			pipe(
				Number.parse(integer),
				Option.filter(parsed => Math.abs(parsed) <= 2 ** 53 - 1),
				Option.getOrElse(() => integer)
			)
		)
	}
	const double = value['doubleValue']
	if (Predicate.isNumber(double)) return Option.some(double)
	const bool = value['boolValue']
	if (Predicate.isBoolean(bool)) return Option.some(bool)
	const string = value['stringValue']
	if (Predicate.isString(string)) return Option.some(string)
	return Option.none<Schema.Json>()
}

// OTLP's attribute list as one object, each primitive unwrapped; an array or map keeps the shape OTLP sent.
function attributesOf(attributes: readonly Attribute[]) {
	return Record.fromIterableWith(
		attributes,
		attribute => [attribute.key, Option.getOrElse(primitiveOf(attribute.value), () => attribute.value)] as const
	)
}

function textOf(attributes: Attributes, key: string) {
	return pipe(attributes, Record.get(key), Option.filter(Predicate.isString))
}

function resourceText(resource: Option.Option<Resource>, key: string) {
	return pipe(
		resource,
		Option.flatMap(value => value.attributes),
		Option.map(attributesOf),
		Option.flatMap(attributes => textOf(attributes, key))
	)
}

// Effect names an HTTP span by its method alone: its route, or a client's path, says which request it was; unrouted server hits, mostly scanners, share one name. A machine step is named for its source.
function spanName(span: ExportedSpan, attributes: Attributes) {
	const name = Option.getOrElse(span.name, Function.constant(''))
	if (name === '') return name
	if (name === 'Machine.invoke') {
		return pipe(
			textOf(attributes, 'machine.invoke.source'),
			Option.filter(String.isNonEmpty),
			Option.match({onNone: () => name, onSome: source => `Machine.invoke ${source}`})
		)
	}
	if (!Option.contains(textOf(attributes, 'http.request.method'), name)) return name
	return pipe(
		textOf(attributes, 'http.route'),
		Option.filter(String.isNonEmpty),
		Option.match({
			onNone: () => {
				// OTLP's SpanKind 2 is a server answering a request.
				if (Option.contains(span.kind, 2)) return `${name} (no route)`
				return pipe(
					textOf(attributes, 'url.path'),
					Option.filter(String.isNonEmpty),
					Option.match({onNone: () => name, onSome: path => `${name} ${path}`})
				)
			},
			onSome: route => `${name} ${route}`
		})
	)
}

// The stored encoding truncates epoch nanoseconds to microseconds, then represents them as fractional milliseconds.
function instantOf(nanos: Duration.Duration) {
	return DateTime.mapEpochMillis(DateTime.makeUnsafe(0), () =>
		Duration.toMillis(Duration.micros(Duration.toNanosUnsafe(nanos) / 1000n))
	)
}

// A clock that runs fast shifts its whole group of an export: when the group's newest time is more than ten minutes past its receipt, every time in it moves back by the excess, so the newest lands at receipt and every length and offset stays as sent. One absurd time moves its whole group into the past, where a time before 1970 is stored at 1970, and the spans and logs of one trace that arrive in different exports are shifted separately, so a log can land outside its span.
export function skewOf(times: readonly Duration.Duration[], receivedAt: DateTime.Utc) {
	const received = Duration.nanos(BigInt(DateTime.toEpochMillis(receivedAt)) * 1_000_000n)
	const newest = Array.reduce(times, Duration.zero, Duration.max)
	if (Duration.isGreaterThan(newest, Duration.sum(received, Duration.minutes(10)))) {
		return Duration.subtract(newest, received)
	}
	return Duration.zero
}

function shifted(time: Duration.Duration, skew: Duration.Duration) {
	return pipe(time, Duration.subtract(skew), Duration.max(Duration.zero))
}

// Who sent a record: its service, the side it runs on, the run its process started and the release it built.
export function senderOf(resource: Option.Option<Resource>) {
	return {
		run: pipe(
			resourceText(resource, 'scope.run.started_unix_nano'),
			Option.flatMap(Schema.decodeOption(Nano)),
			Option.map(instantOf),
			Option.map(DateTime.startOf('millisecond'))
		),
		runtime: pipe(
			resourceText(resource, 'scope.runtime'),
			Option.filter(Schema.is(Runtime)),
			Option.getOrElse(Function.constant('unknown' as const))
		),
		service: ServiceName.make(
			pipe(
				resourceText(resource, 'service.name'),
				Option.filter(String.isNonEmpty),
				Option.getOrElse(Function.constant('unknown'))
			)
		),
		version: pipe(
			resourceText(resource, 'service.version'),
			Option.filter(String.isNonEmpty),
			Option.map(version => ReleaseVersion.make(version))
		)
	}
}

// The sender an export may write as, or none: only GitHub's signed webhook writes under a repository's name, as the views name the app, and an anonymous `ci` runtime is not shown as CI.
export function admittedSender(sender: ReturnType<typeof senderOf>, origin: Origin) {
	if (origin === 'github') return Option.some(sender)
	if (Option.isSome(String.match(REPOSITORY)(String.trim(appName(sender.service))))) return Option.none()
	if (origin === 'anonymous' && sender.runtime === 'ci') return Option.some({...sender, runtime: 'unknown' as const})
	return Option.some(sender)
}

// Primitive leaf values of an OTLP body, without object keys: Effect logs send an array of arguments.
function leaves(value: Schema.Json): string[] {
	if (Array.isArray<Schema.Json>(value)) return Array.flatMap(value, leaves)
	if (String.isString(value) || Predicate.isNumber(value) || Predicate.isBoolean(value)) return [`${value}`]
	if (value === null) return []
	return Array.flatMap(Record.values(value), leaves)
}

// A span is denied when every exception event is an AuthError, or its HTTP response is 401 or 403.
function deniedSpan(attributes: Attributes, exceptions: readonly Attributes[]) {
	const code = attributes['http.response.status_code']
	if (code === 401 || code === 403) return true
	return Array.match(exceptions, {
		onEmpty: Function.constFalse,
		onNonEmpty: found =>
			Array.every(found, exception => Option.contains(textOf(exception, 'exception.type'), 'AuthError'))
	})
}

// One span of one trace, however often an export names it.
function spanKey(item: {readonly span: Span}) {
	return `${item.span.traceId}:${item.span.spanId}`
}

// The record of each span that stands for one export, read in order: the last send of a span, except that a CI start never replaces that span's completion sent earlier in it. A span id sent by an app and by CI at once belongs to no sender, and such an export is not promised to end as its records sent one by one would.
function standing<A extends {readonly span: Span}>(items: readonly A[]) {
	// Whether the record standing for each span so far is a completion.
	const [, kept] = Array.mapAccum(items, HashMap.empty<string, boolean>(), (completed, item) => {
		const late =
			item.span.runtime === 'ci' &&
			Option.isNone(item.span.duration) &&
			pipe(completed, HashMap.get(spanKey(item)), Option.contains(true))
		if (late) return [completed, Option.none<A>()]
		return [HashMap.set(completed, spanKey(item), Option.isSome(item.span.duration)), Option.some(item)]
	})
	return Record.values(Record.fromIterableBy(Array.getSomes(kept), spanKey))
}

// The rows an OTLP traces export stores: one per span its origin may write, and one per link into another trace; the spans it may not write are counted.
export function spansOf(payload: TracesRequest, origin: Origin, receivedAt: DateTime.Utc) {
	const groups = pipe(
		payload.resourceSpans,
		Option.getOrElse(Array.empty),
		Array.map(group => ({
			// All spans in the group share one sender, regardless of instrumentation scope.
			sender: admittedSender(senderOf(group.resource), origin),
			spans: pipe(
				group.scopeSpans,
				Option.getOrElse(() => []),
				Array.flatMap(scope => Option.getOrElse(scope.spans, () => []))
			)
		})),
		Array.map(group => ({
			...group,
			skew: skewOf(
				Array.flatMap(group.spans, span => [span.startTimeUnixNano, ...Option.toArray(span.endTimeUnixNano)]),
				receivedAt
			)
		}))
	)

	const latest = standing(
		Array.flatMap(groups, group =>
			Option.match(group.sender, {
				onNone: () => [],
				onSome: sender =>
					Array.map(group.spans, span => {
						const attributes = attributesOf(Option.getOrElse(span.attributes, Array.empty))
						const exceptions = Option.match(span.events, {
							onNone: () => [],
							onSome: events =>
								pipe(
									events,
									Array.filter(event => event.name === 'exception'),
									Array.map(event => attributesOf(Option.getOrElse(event.attributes, () => [])))
								)
						})
						const failed = Option.exists(span.status, status => Option.contains(status.code, 2))
						const traceId = TraceId.make(String.toLowerCase(span.traceId))
						const spanId = SpanId.make(String.toLowerCase(span.spanId))
						return {
							links: pipe(
								span.links,
								Option.getOrElse(() => []),
								Array.flatMap(link =>
									Boolean.match(String.toLowerCase(link.traceId) === traceId, {
										onFalse: () => [
											{
												linkedSpanId: SpanId.make(String.toLowerCase(link.spanId)),
												linkedTraceId: TraceId.make(String.toLowerCase(link.traceId)),
												spanId,
												traceId
											}
										],
										onTrue: () => []
									})
								)
							),
							span: {
								...sender,
								attributes,
								// Subtract before rounding the start so short spans at modern epochs retain their duration.
								duration: Option.map(span.endTimeUnixNano, end =>
									pipe(
										Duration.subtract(end, span.startTimeUnixNano),
										Duration.max(Duration.zero),
										Duration.toMillis,
										Duration.millis
									)
								),
								error: pipe(
									span.status,
									Option.flatMap(status => status.message),
									Option.filter(Predicate.isString),
									Option.filter(message => failed && String.isNonEmpty(message))
								),
								exception: pipe(
									Array.head(exceptions),
									Option.flatMap(exception => textOf(exception, 'exception.message')),
									Option.filter(String.isNonEmpty)
								),
								name: spanName(span, attributes),
								parentSpanId: Option.map(span.parentSpanId, id => SpanId.make(String.toLowerCase(id))),
								spanId,
								start: instantOf(shifted(span.startTimeUnixNano, group.skew)),
								status: Boolean.match(failed, {
									onFalse: Function.constant('ok' as const),
									onTrue: () =>
										Boolean.match(deniedSpan(attributes, exceptions), {
											onFalse: Function.constant('failed' as const),
											onTrue: Function.constant('denied' as const)
										})
								}),
								traceId
							} satisfies Span
						}
					})
			})
		)
	)
	return {
		links: Array.flatMap(latest, item => item.links),
		rejected: pipe(
			groups,
			Array.filter(group => Option.isNone(group.sender)),
			Array.map(group => group.spans.length),
			Number.sumAll
		),
		spans: Array.map(latest, item => item.span)
	}
}

// A severity as OTLP's number; a record with only a text level maps onto the same scale.
function severityOf(number: Option.Option<number>, text: Option.Option<string>) {
	return Option.getOrElse(number, () => {
		const level = Option.map(text, String.toUpperCase)
		if (Option.exists(level, value => value === 'FATAL' || value === 'ERROR')) return 17
		if (Option.contains(level, 'WARN')) return 13
		if (Option.contains(level, 'INFO')) return 9
		if (Option.contains(level, 'DEBUG')) return 5
		return 0
	})
}

// When a log record says it happened: its event time, else when it was observed.
export function logTimeOf(log: ExportedLog) {
	return pipe(
		log.timeUnixNano,
		Option.filter(Duration.isPositive),
		Option.orElse(() => Option.filter(log.observedTimeUnixNano, Duration.isPositive))
	)
}

// One log record of an OTLP logs export, under the identity its digest gave it; `skew` is its group's.
export function logOf(
	sender: ReturnType<typeof senderOf>,
	log: ExportedLog,
	id: LogId,
	receivedAt: DateTime.Utc,
	skew: Duration.Duration
) {
	return {
		...sender,
		attributes: attributesOf(Option.getOrElse(log.attributes, Array.empty)),
		id,
		message: Option.match(log.body, {onNone: Function.constant(''), onSome: body => Array.join(leaves(body), ' ')}),
		receivedAt,
		severity: severityOf(log.severityNumber, log.severityText),
		spanId: Option.map(log.spanId, value => SpanId.make(String.toLowerCase(value))),
		// A record without an event time happened when it was observed, else when its export arrived.
		time: Option.match(logTimeOf(log), {onNone: () => receivedAt, onSome: nanos => instantOf(shifted(nanos, skew))}),
		traceId: Option.map(log.traceId, value => TraceId.make(String.toLowerCase(value)))
	} satisfies Log
}
