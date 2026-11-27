import {Context, Effect, Layer, Option, Stream, pipe} from 'effect'

import {Atom, AtomRegistry, AtomRpc} from 'effect/reactivity'

import {keepValueThroughOutages, liveAtom, reconnectOnDrop} from '@deslop/runtime/client/live-stream'
import type {layerSocketProtocol} from '@deslop/runtime/client/protocol'
import type {UserId} from '@deslop/runtime/shared/auth'
import {RpcStream} from '@deslop/runtime/shared/rpc'

import {RpcContracts} from '#contracts'
import type {SignedAccount} from '#contracts'

function reads(protocol: ReturnType<typeof layerSocketProtocol>, onAccount: (account: SignedAccount) => void) {
	const credentials = Atom.make(0)
	class Client extends AtomRpc.Service<Client>()('Auth/Rpc', {
		group: RpcContracts.middleware(RpcStream),
		protocol: get => {
			get(credentials)
			return Layer.fresh(protocol)
		}
	}) {}

	// An unreachable server is not a refusal. Keep the last account through an outage.
	const account = Client.runtime.atom(get =>
		keepValueThroughOutages(
			get,
			pipe(
				Stream.unwrap(Effect.map(Client, call => call('people.account', undefined))),
				Stream.tap(value => Effect.sync(() => onAccount(value))),
				Stream.map(Option.some),
				Stream.catchTag('AuthError', error => {
					if (error.error === 'temporarily_unavailable') return Stream.fail(error)
					return Stream.make(Option.none<SignedAccount>())
				})
			),
			reconnectOnDrop
		)
	)
	const people = Atom.family((_viewer: UserId) => liveAtom(Client, 'people.watch'))
	const sessions = Atom.family((_viewer: UserId) => liveAtom(Client, 'sessions.watch'))
	const admit = Atom.family((id: UserId) =>
		Client.runtime.fn((allow: boolean) => Effect.flatMap(Client, call => call('people.admit', {allow, id})))
	)
	return {account, admit, credentials, people, sessions}
}

export class AuthReads extends Context.Service<AuthReads, ReturnType<typeof reads>>()('Auth/Reads') {
	static layer(protocol: ReturnType<typeof layerSocketProtocol>, onAccount: (account: SignedAccount) => void) {
		return Layer.succeed(this, reads(protocol, onAccount))
	}
}

export function watch<A, M>(atom: Atom.Atom<A>, message: (value: A) => M) {
	return Stream.unwrap(
		AtomRegistry.AtomRegistry.useSync(registry => pipe(registry, AtomRegistry.toStream(atom), Stream.map(message)))
	)
}

export function watchAuth<A, M>(select: (reads: ReturnType<typeof reads>) => Atom.Atom<A>, message: (value: A) => M) {
	return Stream.unwrap(AuthReads.useSync(reads => watch(select(reads), message)))
}
