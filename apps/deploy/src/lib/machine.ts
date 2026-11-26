import {Effect, Option, Schema} from 'effect'

import {Atom, AtomRegistry, AtomRpc} from 'effect/reactivity'

import {liveAtom} from '@deslop/runtime/client/live-stream'
import {RpcStream} from '@deslop/runtime/shared/rpc'
import {addPageTelemetry, layerPageProtocol} from '@deslop/runtime/web/client'

import {HOUR} from '#routes/(home)/-chart.ts'
import {RpcContracts} from '#rpcs/contracts.ts'
import {ExposeInput} from '#services/exposures/schema.ts'
import {AppId, RunRequest} from '#services/inventory/schema.ts'

addPageTelemetry('@deslop/deploy')

class RpcClient extends AtomRpc.Service<RpcClient>()('@deslop/deploy/lib/machine/RpcClient', {
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

const operationAtom = RpcClient.runtime.fn((operation: Operation) =>
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

export const execute = Effect.fnUntraced(function* (registry: AtomRegistry.AtomRegistry, operation: Operation) {
	registry.set(operationAtom, operation)
	return yield* AtomRegistry.getResult(registry, operationAtom, {suspendOnWaiting: true})
})
