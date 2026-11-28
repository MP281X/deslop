import {Route} from '@effect/ui'

import {Context, Effect, Layer, Schema, Stream} from 'effect'

import {AtomRpc} from 'effect/reactivity'
import type {AsyncResult, Atom} from 'effect/reactivity'

import {liveAtom} from '@deslop/runtime/client/live-stream'
import {Shell, observeRead} from '@deslop/runtime/client/shell'
import {RpcStream} from '@deslop/runtime/shared/rpc'

import {RpcContracts} from './contracts.ts'

function makeReads(shell: Context.Service.Shape<typeof Shell>) {
	class Client extends AtomRpc.Service<Client>()('@deslop/template-app/reads/Client', {
		group: RpcContracts.middleware(RpcStream),
		protocol: shell.protocol
	}) {}

	return {items: liveAtom(Client, 'items.watch')}
}

class Reads extends Context.Service<Reads, ReturnType<typeof makeReads>>()('@deslop/template-app/reads') {
	static readonly layer = Layer.effect(this, Effect.map(Shell, makeReads))
}

// The app's part of what a host mounts on: the reads of its server.
export const layerReads = Reads.layer

export function readItems<A extends AsyncResult.AsyncResult<unknown, unknown>, M>(
	pick: (reads: ReturnType<typeof makeReads>) => Atom.Atom<A>,
	read: (value: A) => M
) {
	return Stream.unwrap(Reads.useSync(reads => observeRead(pick(reads), read)))
}

export const AppRoute = Route.union({
	Home: Route.make('/', {
		search: {item: Schema.optional(Schema.String), pane: Schema.optional(Schema.Literals(['items', 'item']))}
	}),
	NotFound: Route.make('/*')
})

export type AppRoute = typeof AppRoute.Type

export function isDetail(route: AppRoute) {
	return AppRoute.isAnyOf(['Home'])(route) && route.search.item !== undefined && route.search.pane !== 'items'
}

export function itemOf(route: AppRoute) {
	if (AppRoute.isAnyOf(['Home'])(route)) return route.search.item
	return undefined
}
