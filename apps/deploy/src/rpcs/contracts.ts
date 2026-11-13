import {Schema} from 'effect'

import {Rpc, RpcGroup} from 'effect/rpc'

import {AuthError, RpcAuth} from '@deslop/runtime/shared/auth'

import {ExposeRequest, HideRequest} from '#services/exposures/schema.ts'
import {DeployError, RunRequest, Snapshot} from '#services/inventory/schema.ts'
import {HistoryQuery, MachineHistory} from '#services/metrics/schema.ts'

export class RpcContracts extends RpcGroup.make(
	Rpc.make('metrics.watch', {
		error: Schema.Union([AuthError, DeployError]),
		payload: HistoryQuery,
		stream: true,
		success: Schema.Array(MachineHistory)
	}),
	Rpc.make('metrics.history', {
		error: Schema.Union([AuthError, DeployError]),
		payload: HistoryQuery,
		success: MachineHistory
	}),
	Rpc.make('inventory.watch', {error: Schema.Union([AuthError, DeployError]), stream: true, success: Snapshot}),
	Rpc.make('inventory.snapshot', {error: Schema.Union([AuthError, DeployError]), success: Snapshot}),
	Rpc.make('exposures.expose', {
		error: Schema.Union([AuthError, DeployError]),
		payload: ExposeRequest,
		success: Schema.String
	}),
	Rpc.make('exposures.hide', {error: Schema.Union([AuthError, DeployError]), payload: HideRequest}),
	Rpc.make('inventory.run', {error: Schema.Union([AuthError, DeployError]), payload: RunRequest})
).middleware(RpcAuth) {}
