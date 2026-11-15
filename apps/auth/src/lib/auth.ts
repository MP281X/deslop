import {Effect, Option, Schema, Stream, pipe} from 'effect'

import {Atom, AtomRpc} from 'effect/reactivity'

import {liveAtom, liveStream, reconnectOnDrop} from '@deslop/runtime/client/live-stream'
import type {UserId} from '@deslop/runtime/shared/auth'
import {RpcStream} from '@deslop/runtime/shared/rpc'
import {addPageTelemetry, layerPageProtocol} from '@deslop/runtime/web/client'

import {RpcContracts} from '#rpcs/contracts.ts'
import {returnable} from '#services/cookie-sessions/lib/utils.ts'
import type {SignedAccount} from '#services/people/schema.ts'

export type Search = typeof Search.Type
export const Search = Schema.Struct({
	error: Schema.OptionFromOptionalKey(Schema.String),
	next: Schema.OptionFromOptionalKey(Schema.String)
})
addPageTelemetry('@deslop/auth')
class RpcClient extends AtomRpc.Service<RpcClient>()('@deslop/auth/lib/auth/RpcClient', {
	group: RpcContracts.middleware(RpcStream),
	protocol: layerPageProtocol
}) {}
export const accountAtom = Atom.keepAlive(
	RpcClient.runtime.atom(
		pipe(
			liveStream(RpcClient, 'people.account'),
			reconnectOnDrop,
			Stream.tap(account =>
				Effect.sync(() => {
					const next = new URL(location.href).searchParams.get('next')
					if (
						account.role !== 'Waiting' &&
						next !== null &&
						returnable(next, location.origin, location.protocol === 'http:')
					) {
						location.assign(next)
					}
				})
			),
			Stream.map(Option.some),
			Stream.catchTag('AuthError', () => Stream.make(Option.none<SignedAccount>()))
		)
	)
)
export const peopleAtom = Atom.keepAlive(liveAtom(RpcClient, 'people.watch'))
export const sessionsAtom = Atom.keepAlive(liveAtom(RpcClient, 'sessions.watch'))
export const admitAtom = Atom.family((id: UserId) =>
	RpcClient.runtime.fn((allow: boolean) => Effect.flatMap(RpcClient, client => client('people.admit', {allow, id})))
)
