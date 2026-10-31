import {Schema} from 'effect'

import {Rpc, RpcGroup} from 'effect/rpc'

import {AuthError} from '@deslop/runtime/auth/schema'
import {RpcAuth} from '@deslop/runtime/auth/utils'

import {IngestionStatus, SortFilters, TelemetryError, Trace, TraceId, TracesPage} from '#services/telemetry/schema.ts'

// The page reads what the MCP tools read: services, a page of traces, and one trace whole.
export class RpcContracts extends RpcGroup.make(
	Rpc.make('scope.services', {error: Schema.Union([AuthError, TelemetryError]), success: IngestionStatus}),
	Rpc.make('scope.traces', {
		error: Schema.Union([AuthError, TelemetryError]),
		payload: SortFilters,
		success: TracesPage
	}),
	Rpc.make('scope.trace', {
		error: Schema.Union([AuthError, TelemetryError]),
		payload: Schema.Struct({id: TraceId}),
		success: Trace
	})
).middleware(RpcAuth) {}
