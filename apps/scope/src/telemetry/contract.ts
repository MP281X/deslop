import {DateTime, Option, Schema, String, Struct, pipe} from 'effect'

import {Rpc, RpcGroup} from 'effect/rpc'
import {Model} from 'effect/schema'

import {RpcAuth} from '@deslop/runtime/shared/auth'
import {
	DateTimeUtcFromFiniteMillis,
	DurationFromFiniteMillis,
	TimeFrame,
	timeFrameDuration
} from '@deslop/runtime/shared/time'

export class TelemetryError extends Schema.TaggedError<TelemetryError>()('TelemetryError', {
	cause: Schema.optional(Schema.Defect()),
	message: Schema.String
}) {}

export type TraceId = typeof TraceId.Type
export const TraceId = pipe(
	Schema.String,
	Schema.check(Schema.isPattern(/^[a-fA-F0-9]{32}$/u)),
	Schema.brand('TraceId')
)

export type SpanId = typeof SpanId.Type
export const SpanId = pipe(Schema.String, Schema.check(Schema.isPattern(/^[a-fA-F0-9]{16}$/u)), Schema.brand('SpanId'))

export type LogId = typeof LogId.Type
// The first 53 bits of a record's digest, exact in a number and usable as its row id.
export const LogId = pipe(Schema.Int, Schema.brand('ScopeLogId'))

export type ServiceName = typeof ServiceName.Type
export const ServiceName = pipe(Schema.String, Schema.brand('ScopeServiceName'))

export type AppName = typeof AppName.Type
export const AppName = pipe(Schema.String, Schema.brand('ScopeAppName'))

export type ReleaseVersion = typeof ReleaseVersion.Type
export const ReleaseVersion = pipe(Schema.String, Schema.brand('ScopeReleaseVersion'))

// The oldest start a frame holds, in epoch milliseconds.
export function rangeStart(range: TimeFrame, now: DateTime.Utc) {
	return DateTime.subtractDuration(now, timeFrameDuration(range))
}

export type Runtime = typeof Runtime.Type
export const Runtime = Schema.Literals(['web', 'mobile', 'server', 'ci', 'unknown'])

// An attribute's one value: a string, number or boolean as OTLP wrapped it, unwrapped; anything else stays as sent.
export type Attributes = typeof Attributes.Type
export const Attributes = Schema.Record(Schema.String, Schema.Json)

// The resource fields every span and log carries: who sent it, from which run of which release.
const SENDER = {
	// When the sending process started, which tells its runs apart; none when it does not say.
	run: Schema.OptionFromNullOr(Schema.DateTimeUtcFromMillis),
	runtime: Runtime,
	service: ServiceName,
	// `service.version` as sent; none for a local build.
	version: Schema.OptionFromNullOr(ReleaseVersion)
}

// One span, read from OTLP once on arrival; queries answer it with hex ids, its sender and its whole attributes.
export type Span = typeof Span.Type
export const Span = Schema.Struct({
	...SENDER,
	attributes: Schema.fromJsonString(Attributes),
	// None while the span is still open, as a running CI workflow is.
	duration: Schema.OptionFromNullOr(Schema.DurationFromMillis),
	// The status message of a failed or denied span.
	error: Schema.OptionFromNullOr(Schema.String),
	// The message of its first exception, which a failure's diagnosis prefers.
	exception: Schema.OptionFromNullOr(Schema.String),
	name: Schema.String,
	parentSpanId: Schema.OptionFromNullOr(SpanId),
	spanId: SpanId,
	// Fractional epoch milliseconds, retained by the public DateTime epoch mapping operation.
	start: DateTimeUtcFromFiniteMillis,
	// A denied span failed only on a sign-in it lacked: no count, dot or error filter includes it.
	status: Schema.Literals(['ok', 'failed', 'denied']),
	traceId: TraceId
})

// One log record; the identity of one that carries no id of its own is the digest of what it carries.
export type Log = typeof Log.Type
export const Log = Schema.Struct({
	...SENDER,
	attributes: Schema.fromJsonString(Attributes),
	id: LogId,
	message: Schema.String,
	// When its export arrived; a log that names no stored trace starts one then.
	receivedAt: Schema.DateTimeUtcFromMillis,
	// OTLP's severity number: 17 and above is an error.
	severity: Schema.Int,
	spanId: Schema.OptionFromNullOr(SpanId),
	time: DateTimeUtcFromFiniteMillis,
	traceId: Schema.OptionFromNullOr(TraceId)
})

export type OperationTrace = typeof OperationTrace.Type
export const OperationTrace = Schema.Struct({
	duration: Schema.DurationFromMillis,
	failure: Schema.OptionFromOptionalKey(
		Schema.Struct({error: Schema.OptionFromOptionalKey(Schema.String), span: Schema.String})
	),
	id: TraceId,
	label: Schema.OptionFromOptionalKey(Schema.String),
	start: DateTimeUtcFromFiniteMillis
})

