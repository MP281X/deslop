import {Effect, Option, Schedule, Stream, pipe} from 'effect'

import {Atom, AtomRpc} from 'effect/reactivity'

import * as WebRuntime from '@deslop/runtime/web'

import {RpcContracts} from '#rpcs/contracts.ts'
import type {ExposeRequest, InventoryItem, RunRequest} from '#services/inventory/schema.ts'
import type {HistoryQuery} from '#services/metrics/schema.ts'

class RpcClient extends AtomRpc.Service<RpcClient>()('@deslop/deploy/lib/utils/RpcClient', {
	group: RpcContracts,
	protocol: WebRuntime.layer('@deslop/deploy')
}) {}

export const inventoryAtom = Atom.keepAlive(
	RpcClient.runtime.atom(
		pipe(
			RpcClient,
			Effect.map(client => client('deploy.inventory', undefined)),
			Stream.unwrap,
			Stream.retry($ =>
				pipe(
					$(Schedule.spaced('2 seconds')),
					Schedule.while(metadata => metadata.input._tag === 'RpcClientError')
				)
			)
		)
	)
)

// The port whose Expose dialog is open, from a click on its badge on the app's row.
export const exposeTargetAtom = Atom.make(Option.none<InventoryItem>())

// A port exposed closes the dialog: its endpoint replaces the port's badge.
export const exposeAtom = RpcClient.runtime.fn((input: ExposeRequest, get) =>
	pipe(
		Effect.flatMap(RpcClient, client => client('deploy.expose', input)),
		Effect.tap(() => Effect.sync(() => get.set(exposeTargetAtom, Option.none())))
	)
)
export const hideAtom = Atom.family((target: string) =>
	Atom.family((name: string) =>
		RpcClient.runtime.fn(() => Effect.flatMap(RpcClient, client => client('deploy.hide', {name, target})))
	)
)

// Starts a timer's job now; keyed by the job's row, so its failure shows there.
export const runAtom = Atom.family((_id: string) =>
	RpcClient.runtime.fn((input: RunRequest) => Effect.flatMap(RpcClient, client => client('deploy.run', input)))
)

export const metricsAtom = Atom.family((minutes: HistoryQuery['minutes']) =>
	RpcClient.runtime.atom(
		pipe(
			RpcClient,
			Effect.map(client => client('deploy.metrics', {minutes})),
			Stream.unwrap,
			Stream.retry($ =>
				pipe(
					$(Schedule.spaced('2 seconds')),
					Schedule.while(metadata => metadata.input._tag === 'RpcClientError')
				)
			)
		)
	)
)
