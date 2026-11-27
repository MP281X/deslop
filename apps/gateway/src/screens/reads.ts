import {Context, Layer, Stream, pipe} from 'effect'

import {Atom, AtomRegistry, AtomRpc} from 'effect/reactivity'
import type {AsyncResult} from 'effect/reactivity'

import {liveAtom} from '@deslop/runtime/client/live-stream'
import type {layerSocketProtocol} from '@deslop/runtime/client/protocol'
import type {AuthError} from '@deslop/runtime/shared/auth'
import {RpcStream} from '@deslop/runtime/shared/rpc'
import type {Account} from '@deslop/runtime/shared/schema'
import type {TimeFrame} from '@deslop/runtime/shared/time'

import {GatewayRpcs} from '#contracts'

function reads(
	protocol: ReturnType<typeof layerSocketProtocol>,
	account: Atom.Atom<AsyncResult.AsyncResult<Account, AuthError>>
) {
	const credentials = Atom.make(0)
	class Client extends AtomRpc.Service<Client>()('Gateway/Rpc', {
		group: GatewayRpcs.middleware(RpcStream),
		protocol: get => {
			get(credentials)
			return Layer.fresh(protocol)
		}
	}) {}

	return {
		account,
		credentials,
		runtime: Client.runtime,
		client: Client,
		keys: liveAtom(Client, 'ai-proxy.key'),
		servers: liveAtom(Client, 'connections.watch'),
		aiUsage: Atom.family((period: TimeFrame) => liveAtom(Client, 'ai-metering.usage', period)),
		mcpUsage: Atom.family((period: TimeFrame) => liveAtom(Client, 'connections.usage', period))
	}
}

export class GatewayReads extends Context.Service<GatewayReads, ReturnType<typeof reads>>()('Gateway/Reads') {
	static layer(
		protocol: ReturnType<typeof layerSocketProtocol>,
		account: Atom.Atom<AsyncResult.AsyncResult<Account, AuthError>>
	) {
		return Layer.succeed(this, reads(protocol, account))
	}
}

export function observe<A, M>(pick: (reads: ReturnType<typeof reads>) => Atom.Atom<A>, read: (value: A) => M) {
	return Stream.unwrap(
		GatewayReads.useSync(reads =>
			Stream.unwrap(
				AtomRegistry.AtomRegistry.useSync(registry =>
					pipe(registry, AtomRegistry.toStream(pick(reads)), Stream.map(read))
				)
			)
		)
	)
}
