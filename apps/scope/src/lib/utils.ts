import {Clock, Effect, Stream, pipe} from 'effect'

import {Atom, AtomRpc} from 'effect/reactivity'

import * as WebRuntime from '@deslop/runtime/web'

import {RpcContracts} from '#rpcs/contracts.ts'
import {Query} from '#services/telemetry/schema.ts'
import type {Search} from '#services/telemetry/schema.ts'

class RpcClient extends AtomRpc.Service<RpcClient>()('@deslop/scope/lib/utils/RpcClient', {
	disableTracing: true,
	group: RpcContracts,
	protocol: WebRuntime.layer('@deslop/scope')
}) {}

// One connection owns live updates; searches and trace details depend on its revision.
const revisionAtom = Atom.keepAlive(
	RpcClient.runtime.atom(
		pipe(
			Effect.map(RpcClient, client => client('telemetry.watch', undefined)),
			Stream.unwrap
		)
	)
)

export const resultsAtom = Atom.family((search: Search) =>
	RpcClient.runtime.atom(get =>
		Effect.gen(function* () {
			yield* get.result(revisionAtom)
			const now = yield* Clock.currentTimeMillis
			return yield* (yield* RpcClient)(
				'telemetry.traces',
				Query.make({
					errors: false,
					from: 0,
					limit: 100,
					offset: search.offset,
					operation: '',
					service: search.service,
					sort: 'recent',
					text: search.query,
					to: now,
					traceId: ''
				})
			)
		})
	)
)

export const servicesAtom = RpcClient.runtime.atom(get =>
	Effect.gen(function* () {
		yield* get.result(revisionAtom)
		return yield* (yield* RpcClient)('telemetry.services', undefined)
	})
)

export const traceAtom = Atom.family((id: string) =>
	RpcClient.runtime.atom(get =>
		Effect.gen(function* () {
			yield* get.result(revisionAtom)
			return yield* (yield* RpcClient)('telemetry.trace', id)
		})
	)
)
