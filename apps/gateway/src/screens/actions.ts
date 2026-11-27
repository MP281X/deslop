import {Command} from '@effect/ui'

import {Context, Effect, Layer, Redacted, Schema, pipe} from 'effect'

import {AsyncResult, Atom, AtomRegistry} from 'effect/reactivity'

import {AuthError} from '@deslop/runtime/shared/auth'
import {TimeFrame} from '@deslop/runtime/shared/time'

import {AiSetKey, ServerId, ServerUrl} from '#contracts'

import {GatewayReads} from '#screens/reads.ts'

export const Entry = Schema.Redacted(Schema.String)
export const Action = Schema.TaggedUnion({AddServer: {url: Entry}, Connect: {id: ServerId}, SaveKey: {input: AiSetKey}})
const ActionKind = Schema.Literals(['AddServer', 'Connect', 'SaveKey'])

const AuthOutcome = Schema.Struct({changed: Schema.Boolean, problem: Schema.UndefinedOr(Schema.String)})

export class Platform extends Context.Service<
	Platform,
	{
		readonly open: (path: string) => Effect.Effect<void, AuthError>
		readonly authenticate: (signOut: boolean) => Effect.Effect<typeof AuthOutcome.Type, AuthError>
		readonly copy: Effect.Effect<void, AuthError>
	}
>()('Gateway/Platform') {}

export class Execute extends Command.Service<Execute>()('Gateway/Execute', {
	args: {action: Action},
	error: Schema.String,
	success: ActionKind
}) {
	static readonly layer = this.toLayer(
		Effect.gen(function* () {
			const {client, runtime} = yield* GatewayReads
			const registry = yield* AtomRegistry.AtomRegistry
			const platform = yield* Platform
			const connect = (id: ServerId) => platform.open(`/oauth/connect?${new URLSearchParams({id})}`)
			const actionAtom = runtime.fn((action: typeof Action.Type) =>
				Action.match(action, {
					AddServer: Effect.fnUntraced(function* ({url: entry}) {
						const url = yield* Effect.mapError(Schema.decodeEffect(ServerUrl)(Redacted.value(entry)), cause =>
							AuthError.make({
								cause,
								message: 'Enter a public HTTPS MCP URL without credentials or a fragment, outside the gateway itself.'
							})
						)
						const server = yield* (yield* client)('connections.add', {url})
						if (server.status !== 'Connected') yield* connect(server.id)
					}),
					Connect: request => connect(request.id),
					SaveKey: Effect.fnUntraced(function* (request) {
						yield* (yield* client)('ai-proxy.setKey', request.input)
					})
				})
			)
			return request =>
				pipe(
					Effect.sync(() => registry.set(actionAtom, request.action)),
					Effect.flatMap(() => AtomRegistry.getResult(registry, actionAtom, {suspendOnWaiting: true})),
					Effect.mapError(error => error.message),
					Effect.as(request.action._tag),
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
						registry.update(reads.credentials, version => version + 1)
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

export const Authenticate = Command.make(
	'Gateway/Authenticate',
	{args: {signOut: Schema.Boolean}, error: AuthError, success: AuthOutcome},
	({signOut}) => Platform.use(platform => platform.authenticate(signOut))
)

export const Copy = Command.make('Gateway/Copy', {args: {}, success: Schema.String}, () =>
	Platform.use(platform =>
		Effect.match(platform.copy, {onFailure: () => 'Couldn’t copy MCP URL', onSuccess: () => 'MCP URL copied'})
	)
)

export const layerActions = Layer.merge(Execute.layer, Refresh.layer)
