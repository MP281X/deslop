import {Context, Layer, Stream} from 'effect'

import {Atom, AtomRpc} from 'effect/reactivity'
import type {AsyncResult} from 'effect/reactivity'

import {observe as observeAtom} from '@deslop/runtime/client/atom'
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
	const credentialsAtom = Atom.make(0)
	class Client extends AtomRpc.Service<Client>()('Gateway/Rpc', {
		group: GatewayRpcs.middleware(RpcStream),
		protocol: get => {
			get(credentialsAtom)
			return Layer.fresh(protocol)
		}
	}) {}

	return {
		account,
		aiUsage: Atom.family((period: TimeFrame) => liveAtom(Client, 'ai-metering.usage', period)),
		client: Client,
		credentialsAtom,
		keys: liveAtom(Client, 'ai-proxy.key'),
		mcpUsage: Atom.family((period: TimeFrame) => liveAtom(Client, 'connections.usage', period)),
		runtime: Client.runtime,
		servers: liveAtom(Client, 'connections.watch')
	}
}

export class GatewayReads extends Context.Service<GatewayReads, ReturnType<typeof reads>>()(
	'@deslop/gateway/screens/reads/GatewayReads'
) {
	static layer(
		protocol: ReturnType<typeof layerSocketProtocol>,
		account: Atom.Atom<AsyncResult.AsyncResult<Account, AuthError>>
	) {
		return Layer.succeed(this, reads(protocol, account))
	}
}

export function observe<A, M>(pick: (source: ReturnType<typeof reads>) => Atom.Atom<A>, read: (value: A) => M) {
	return Stream.unwrap(GatewayReads.useSync(source => observeAtom(pick(source), read)))
}
