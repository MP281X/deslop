import {Schema} from 'effect'

import {Rpc, RpcGroup} from 'effect/rpc'

import {AuthError} from '@deslop/runtime/auth/schema'
import {RpcAuth} from '@deslop/runtime/auth/utils'

import {DeployError, ExposeRequest, HideRequest, Snapshot} from '#services/inventory/schema.ts'
import {HistoryQuery, MachineHistory} from '#services/metrics/schema.ts'

export class RpcContracts extends RpcGroup.make(
	Rpc.make('deploy.metrics', {
		error: Schema.Union([AuthError, DeployError]),
		payload: HistoryQuery,
		stream: true,
		success: Schema.Array(MachineHistory)
	}),
	Rpc.make('deploy.history', {
		error: Schema.Union([AuthError, DeployError]),
		payload: HistoryQuery,
		success: MachineHistory
	}),
	Rpc.make('deploy.inventory', {error: Schema.Union([AuthError, DeployError]), stream: true, success: Snapshot}),
	Rpc.make('deploy.snapshot', {error: Schema.Union([AuthError, DeployError]), success: Snapshot}),
	Rpc.make('deploy.expose', {
		error: Schema.Union([AuthError, DeployError]),
		payload: ExposeRequest,
		success: Schema.String
	}),
	Rpc.make('deploy.hide', {error: Schema.Union([AuthError, DeployError]), payload: HideRequest})
).middleware(RpcAuth) {}
