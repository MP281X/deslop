import {Effect, Option, Schema, Stream, pipe} from 'effect'

import {Atom, AtomRpc} from 'effect/reactivity'

import {keepValueThroughOutages, liveAtom, liveStream, reconnectOnDrop} from '@deslop/runtime/client/live-stream'
import type {UserId} from '@deslop/runtime/shared/auth'
import {RpcStream} from '@deslop/runtime/shared/rpc'
import {addPageTelemetry, layerPageProtocol} from '@deslop/runtime/web/client'

import {RpcContracts} from '#rpcs/contracts.ts'
import type {SignedAccount} from '#services/people/schema.ts'
import {returnTarget} from '#services/sessions/lib/utils.ts'

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
// Auth refusing the caller is the signed-out page; an outage keeps the last account and retries.
export const accountAtom = Atom.keepAlive(
	RpcClient.runtime.atom(get =>
		keepValueThroughOutages(
			get,
			pipe(
				liveStream(RpcClient, 'people.account'),
				Stream.tap(account =>
					Effect.sync(() => {
						if (account.role === 'Waiting') return
						pipe(
							Option.fromNullishOr(new URL(location.href).searchParams.get('next')),
							Option.flatMap(next => returnTarget(next, location.origin, location.protocol === 'http:')),
							Option.map(target => location.assign(target))
						)
					})
				),
				Stream.map(Option.some),
				Stream.catchTag('AuthError', error => {
					if (error.error === 'temporarily_unavailable') return Stream.fail(error)
					return Stream.make(Option.none<SignedAccount>())
				})
			),
			reconnectOnDrop
		)
	)
)
export const peopleAtom = Atom.keepAlive(liveAtom(RpcClient, 'people.watch'))
export const sessionsAtom = Atom.keepAlive(liveAtom(RpcClient, 'sessions.watch'))
export const admitAtom = Atom.family((id: UserId) =>
	RpcClient.runtime.fn((allow: boolean) => Effect.flatMap(RpcClient, client => client('people.admit', {allow, id})))
)
