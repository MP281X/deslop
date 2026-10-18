import {Schema} from 'effect'

import {Rpc, RpcGroup} from 'effect/rpc'

import {RpcAuth} from '@deslop/auth/utils'

import {Page, Query, Service, Stats, TelemetryError, Trace, TraceId, TracesPage} from '#services/telemetry/schema.ts'

export class RpcContracts extends RpcGroup.make(
	Rpc.make('telemetry.traces', {error: TelemetryError, payload: Query, success: TracesPage}),
	Rpc.make('telemetry.spans', {error: TelemetryError, payload: Query, success: Page}),
	Rpc.make('telemetry.logs', {error: TelemetryError, payload: Query, success: Page}),
	Rpc.make('telemetry.stats', {error: TelemetryError, payload: Query, success: Stats}),
	Rpc.make('telemetry.services', {error: TelemetryError, success: Schema.Array(Service)}),
	Rpc.make('telemetry.trace', {error: TelemetryError, payload: TraceId, success: Trace}),
	Rpc.make('telemetry.watch', {stream: true, success: Schema.Int})
).middleware(RpcAuth) {}
