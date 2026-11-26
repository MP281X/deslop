import {Command, Route, UiSchema} from '@effect/ui'

import {Effect, Function, Schema} from 'effect'

import {AsyncResult, AtomRegistry} from 'effect/reactivity'

import {signInUrl} from '@deslop/runtime/shared/auth'
import {Account} from '@deslop/runtime/shared/schema'
import {TimeFrame} from '@deslop/runtime/shared/time'
import {refreshFailed} from '@deslop/ui/state'

import {Action, Entry, aiKeyAtom, aiUsageAtom, execute, mcpUsageAtom, serversAtom} from '#lib/gateway.ts'
import {AiUsageReport} from '#services/ai-metering/schema.ts'
import {AiKeyItem} from '#services/ai-proxy/schema.ts'
import {ConnectionItem, McpUsageReport} from '#services/connections/schema.ts'
import {UsageRange} from '#services/usage/schema.ts'

export const GatewayRoute = Route.union({
	Home: Route.make('/', {search: {period: Schema.optional(TimeFrame)}}),
	NotFound: Route.make('/*')
})

const AccountRead = AsyncResult.Schema({error: Schema.Unknown, success: Account})
const KeysRead = AsyncResult.Schema({error: Schema.Unknown, success: Schema.Array(AiKeyItem)})
const ServersRead = AsyncResult.Schema({error: Schema.Unknown, success: Schema.Array(ConnectionItem)})
const AiUsageRead = AsyncResult.Schema({
	error: Schema.Unknown,
	success: Schema.Struct({range: UsageRange, report: AiUsageReport})
})
const McpUsageRead = AsyncResult.Schema({
	error: Schema.Unknown,
	success: Schema.Struct({range: UsageRange, report: McpUsageReport})
})
type ActionKind = typeof ActionKind.Type
const ActionKind = Schema.Literals(['AddServer', 'Connect', 'SaveKey'])

export type Model = typeof Model.Type
export const Model = Schema.Struct({
	account: AccountRead,
	aiUsage: AiUsageRead,
	dialog: Schema.UndefinedOr(Schema.Struct({error: Schema.UndefinedOr(Schema.String), secret: Entry})),
	fieldError: Schema.UndefinedOr(Schema.String),
	fieldVersion: Schema.Int,
	keys: KeysRead,
	mcpUsage: McpUsageRead,
	menuFeedback: Schema.UndefinedOr(Schema.String),
	pending: Schema.UndefinedOr(ActionKind),
	route: GatewayRoute,
	servers: ServersRead,
	signingIn: Schema.Boolean
})

export const Message = UiSchema.TaggedEnum({
	Account: {result: AccountRead},
	ActionFailed: {action: ActionKind, error: Schema.String},
	ActionFinished: {action: ActionKind},
	AiUsage: {period: TimeFrame, result: AiUsageRead},
	CancelKey: {},
	ClearFieldError: {},
	Copy: {},
	CopyFeedback: {text: Schema.String},
	EditedKey: {secret: Entry},
	Keys: {result: KeysRead},
	McpUsage: {period: TimeFrame, result: McpUsageRead},
	Perform: {action: Action},
	Period: {period: TimeFrame},
	Retry: {},
	Route: {route: GatewayRoute},
	Servers: {result: ServersRead},
	SubmitField: {entry: Entry}
})
export type Message = typeof Message.Type

export function periodOf(route: typeof GatewayRoute.Type): TimeFrame {
	if (GatewayRoute.isAnyOf(['Home'])(route)) return route.search.period ?? '24h'
	return '24h'
}

export function readers(period: TimeFrame) {
	return {aiUsage: aiUsageAtom(period), keys: aiKeyAtom, mcpUsage: mcpUsageAtom(period), servers: serversAtom}
}

export class Execute extends Command.Service<Execute>()('Gateway/Execute', {args: {action: Action}, success: Message}) {
	static readonly layer = this.toLayer(
		Effect.map(AtomRegistry.AtomRegistry, registry => request => {
			const action: ActionKind = request.action._tag
			return Effect.match(execute(registry, request.action), {
				onFailure: error => Message.ActionFailed({action, error: error.message}),
				onSuccess: () => Message.ActionFinished({action})
			})
		})
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
					const source = readers(request.period)
					refreshFailed(registry, source.keys)
					refreshFailed(registry, source.aiUsage)
					refreshFailed(registry, source.servers)
					refreshFailed(registry, source.mcpUsage)
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
