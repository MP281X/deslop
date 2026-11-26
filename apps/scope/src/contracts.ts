import {DateTime, Schema, String, pipe} from 'effect'

import {Rpc, RpcGroup} from 'effect/rpc'

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

export class TelemetryRpc extends RpcGroup.make(
	Rpc.make('telemetry.watch', {error: TelemetryError, payload: TimeFrame, stream: true, success: Overview}),
	Rpc.make('telemetry.trace', {
		error: TelemetryError,
		payload: Schema.Struct({id: TraceId}),
		stream: true,
		success: TraceTree
	})
).middleware(RpcAuth) {}
