import {Schema} from 'effect'

import {Rpc, RpcGroup} from 'effect/rpc'

import {AuthError, RpcAuth} from '@deslop/runtime/shared/auth'

import {Overview, Range, TelemetryError, Trace, TraceId} from '#services/telemetry/schema.ts'

export class RpcContracts extends RpcGroup.make(
	Rpc.make('telemetry.overview', {
		error: Schema.Union([AuthError, TelemetryError]),
		payload: Range,
		stream: true,
		success: Overview
	}),
	Rpc.make('telemetry.trace', {
		error: Schema.Union([AuthError, TelemetryError]),
		payload: Schema.Struct({id: TraceId}),
		success: Trace
	})
).middleware(RpcAuth) {}
