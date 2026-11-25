import {Schema} from 'effect'

import {Rpc, RpcGroup} from 'effect/rpc'

import {AuthError, RpcAdmin, RpcAuth} from '@deslop/runtime/shared/auth'

import {ExposeInput, HideRequest} from '#services/exposures/schema.ts'
import {DeployError, RunRequest, Snapshot} from '#services/inventory/schema.ts'
import {HistoryQuery, MachineHistory} from '#services/metrics/schema.ts'

export class RpcContracts extends RpcGroup.make(
	Rpc.make('metrics.watch', {
		error: Schema.Union([AuthError, DeployError]),
		payload: HistoryQuery,
		stream: true,
		success: MachineHistory
	}),
	Rpc.make('inventory.watch', {error: Schema.Union([AuthError, DeployError]), stream: true, success: Snapshot}),
	Rpc.make('exposures.expose', {
		error: Schema.Union([AuthError, DeployError]),
		payload: ExposeInput,
		success: Schema.String
	}).middleware(RpcAdmin),
	Rpc.make('exposures.hide', {error: Schema.Union([AuthError, DeployError]), payload: HideRequest}).middleware(
		RpcAdmin
	),
	Rpc.make('inventory.run', {error: Schema.Union([AuthError, DeployError]), payload: RunRequest}).middleware(RpcAdmin)
).middleware(RpcAuth) {}
