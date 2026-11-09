import {Array, Cause, Effect, Option, Stream, pipe} from 'effect'

import {Atom, AtomRpc} from 'effect/reactivity'

import {isDenied, withoutDeniedData} from '@deslop/runtime/auth/utils'
import * as WebRuntime from '@deslop/runtime/web'

import {RpcContracts} from '#rpcs/contracts.ts'
import type {ExposeRequest, InventoryItem, RunRequest} from '#services/inventory/schema.ts'
import type {HistoryQuery} from '#services/metrics/schema.ts'

class RpcClient extends AtomRpc.Service<RpcClient>()('@deslop/deploy/lib/utils/RpcClient', {
	group: RpcContracts,
	protocol: WebRuntime.layer()
}) {}

export const exposeTargetAtom = Atom.make(Option.none<InventoryItem>())

export const inventoryAtom = Atom.keepAlive(
	RpcClient.runtime.atom(get =>
		withoutDeniedData(
			get,
			pipe(
				RpcClient,
				Effect.map(client => client('deploy.inventory', undefined)),
				Stream.unwrap,
				Stream.tapCause(cause =>
					Effect.sync(() => {
						if (Array.some(cause.reasons, reason => Cause.isFailReason(reason) && isDenied(reason.error))) {
							get.set(exposeTargetAtom, Option.none())
						}
					})
				)
			),
			WebRuntime.reconnecting
		)
	)
)

export const exposeAtom = RpcClient.runtime.fn((input: ExposeRequest, get) =>
	pipe(
		Effect.flatMap(RpcClient, client => client('deploy.expose', input)),
		Effect.tap(() => Effect.sync(() => get.set(exposeTargetAtom, Option.none())))
	)
)

// Starts a timer's job now; keyed by the job's row, so its failure shows there.
export const runAtom = Atom.family((_id: string) =>
	RpcClient.runtime.fn((input: RunRequest) => Effect.flatMap(RpcClient, client => client('deploy.run', input)))
)

export const metricsAtom = Atom.family((minutes: HistoryQuery['minutes']) =>
	RpcClient.runtime.atom(get =>
		withoutDeniedData(
			get,
			pipe(
				RpcClient,
				Effect.map(client => client('deploy.metrics', {minutes})),
				Stream.unwrap
			),
			WebRuntime.reconnecting
		)
	)
)
