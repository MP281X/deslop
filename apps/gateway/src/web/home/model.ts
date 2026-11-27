import {Command, UiSchema} from '@effect/ui'

import {Effect, Function, Redacted, Schema, pipe} from 'effect'

import {AsyncResult, Atom, AtomRegistry} from 'effect/reactivity'

import {AuthError, signInUrl} from '@deslop/runtime/shared/auth'
import {Account} from '@deslop/runtime/shared/schema'
import {TimeFrame} from '@deslop/runtime/shared/time'
import {refreshFailed} from '@deslop/ui/state'

import {AiKeyItem, AiSetKey, AiUsageWindow, ConnectionItem, McpUsageWindow, ServerId, ServerUrl} from '#contracts'

import {RpcClient, aiKeyAtom, aiUsageAtom, mcpUsageAtom, serversAtom} from '#web/home/client.ts'
import {GatewayRoute} from '#web/routes.ts'

type Entry = typeof Entry.Type
const Entry = Schema.Redacted(Schema.String)

type Action = typeof Action.Type
export const Action = Schema.TaggedUnion({AddServer: {url: Entry}, Connect: {id: ServerId}, SaveKey: {input: AiSetKey}})

const AccountRead = AsyncResult.Schema({error: Schema.Unknown, success: Account})
const KeysRead = AsyncResult.Schema({error: Schema.Unknown, success: Schema.Array(AiKeyItem)})
const ServersRead = AsyncResult.Schema({error: Schema.Unknown, success: Schema.Array(ConnectionItem)})
const AiUsageRead = AsyncResult.Schema({error: Schema.Unknown, success: AiUsageWindow})
const McpUsageRead = AsyncResult.Schema({error: Schema.Unknown, success: McpUsageWindow})
type ActionKind = typeof ActionKind.Type
const ActionKind = Schema.Literals(['AddServer', 'Connect', 'SaveKey'])
type Panel = typeof Panel.Type
const Panel = Schema.Literals(['range', 'options'])

export type Model = typeof Model.Type
export const Model = Schema.Struct({
	account: AccountRead,
	aiUsage: AiUsageRead,
	busy: Schema.Boolean,
	dialog: Schema.UndefinedOr(Schema.Struct({error: Schema.UndefinedOr(Schema.String), secret: Entry})),
	fieldError: Schema.UndefinedOr(Schema.String),
	fieldVersion: Schema.Int,
	keys: KeysRead,
	mcpUsage: McpUsageRead,
	menuFeedback: Schema.UndefinedOr(Schema.String),
	panel: Schema.UndefinedOr(Panel),
	route: GatewayRoute,
	servers: ServersRead,
	signingIn: Schema.Boolean
})

export const Message = UiSchema.TaggedEnum({
	Account: {result: AccountRead},
	ActionFailed: {action: ActionKind, error: Schema.String},
	ActionFinished: {action: Schema.Literals(['AddServer', 'SaveKey'])},
	AiUsage: {period: TimeFrame, result: AiUsageRead},
	CancelKey: {},
	ClearFieldError: {},
	Copy: {},
	CopyFeedback: {text: Schema.String},
	EditedKey: {secret: Entry},
	Keys: {result: KeysRead},
	McpUsage: {period: TimeFrame, result: McpUsageRead},
	Panel: {panel: Panel},
	PanelClosed: {panel: Panel},
	Perform: {action: Action},
	Period: {period: TimeFrame},
	Retry: {},
	Route: {route: GatewayRoute},
	Servers: {result: ServersRead},
	SubmitField: {entry: Entry}
})
export type Message = typeof Message.Type

function leaving(id: ServerId) {
	return Effect.andThen(
		Effect.sync(() => location.assign(`/oauth/connect?${new URLSearchParams({id})}`)),
		// Authorization has started; keep the action pending until the document leaves.
		Effect.never
	)
}

const addServer = Effect.fnUntraced(function* (entry: Entry) {
	const url = yield* Effect.mapError(Schema.decodeEffect(ServerUrl)(Redacted.value(entry)), cause =>
		AuthError.make({
			cause,
			message: 'Enter a public HTTPS MCP URL without credentials or a fragment, outside the gateway itself.'
		})
	)
	const server = yield* Effect.flatMap(RpcClient, call => call('connections.add', {url}))
	if (server.status !== 'Connected') return yield* leaving(server.id)
	return Message.ActionFinished({action: 'AddServer'})
})

const actionAtom = RpcClient.runtime.fn((action: Action) =>
	Action.match(action, {
		AddServer: request => addServer(request.url),
		Connect: request => leaving(request.id),
		SaveKey: Effect.fnUntraced(function* (request) {
			yield* (yield* RpcClient)('ai-proxy.setKey', request.input)
			return Message.ActionFinished({action: 'SaveKey'})
		})
	})
)

export class Execute extends Command.Service<Execute>()('Gateway/Execute', {args: {action: Action}, success: Message}) {
	static readonly layer = this.toLayer(
		Effect.map(AtomRegistry.AtomRegistry, registry =>
			Effect.fnUntraced(function* (request: {readonly action: Action}) {
				registry.set(actionAtom, request.action)
				return yield* pipe(
					registry,
					AtomRegistry.getResult(actionAtom, {suspendOnWaiting: true}),
					Effect.catchTag(['AuthError', 'RpcClientError'], error =>
						Effect.succeed(Message.ActionFailed({action: request.action._tag, error: error.message}))
					),
					Effect.ensuring(Effect.sync(() => registry.set(actionAtom, Atom.Reset)))
				)
			})
		)
	)
}

export class Refresh extends Command.Service<Refresh>()('Gateway/Refresh', {
	args: {period: TimeFrame},
	success: Schema.Void
}) {
	static readonly layer = this.toLayer(
		Effect.map(
			AtomRegistry.AtomRegistry,
			registry => request =>
				Effect.sync(() => {
					refreshFailed(registry, aiKeyAtom)
					refreshFailed(registry, aiUsageAtom(request.period))
					refreshFailed(registry, serversAtom)
					refreshFailed(registry, mcpUsageAtom(request.period))
				})
		)
	)
}

export const SignIn = Command.make('Gateway/SignIn', {args: {}}, () =>
	Effect.sync(() => location.replace(signInUrl(location.href)))
)

export const Copy = Command.make('Gateway/Copy', {args: {}}, () =>
	Effect.match(
		Effect.tryPromise({
			catch: Function.constant('Couldn’t copy MCP URL'),
			try: () => navigator.clipboard.writeText(`${location.origin}/mcp`)
		}),
		{onFailure: text => Message.CopyFeedback({text}), onSuccess: () => Message.CopyFeedback({text: 'MCP URL copied'})}
	)
)
