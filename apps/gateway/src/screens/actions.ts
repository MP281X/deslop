import {Command} from '@effect/ui'

import {Context, Effect, Function, Layer, Redacted, Schema, pipe} from 'effect'

import {AsyncResult, Atom, AtomRegistry} from 'effect/reactivity'

import {AuthError} from '@deslop/runtime/shared/auth'
import {TimeFrame} from '@deslop/runtime/shared/time'

import {AiSetKey, ServerId, ServerUrl} from '#contracts'

import {GatewayReads} from '#screens/reads.ts'

export type Action = typeof Action.Type
export const Action = Schema.TaggedUnion({
	AddServer: {url: Schema.Redacted(Schema.String)},
	Connect: {id: ServerId},
	SaveKey: {input: AiSetKey}
})

type AuthOutcome = typeof AuthOutcome.Type
const AuthOutcome = Schema.Struct({changed: Schema.Boolean, problem: Schema.UndefinedOr(Schema.String)})

export class Platform extends Context.Service<
	Platform,
	{
		readonly open: (path: string) => Effect.Effect<void, AuthError>
		readonly authenticate: (signOut: boolean) => Effect.Effect<AuthOutcome, AuthError>
		readonly copy: Effect.Effect<void, AuthError>
	}
>()('@deslop/gateway/screens/actions/Platform') {}

export class Execute extends Command.Service<Execute>()('Gateway/Execute', {
	args: {action: Action},
	error: Schema.String
}) {
	static readonly layer = this.toLayer(
		Effect.gen(function* () {
			const reads = yield* GatewayReads
			const registry = yield* AtomRegistry.AtomRegistry
			const platform = yield* Platform
			function connect(id: ServerId) {
				return platform.open(`/oauth/connect?${new URLSearchParams({id})}`)
			}
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
						if (server.status !== 'Connected') yield* connect(server.id)
					}),
					Connect: request => connect(request.id),
					SaveKey: Effect.fnUntraced(function* (request) {
						yield* (yield* reads.client)('ai-proxy.setKey', request.input)
					})
				})
			)
			return request =>
				pipe(
					Effect.sync(() => registry.set(actionAtom, request.action)),
					Effect.flatMap(() => AtomRegistry.getResult(registry, actionAtom, {suspendOnWaiting: true})),
					Effect.mapError(error => error.message),
					Effect.ensuring(Effect.sync(() => registry.set(actionAtom, Atom.Reset)))
				)
		})
	)
}

export class Refresh extends Command.Service<Refresh>()('Gateway/Refresh', {
	args: {newSession: Schema.Boolean, period: TimeFrame}
}) {
	static readonly layer = this.toLayer(
		Effect.gen(function* () {
			const reads = yield* GatewayReads
			const registry = yield* AtomRegistry.AtomRegistry
			return request =>
				Effect.sync(() => {
					registry.refresh(reads.account)
					if (request.newSession) {
						registry.update(reads.credentialsAtom, version => version + 1)
						return
					}
					function refreshFailed<A, E>(atom: Atom.Atom<AsyncResult.AsyncResult<A, E>>) {
						if (AsyncResult.isFailure(registry.get(atom))) registry.refresh(atom)
					}
					refreshFailed(reads.keys)
					refreshFailed(reads.servers)
					refreshFailed(reads.aiUsage(request.period))
					refreshFailed(reads.mcpUsage(request.period))
				})
		})
	)
}

export class Authenticate extends Command.Service<Authenticate>()('Gateway/Authenticate', {
	args: {signOut: Schema.Boolean},
	error: AuthError,
	success: AuthOutcome
}) {
	static readonly layer = this.toLayer(
		Effect.map(Platform, platform => request => platform.authenticate(request.signOut))
	)
}

export class Copy extends Command.Service<Copy>()('Gateway/Copy', {args: {}, success: Schema.String}) {
	static readonly layer = this.toLayer(
		Effect.map(
			Platform,
			platform => () =>
				Effect.match(platform.copy, {
					onFailure: Function.constant('Couldn’t copy MCP URL'),
					onSuccess: Function.constant('MCP URL copied')
				})
		)
	)
}

export const layerActions = Layer.mergeAll(Execute.layer, Refresh.layer, Authenticate.layer, Copy.layer)
