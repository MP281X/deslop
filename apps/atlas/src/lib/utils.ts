import {Effect, Schema, Stream, pipe} from 'effect'

import {Atom, AtomRpc} from 'effect/reactivity'

import {RpcStream} from '@deslop/runtime/rpc'
import * as WebRuntime from '@deslop/runtime/web'

import {RpcContracts} from '#rpcs/contracts.ts'

export type View = typeof View.Type
const View = Schema.Literals(['map', 'flow', 'couple'])

export type Search = typeof Search.Type
export const Search = Schema.Struct({
	pane: Schema.optionalKey(Schema.Literals(['files'])),
	pr: Schema.optionalKey(Schema.Finite),
	repo: Schema.optionalKey(Schema.String),
	view: Schema.optionalKey(View)
})

class RpcClient extends AtomRpc.Service<RpcClient>()('@deslop/atlas/lib/utils/RpcClient', {
	group: RpcContracts.middleware(RpcStream),
	protocol: WebRuntime.layer('@deslop/atlas')
}) {}

export const snapshotAtom = Atom.keepAlive(
	RpcClient.runtime.atom(get =>
		WebRuntime.live(
			get,
			pipe(
				RpcClient,
				Effect.map(client => client('atlas.snapshot', undefined)),
				Stream.unwrap
			)
		)
	)
)
