import {Command, Route} from '@effect/ui'

import {Context, Effect, Layer, Option, Redacted, Schema, Stream, pipe} from 'effect'

import type {AsyncResult} from 'effect/reactivity'
import {Atom, AtomRegistry, AtomRpc} from 'effect/reactivity'

import {liveAtom} from '@deslop/runtime/client/live-stream'
import {Shell, observeRead} from '@deslop/runtime/client/shell'
import {AuthError} from '@deslop/runtime/shared/auth'
import {RpcStream} from '@deslop/runtime/shared/rpc'
import {TimeFrame} from '@deslop/runtime/shared/time'

import {RpcContracts} from '#contracts'

import {AiSetKey} from '#ai-proxy/contract.ts'
import {ServerId, ServerUrl} from '#connections/contract.ts'

export const GatewayRoute = Route.union({
	Home: Route.make('/', {search: {period: Schema.optional(TimeFrame)}}),
	NotFound: Route.make('/*')
})

export type GatewayRoute = typeof GatewayRoute.Type

export function periodOf(route: GatewayRoute): TimeFrame {
	if (GatewayRoute.isAnyOf(['Home'])(route)) return route.search.period ?? '24h'
	return '24h'
}

export type Entry = typeof Entry.Type
// What someone pastes or types: a key or a server's address, which the model holds redacted.
export const Entry = Schema.Redacted(Schema.String)

function makeReads(shell: Context.Service.Shape<typeof Shell>) {
	class Client extends AtomRpc.Service<Client>()('Gateway/Rpc', {
		group: RpcContracts.middleware(RpcStream),
		protocol: shell.protocol
	}) {}

	return {
		account: shell.account,
		aiUsage: Atom.family((period: TimeFrame) => liveAtom(Client, 'ai-metering.usage', period)),
		client: Client,
		keys: liveAtom(Client, 'ai-proxy.key'),
		mcpUsage: Atom.family((period: TimeFrame) => liveAtom(Client, 'connections.usage', period)),
		runtime: Client.runtime,
		servers: liveAtom(Client, 'connections.watch')
	}
}

class GatewayReads extends Context.Service<GatewayReads, ReturnType<typeof makeReads>>()(
	'@deslop/gateway/reads/GatewayReads'
) {
	static readonly layer = Layer.effect(this, Effect.map(Shell, makeReads))
}

export function readGateway<A extends AsyncResult.AsyncResult<unknown, unknown>, M>(
	pick: (reads: ReturnType<typeof makeReads>) => Atom.Atom<A>,
	read: (value: A) => M
) {
	return Stream.unwrap(GatewayReads.useSync(reads => observeRead(pick(reads), read)))
}

export type Action = typeof Action.Type
export const Action = Schema.TaggedUnion({AddServer: {url: Entry}, Connect: {id: ServerId}, SaveKey: {input: AiSetKey}})

// Opens a path on the gateway outside the app: the page navigates, the app hands it to the system.
export class Open extends Command.Service<Open>()('Gateway/Open', {args: {path: Schema.String}, error: AuthError}) {}

// Puts the gateway's MCP URL on the clipboard.
export class Copy extends Command.Service<Copy>()('Gateway/Copy', {args: {}, error: AuthError}) {}

// Ends the shared session, and says whether Auth confirmed it: the page leaves for Auth's own sign-out and never answers, the app asks Auth and stays.
export class SignOut extends Command.Service<SignOut>()('Gateway/SignOut', {
	args: {},
	error: AuthError,
	success: Schema.Boolean
}) {}

export class Execute extends Command.Service<Execute>()('Gateway/Execute', {
	args: {action: Action},
	error: Schema.String
}) {
	static readonly layer = this.toLayer(
		Effect.gen(function* () {
			const reads = yield* GatewayReads
			const registry = yield* AtomRegistry.AtomRegistry
			const open = yield* Open
			// A finished action answers with the server whose authorization page opens next, if any.
			const actionAtom = reads.runtime.fn((action: Action) =>
				Action.match(action, {
					AddServer: Effect.fnUntraced(function* (request) {
						const url = yield* Effect.mapError(Schema.decodeEffect(ServerUrl)(Redacted.value(request.url)), cause =>
							AuthError.make({
								cause,
								message: 'Enter a public HTTPS MCP URL without credentials or a fragment, outside the gateway itself.'
							})
						)
						const server = yield* (yield* reads.client)('connections.add', {url})
						return Option.liftPredicate(server.id, () => server.status !== 'Connected')
					}),
					Connect: request => Effect.succeedSome(request.id),
					SaveKey: Effect.fnUntraced(function* (request) {
						yield* (yield* reads.client)('ai-proxy.setKey', request.input)
						return Option.none<ServerId>()
					})
				})
			)
			return request =>
				pipe(
					Effect.sync(() => registry.set(actionAtom, request.action)),
					Effect.flatMap(() => AtomRegistry.getResult(registry, actionAtom, {suspendOnWaiting: true})),
					Effect.flatMap(
						Option.match({
							onNone: () => Effect.void,
							onSome: id => open({path: `/oauth/connect?${new URLSearchParams({id})}`})
						})
					),
					Effect.mapError(error => error.message),
					Effect.ensuring(Effect.sync(() => registry.set(actionAtom, Atom.Reset)))
				)
		})
	)
}

// Gateway's own part of what a host mounts on: its reads, and the commands that run on them.
export const layerGateway = Layer.provideMerge(Execute.layer, GatewayReads.layer)