// One operation as one side of the app started it: the same name from its web client and its server are two.
export type Operation = typeof Operation.Type
export const Operation = Schema.Struct({
	count: Schema.Int,
	failures: Schema.Int,
	name: Schema.String,
	p50Ms: DurationFromFiniteMillis,
	p95Ms: DurationFromFiniteMillis,
	runtime: Runtime,
	// The slowest first; an operation exists because a trace started it, so it keeps at least that one.
	traces: Schema.NonEmptyArray(OperationTrace)
})

export type Overview = typeof Overview.Type
export const Overview = Schema.Struct({
	apps: Schema.Array(
		Schema.Struct({
			ci: Schema.OptionFromOptionalKey(Schema.Boolean),
			name: AppName,
			operations: Schema.Array(Operation)
		})
	)
})

// A span as the trace view draws it: its row, where it sits in the tree and the timeline, and its logs. A linked trace's root hangs under the span it links to.
export type TraceSpan = typeof TraceSpan.Type
export const TraceSpan = Schema.Struct({
	...Span.fields,
	depth: Schema.Natural,
	durationMs: DurationFromFiniteMillis,
	logs: Schema.Array(Log),
	offsetMs: DurationFromFiniteMillis
})

// A trace and every trace a span link joins to it, as one tree in start order.
export type TraceTree = typeof TraceTree.Type
export const TraceTree = Schema.Struct({
	durationMs: DurationFromFiniteMillis,
	failureSpanId: Schema.OptionFromOptionalKey(SpanId),
	id: TraceId,
	// Logs of the trace that name no span it holds.
	logs: Schema.Array(Log),
	spans: Schema.Array(TraceSpan)
})

