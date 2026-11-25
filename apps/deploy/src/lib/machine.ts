import {Effect, Function, Option, Stream, pipe} from 'effect'

import {Atom, AtomRpc} from 'effect/reactivity'

import {
	isDeniedCause,
	keepValueThroughOutages,
	liveAtom,
	liveStream,
	reconnectOnDrop
} from '@deslop/runtime/client/live-stream'
import {RpcStream} from '@deslop/runtime/shared/rpc'
import {addPageTelemetry, layerPageProtocol} from '@deslop/runtime/web/client'

import {RpcContracts} from '#rpcs/contracts.ts'
import type {ExposeInput} from '#services/exposures/schema.ts'
import type {InventoryItem, ItemId, RunRequest} from '#services/inventory/schema.ts'
import type {HistoryQuery} from '#services/metrics/schema.ts'

addPageTelemetry('@deslop/deploy')

class RpcClient extends AtomRpc.Service<RpcClient>()('@deslop/deploy/lib/machine/RpcClient', {
	group: RpcContracts.middleware(RpcStream),
	protocol: layerPageProtocol
}) {}

export const exposeTargetAtom = Atom.make(Option.none<InventoryItem>())

export const inventoryAtom = Atom.keepAlive(
	RpcClient.runtime.atom(get =>
		keepValueThroughOutages(
			get,
			Stream.tapCause(liveStream(RpcClient, 'inventory.watch'), cause =>
				Effect.sync(() => {
					if (isDeniedCause(cause)) get.set(exposeTargetAtom, Option.none())
				})
			),
			reconnectOnDrop
		)
	)
)

export const exposeAtom = RpcClient.runtime.fn((input: ExposeInput, get) =>
	pipe(
		RpcClient,
		Effect.flatMap(client => client('exposures.expose', input)),
		Effect.tap(() => Effect.sync(() => get.set(exposeTargetAtom, Option.none())))
	)
)

// Opens the Expose dialog on a port, clear of the last attempt's failure.
export const openExposeAtom = Atom.writable(Function.constUndefined, (context, port: InventoryItem) => {
	context.set(exposeAtom, Atom.Reset)
	context.set(exposeTargetAtom, Option.some(port))
})

// Starts a timer's job now; keyed by the job's row, so its failure shows there.
export const runAtom = Atom.family((_id: ItemId) =>
	RpcClient.runtime.fn((input: RunRequest) => Effect.flatMap(RpcClient, client => client('inventory.run', input)))
)

// Keyed by value: a query with the same range is the same stream.
export const metricsAtom = Atom.family((query: HistoryQuery) => liveAtom(RpcClient, 'metrics.watch', query))
