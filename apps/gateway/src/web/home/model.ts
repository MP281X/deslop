import {Command, UiSchema} from '@effect/ui'

import {Boolean, Effect, Function, Redacted, Schema, pipe} from 'effect'

import {AsyncResult, Atom, AtomRegistry} from 'effect/reactivity'

import {AuthError, signInUrl} from '@deslop/runtime/shared/auth'
import {Account} from '@deslop/runtime/shared/schema'
import {TimeFrame} from '@deslop/runtime/shared/time'
import {isNative, nativeSignIn, nativeSignOut, sessionAccount} from '@deslop/ui/native'
import {refreshFailed} from '@deslop/ui/state'

import {AiKeyItem, AiSetKey, AiUsageWindow, ConnectionItem, McpUsageWindow, ServerId, ServerUrl} from '#contracts'

import {RpcClient, aiKeyAtom, aiUsageAtom, mcpUsageAtom, serversAtom} from '#web/home/client.ts'
import {copyMcpUrl, gatewayOrigin} from '#web/home/platform.ts'
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
	signInProblem: Schema.UndefinedOr(Schema.String),
	signingIn: Schema.Boolean
})

export const Message = UiSchema.TaggedEnum({
	Account: {result: AccountRead},
	ActionFailed: {action: ActionKind, error: Schema.String},
	ActionFinished: {action: ActionKind},
	AiUsage: {period: TimeFrame, result: AiUsageRead},
	AuthDone: {problem: Schema.UndefinedOr(Schema.String), sessionChanged: Schema.Boolean},
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
	SignIn: {},
	SignOut: {},
	SubmitField: {entry: Entry}
})
export type Message = typeof Message.Type

const leaving = Effect.fnUntraced(function* (id: ServerId, action: ActionKind) {
	const origin = yield* gatewayOrigin
	yield* Effect.sync(() => location.assign(`${origin}/oauth/connect?${new URLSearchParams({id})}`))
	if (isNative) return Message.ActionFinished({action})
	// Authorization has started; keep the action pending until the document leaves.
	return yield* Effect.never
})

const addServer = Effect.fnUntraced(function* (entry: Entry) {
	const url = yield* Effect.mapError(Schema.decodeEffect(ServerUrl)(Redacted.value(entry)), cause =>
		AuthError.make({
			cause,
			message: 'Enter a public HTTPS MCP URL without credentials or a fragment, outside the gateway itself.'
		})
	)
	const server = yield* Effect.flatMap(RpcClient, call => call('connections.add', {url}))
	if (server.status !== 'Connected') return yield* leaving(server.id, 'AddServer')
	return Message.ActionFinished({action: 'AddServer'})
})

const actionAtom = RpcClient.runtime.fn((action: Action) =>
	Action.match(action, {
		AddServer: request => addServer(request.url),
		Connect: request => leaving(request.id, 'Connect'),
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
	args: {newSession: Schema.Boolean, period: TimeFrame},
	success: Schema.Void
}) {
	static readonly layer = this.toLayer(
		Effect.map(
			AtomRegistry.AtomRegistry,
			registry => request =>
				Effect.sync(() => {
					if (request.newSession) {
						registry.refresh(sessionAccount)
						registry.refresh(RpcClient.runtime)
					}
					refreshFailed(registry, aiKeyAtom)
					refreshFailed(registry, aiUsageAtom(request.period))
					refreshFailed(registry, serversAtom)
					refreshFailed(registry, mcpUsageAtom(request.period))
				})
		)
	)
}

export const SignInWeb = Command.make('Gateway/SignInWeb', {args: {}}, () =>
	Effect.sync(() => location.replace(signInUrl(location.href)))
)

export const SignIn = Command.make('Gateway/SignIn', {args: {}}, () =>
	Effect.match(nativeSignIn, {
		onFailure: error => Message.AuthDone({problem: error.message, sessionChanged: false}),
		onSuccess: sessionChanged => Message.AuthDone({problem: undefined, sessionChanged})
	})
)

export const SignOut = Command.make('Gateway/SignOut', {args: {}}, () =>
	Effect.match(nativeSignOut, {
		onFailure: error => Message.AuthDone({problem: error.message, sessionChanged: false}),
		onSuccess: status =>
			Message.AuthDone({
				problem: Boolean.match(status >= 200 && status < 400, {
					onFalse: Function.constant('Auth did not confirm ending the shared session.'),
					onTrue: Function.constUndefined
				}),
				sessionChanged: true
			})
	})
)

export const Copy = Command.make('Gateway/Copy', {args: {}}, () =>
	pipe(
		gatewayOrigin,
		Effect.flatMap(origin => Effect.tryPromise({catch: Function.constVoid, try: () => copyMcpUrl(origin)})),
		Effect.match({
			onFailure: () => Message.CopyFeedback({text: 'Couldn’t copy MCP URL'}),
			onSuccess: () => Message.CopyFeedback({text: 'MCP URL copied'})
		})
	)
)
