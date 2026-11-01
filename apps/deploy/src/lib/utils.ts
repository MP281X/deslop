import {Effect, Schedule, Stream, pipe} from 'effect'

import {Atom, AtomRpc} from 'effect/reactivity'

import * as WebRuntime from '@deslop/runtime/web'

import {RpcContracts} from '#rpcs/contracts.ts'
import type {ExposeRequest} from '#services/inventory/schema.ts'

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

export const exposeAtom = RpcClient.runtime.fn((input: ExposeRequest) =>
	Effect.flatMap(RpcClient, client => client('deploy.expose', input))
)
export const hideAtom = Atom.family((target: string) =>
	Atom.family((name: string) =>
		RpcClient.runtime.fn(() => Effect.flatMap(RpcClient, client => client('deploy.hide', {name, target})))
	)
)
