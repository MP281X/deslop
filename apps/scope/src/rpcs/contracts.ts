import {Schema} from 'effect'

import {Rpc, RpcGroup} from 'effect/rpc'

import {AuthError} from '@deslop/runtime/auth/schema'
import {RpcAuth} from '@deslop/runtime/auth/utils'

import {Overview, Range, TelemetryError, Trace, TraceId} from '#services/telemetry/schema.ts'

export class RpcContracts extends RpcGroup.make(
	Rpc.make('scope.overview', {
		error: Schema.Union([AuthError, TelemetryError]),
		payload: Range,
		stream: true,
		success: Overview
	}),
	Rpc.make('scope.trace', {
		error: Schema.Union([AuthError, TelemetryError]),
		payload: Schema.Struct({id: TraceId}),
		success: Trace
	})
).middleware(RpcAuth) {}
