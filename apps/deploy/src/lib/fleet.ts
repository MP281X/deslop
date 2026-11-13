import {Effect, Option, Stream, pipe} from 'effect'

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
import type {ExposeRequest} from '#services/exposures/schema.ts'
import type {InventoryItem, RunRequest} from '#services/inventory/schema.ts'
import type {HistoryQuery} from '#services/metrics/schema.ts'

addPageTelemetry('@deslop/deploy')

class RpcClient extends AtomRpc.Service<RpcClient>()('@deslop/deploy/lib/fleet/RpcClient', {
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

export const exposeAtom = RpcClient.runtime.fn((input: ExposeRequest, get) =>
	pipe(
		RpcClient,
		Effect.flatMap(client => client('exposures.expose', input)),
		Effect.tap(() => Effect.sync(() => get.set(exposeTargetAtom, Option.none())))
	)
)

// Opens the Expose dialog on a port, clear of the last attempt's failure.
export const openExposeAtom = Atom.writable(
	() => undefined,
	(context, port: InventoryItem) => {
		context.set(exposeAtom, Atom.Reset)
		context.set(exposeTargetAtom, Option.some(port))
	}
)

// Starts a timer's job now; keyed by the job's row, so its failure shows there. It stays waiting at least ten seconds, the time the inventory takes to show the job running.
export const runAtom = Atom.family((_id: string) =>
	RpcClient.runtime.fn((input: RunRequest) =>
		pipe(
			RpcClient,
			Effect.flatMap(client => client('inventory.run', input)),
			Effect.zip(Effect.sleep('10 seconds'), {concurrent: true})
		)
	)
)

export const metricsAtom = Atom.family((minutes: HistoryQuery['minutes']) =>
	liveAtom(RpcClient, 'metrics.watch', {minutes})
)
