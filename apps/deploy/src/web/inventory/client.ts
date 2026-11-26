import {Effect, Option, Schema} from 'effect'

import {Atom, AtomRpc} from 'effect/reactivity'

import {liveAtom} from '@deslop/runtime/client/live-stream'
import {RpcStream} from '@deslop/runtime/shared/rpc'
import {layerPageProtocol} from '@deslop/runtime/web/client'

import {RpcContracts, ExposeInput, AppId, RunRequest} from '#contracts'

import {HOUR} from '#web/inventory/chart.ts'

class RpcClient extends AtomRpc.Service<RpcClient>()('@deslop/deploy/web/inventory/client/RpcClient', {
	group: RpcContracts.middleware(RpcStream),
	protocol: layerPageProtocol
}) {}

export const inventoryAtom = liveAtom(RpcClient, 'inventory.watch')
export const metricsAtom = liveAtom(RpcClient, 'metrics.watch', {minutes: HOUR})
export const appHistoryAtom = Atom.family((id: AppId) => liveAtom(RpcClient, 'metrics.app', {id}))

export type Operation = typeof Operation.Type
export const Operation = Schema.TaggedUnion({
	Expose: {input: ExposeInput},
	Logs: {id: AppId},
	Restart: {id: AppId},
	Run: {request: RunRequest},
	Stop: {id: AppId}
})

export const operationAtom = RpcClient.runtime.fn((operation: Operation) =>
	Effect.flatMap(RpcClient, call =>
		Operation.match(operation, {
			Expose: input => Effect.as(call('exposures.expose', input.input), Option.none<string>()),
			Logs: input => Effect.asSome(call('inventory.logs', {id: input.id})),
			Restart: input => Effect.as(call('inventory.restart', {id: input.id}), Option.none<string>()),
			Run: input => Effect.as(call('inventory.run', input.request), Option.none<string>()),
			Stop: input => Effect.as(call('inventory.stop', {id: input.id}), Option.none<string>())
		})
	)
)
