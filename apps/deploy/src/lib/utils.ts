import {Effect, Schedule, Stream, pipe} from 'effect'

import {Atom, AtomRpc} from 'effect/reactivity'

import * as WebRuntime from '@deslop/runtime/web'

import {RpcContracts} from '#rpcs/contracts.ts'
import type {ExposeRequest} from '#services/inventory/schema.ts'
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

// The Expose dialog, opened from the app bar's button or command field.
export const exposeOpenAtom = Atom.make(false)

// A port exposed closes the dialog: its endpoint shows on the app's row.
export const exposeAtom = RpcClient.runtime.fn((input: ExposeRequest, get) =>
	pipe(
		Effect.flatMap(RpcClient, client => client('deploy.expose', input)),
		Effect.tap(() => Effect.sync(() => get.set(exposeOpenAtom, false)))
	)
)
export const hideAtom = Atom.family((target: string) =>
	Atom.family((name: string) =>
		RpcClient.runtime.fn(() => Effect.flatMap(RpcClient, client => client('deploy.hide', {name, target})))
	)
)

export const metricsAtom = Atom.family((hours: HistoryQuery['hours']) =>
	RpcClient.runtime.atom(
		pipe(
			RpcClient,
			Effect.map(client => client('deploy.metrics', {hours})),
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