export function appName(service: ServiceName) {
	return AppName.make(pipe(service, String.replace(/^@deslop\//u, ''), String.replace(/-(?:server|client|ios)$/u, '')))
}

export type TraceIds = typeof TraceIds.Type
// Trace ids as one JSON parameter, however many a query names.
export const TraceIds = Schema.fromJsonString(Schema.Array(TraceId))

// A span's link into another trace: the work it started reads as part of the trace that linked it.
export type SpanLink = typeof SpanLink.Type
export const SpanLink = Schema.Struct({linkedSpanId: SpanId, linkedTraceId: TraceId, spanId: SpanId, traceId: TraceId})

export type Trace = typeof Trace.Type
// What every list reads of a trace, judged again whenever one of its spans arrives; the sender, name and label are its root's.
export const Trace = Schema.Struct({
	...Struct.pick(Span.fields, ['run', 'runtime', 'service', 'version']),
	// Where the failure broke: the earliest failed span without a failed child.
	broken: Schema.OptionFromNullOr(SpanId),
	duration: Schema.DurationFromMillis,
	id: TraceId,
	// The root's `trace.label`, which names the run a row stands for.
	label: Schema.OptionFromNullOr(Schema.String),
	name: Schema.String,
	// When its first span or log arrived; retention drops the whole trace from then.
	receivedAt: Schema.DateTimeUtcFromMillis,
	// The span it starts from: one whose parent the trace doesn't hold, the earliest if a skewed clock leaves several.
	root: SpanId,
	// Whether a span without a parent has arrived; children export first, so until then the trace may still be growing.
	rooted: Schema.Boolean,
	spans: Schema.Int,
	start: DateTimeUtcFromFiniteMillis,
	// A subscription or a machine's timer: its lifetime is a wait, not an operation's latency.
	waits: Schema.Boolean
})

// AppFilter tabs count every retained settled trace, independently of the operations' time frame.
export type RetainedService = typeof RetainedService.Type
export const RetainedService = Schema.Struct({
	ci: Schema.BooleanFromBit,
	count: Schema.Int,
	failures: Schema.Int,
	service: Span.fields.service
})

export type TraceDetail = typeof TraceDetail.Type
// What a trace's row shows beyond its numbers: its label, and the name and messages of the span where it broke.
export const TraceDetail = Schema.Struct({
	...Struct.pick(Trace.fields, ['id', 'label']),
	...Struct.pick(Span.fields, ['error', 'exception']),
	broken: Schema.OptionFromNullOr(Span.fields.name)
})

// SQL counts the whole range; only the operation's kept traces are decoded separately.
export type CountedOperation = typeof CountedOperation.Type
export const CountedOperation = Schema.Struct({
	...Struct.omit(Operation.fields, ['traces']),
	app: AppName,
	latest: Trace.fields.start
})

// The side the tools name instead of a package suffix; a resource without one falls back to its service name.
export type Side = typeof Side.Type
export const Side = Schema.Literals(['web', 'mobile', 'server', 'ci'])

// The tool's side: the resource's runtime, else the suffix its service name already carries; unknown names omit it.
export function sideOf(service: ServiceName | AppName, value: Runtime) {
	if (Schema.is(Side)(value)) return Option.some(value)
	if (String.endsWith('-server')(service)) return Option.some('server' as const)
	if (String.endsWith('-client')(service)) return Option.some('web' as const)
	if (String.endsWith('-ios')(service)) return Option.some('mobile' as const)
	return Option.none<Side>()
}

export type SpanFacts = typeof SpanFacts.Type
export const SpanFacts = Schema.Struct(
	Struct.pick(Span.fields, [
		'attributes',
		'duration',
		'name',
		'parentSpanId',
		'run',
		'runtime',
		'service',
		'spanId',
		'start',
		'status',
		'traceId',
		'version'
	])
)

export type SpanFailure = typeof SpanFailure.Type
export const SpanFailure = Schema.Struct(Struct.pick(Span.fields, ['error', 'exception']))

export class TelemetryRpcs extends RpcGroup.make(
	Rpc.make('telemetry.watch', {error: TelemetryError, payload: TimeFrame, stream: true, success: Overview}),
	Rpc.make('telemetry.trace', {
		error: TelemetryError,
		payload: Schema.Struct({id: TraceId}),
		stream: true,
		success: TraceTree
	})
).middleware(RpcAuth) {}

// The stored tables: hex ids become blobs, each sender and SQL statement is stored once, and rows name them by id.

// One sender; UNIQUE keeps NULLs apart, so its index compares an absent run or release as a marker no real one takes.
export class StoredResource extends Model.Class<StoredResource>('StoredResource')({
	id: Schema.Int,
	...Struct.pick(Span.fields, ['run', 'runtime', 'service', 'version'])
}) {
	static readonly table = 'resources'
}

// One `db.query.text`, which spans name instead of repeating it.
export class StoredStatement extends Model.Class<StoredStatement>('StoredStatement')({
	id: Schema.Int,
	text: Schema.String
}) {
	static readonly table = 'statements'
}

// A trace and what its lists show of its root, so no list reads its spans; ids rise in arrival order, so retention drops a range of them.
export class StoredTrace extends Model.Class<StoredTrace>('StoredTrace')({
	broken: Model.FieldOption(Schema.Uint8Array),
	duration: Schema.DurationFromMillis,
	end: DateTimeUtcFromFiniteMillis,
	id: Schema.Int,
	label: Model.FieldOption(Schema.String),
	name: Schema.String,
	receivedAt: Schema.DateTimeUtcFromMillis,
	resource: Schema.Int,
	root: Model.FieldOption(Schema.Uint8Array),
	rooted: Model.BooleanSqlite,
	spans: Schema.Int,
	start: DateTimeUtcFromFiniteMillis,
	// None for the logs of one export that name no trace.
	traceId: Model.FieldOption(Schema.Uint8Array),
	waits: Model.BooleanSqlite
}) {
	static readonly table = 'traces'
}

// A span with constant attribute keys and its SQL statement stripped from its attributes; its row id keys its search entry.
export class StoredSpan extends Model.Class<StoredSpan>('StoredSpan')({
	attributes: Model.JsonFromString(Attributes),
	duration: Model.FieldOption(Schema.DurationFromMillis),
	error: Model.FieldOption(Schema.String),
	exception: Model.FieldOption(Schema.String),
	id: Schema.Int,
	// Whether Auth identified its sender; an anonymous export never replaces an identified span.
	identified: Model.BooleanSqlite,
	// 0 is work, whose duration is latency; 1 a stream's lifetime, 2 a machine's timer, 3 a request no route answered.
	kind: Schema.Literals([0, 1, 2, 3]),
	name: Schema.String,
	parent: Model.FieldOption(Schema.Uint8Array),
	resource: Schema.Int,
	span: Schema.Uint8Array,
	start: DateTimeUtcFromFiniteMillis,
	statement: Model.FieldOption(Schema.Int),
	// 0 ok, 1 failed, 2 denied.
	status: Schema.Literals([0, 1, 2]),
	trace: Schema.Int
}) {
	static readonly table = 'spans'
}

// A log under the trace it names, or under its export's own trace when it names none.
export class StoredLog extends Model.Class<StoredLog>('StoredLog')({
	attributes: Model.JsonFromString(Attributes),
	id: LogId,
	// Whether Auth identified its sender; an identified export replaces an anonymous record with the same digest.
	identified: Model.BooleanSqlite,
	message: Schema.String,
	resource: Schema.Int,
	severity: Schema.Int,
	span: Model.FieldOption(Schema.Uint8Array),
	time: DateTimeUtcFromFiniteMillis,
	trace: Schema.Int
}) {
	static readonly table = 'logs'
}

// A link names the trace it points to by id, since that trace may not have arrived.
export class StoredSpanLink extends Model.Class<StoredSpanLink>('StoredSpanLink')({
	linkedSpan: Schema.Uint8Array,
	linkedTrace: Schema.Uint8Array,
	span: Schema.Uint8Array,
	trace: Schema.Int
}) {
	static readonly table = 'span_links'
}
