import {Command, Component, Router, Subscription, UiSchema} from '@effect/ui'
import type {View} from '@effect/ui'

import {Array, Effect, Option, Redacted, Result, Schema, String} from 'effect'
import type {Cause} from 'effect'

import {Url} from 'effect/http'
import {AsyncResult} from 'effect/reactivity'

import type {ToolbarAction} from '@deslop/design/model'
import {blockingFailure, isDeniedCause, needsSignInCause} from '@deslop/runtime/client/live-stream'
import {Account} from '@deslop/runtime/shared/schema'
import {TimeFrame} from '@deslop/runtime/shared/time'

import {
	AiKeyItem,
	AiKeySecret,
	AiUsageWindow,
	ConnectionItem,
	KEY_MESSAGE,
	McpUsageWindow,
	ServerId,
	keyProvider
} from '#contracts'

import {Action, Authenticate, Copy, Entry, Execute, Refresh} from '#screens/actions.ts'
import {observe} from '#screens/reads.ts'
import {GatewayRoute, periodOf} from '#screens/routes.ts'
import {credentialAction, keyRows, serverRows} from '#screens/rows.ts'

const AccountRead = AsyncResult.Schema({error: Schema.Unknown, success: Account})
const KeysRead = AsyncResult.Schema({error: Schema.Unknown, success: Schema.Array(AiKeyItem)})
const ServersRead = AsyncResult.Schema({error: Schema.Unknown, success: Schema.Array(ConnectionItem)})
const AiUsageRead = AsyncResult.Schema({error: Schema.Unknown, success: AiUsageWindow})
const McpUsageRead = AsyncResult.Schema({error: Schema.Unknown, success: McpUsageWindow})

const Model = Schema.Struct({
	account: AccountRead,
	aiUsage: AiUsageRead,
	busy: Schema.Boolean,
	dialog: Schema.UndefinedOr(Schema.Struct({error: Schema.UndefinedOr(Schema.String), secret: Entry})),
	fieldError: Schema.UndefinedOr(Schema.String),
	fieldVersion: Schema.Int,
	keys: KeysRead,
	mcpUsage: McpUsageRead,
	menuFeedback: Schema.UndefinedOr(Schema.String),
	route: GatewayRoute,
	servers: ServersRead,
	signInProblem: Schema.UndefinedOr(Schema.String),
	signingIn: Schema.Boolean
})
type Model = typeof Model.Type

const Message = UiSchema.TaggedEnum({
	Account: {result: AccountRead},
	ActionFailed: {save: Schema.Boolean, error: Schema.String},
	ActionFinished: {action: Schema.Literals(['AddServer', 'Connect', 'SaveKey'])},
	AiUsage: {period: TimeFrame, result: AiUsageRead},
	AuthDone: {changed: Schema.Boolean, problem: Schema.UndefinedOr(Schema.String)},
	Back: {},
	CancelKey: {},
	ClearFieldError: {},
	Chosen: {id: Schema.String},
	CopyFeedback: {text: Schema.String},
	CopyFeedbackExpired: {},
	EditedKey: {secret: Entry},
	Keys: {result: KeysRead},
	McpUsage: {period: TimeFrame, result: McpUsageRead},
	Perform: {id: ServerId},
	Retry: {},
	Route: {route: GatewayRoute},
	SaveKey: {},
	Servers: {result: ServersRead},
	SignIn: {},
	SubmitField: {entry: Entry}
})
type Message = typeof Message.Type

type ReadGroup<A> =
	| {readonly rows: readonly A[]; readonly loading?: never; readonly problem?: never}
	| {readonly rows?: never; readonly loading: number; readonly problem?: never}
	| {readonly rows?: never; readonly loading?: never; readonly problem: string; readonly retry: boolean}

const ReadGroup = <A, B, Row>(
	source: AsyncResult.AsyncResult<readonly A[], unknown>,
	usage: AsyncResult.AsyncResult<B, unknown>,
	label: string,
	placeholderCount: number,
	rows: (items: readonly A[], usage: B) => readonly Row[]
): ReadGroup<Row> => {
	const items = Option.getOrUndefined(AsyncResult.value(source))
	const report = Option.getOrUndefined(AsyncResult.value(usage))
	function failed(cause: Cause.Cause<unknown>): ReadGroup<Row> {
		if (needsSignInCause(cause)) return {problem: 'Signing in…', retry: false}
		if (isDeniedCause(cause)) return {problem: 'Access denied', retry: false}
		return {problem: `Couldn’t load ${label}`, retry: true}
	}
	const failure = Option.getOrUndefined(blockingFailure(source))
	if (failure !== undefined) return failed(failure)
	if (items !== undefined && Array.isReadonlyArrayEmpty(items)) return {rows: []}
	const usageFailure = Option.getOrUndefined(blockingFailure(usage))
	if (usageFailure !== undefined) return failed(usageFailure)
	if (items === undefined || report === undefined) return {loading: items?.length ?? placeholderCount}
	return {rows: rows(items, report)}
}

function authAction(signOut: boolean) {
	return Command.match(Authenticate.make({signOut}), {
		onFailure: error => Message.AuthDone({changed: false, problem: error.message}),
		onSuccess: Message.AuthDone
	})
}

function runAction(action: typeof Action.Type) {
	return Command.match(Execute.make({action}), {
		onFailure: error => Message.ActionFailed({error, save: action._tag === 'SaveKey'}),
		onSuccess: kind => Message.ActionFinished({action: kind})
	})
}

function readUpdate<K extends 'aiUsage' | 'keys' | 'mcpUsage' | 'servers'>(
	$: Component.Step<Model, Message, never>,
	autoSignIn: boolean,
	key: K,
	result: Model[K]
) {
	const next = $.set({...$.model, [key]: result})
	if (
		!autoSignIn ||
		$.model.signingIn ||
		!AsyncResult.isFailure<unknown, unknown>(result) ||
		!needsSignInCause(result.cause)
	) {
		return next
	}
	return next.evolve({signingIn: true}).run(authAction(false))
}

function toolbarActions(model: Model, accountCaption: boolean): readonly ToolbarAction[] {
	const range = periodOf(model.route)
	const account = Option.getOrUndefined(AsyncResult.value(model.account))
	const stale = Array.some(
		[model.keys, model.aiUsage, model.servers, model.mcpUsage],
		(result: AsyncResult.AsyncResult<unknown, unknown>) =>
			AsyncResult.isFailure(result) && Option.isNone(blockingFailure(result))
	)
	return [
		{
			id: 'range',
			label: `Range: ${range}`,
			symbol: 'clock',
			menu: Array.map(TimeFrame.literals, period => ({id: period, label: period, checked: period === range}))
		},
		{
			id: 'options',
			label: 'Gateway controls',
			symbol: stale ? 'exclamationmark.circle' : 'ellipsis',
			menu: [
				{id: 'copy', label: 'Copy MCP URL', symbol: 'doc.on.clipboard'},
				...(stale ? [{id: 'retry', label: 'Out of date · Retry', symbol: 'arrow.clockwise' as const}] : []),
				...(accountCaption && account !== undefined
					? [{id: 'account', label: `@${account.name}`, disabled: true}]
					: []),
				...(account?.signOut === true
					? [{id: 'sign-out', label: 'Sign out', symbol: 'rectangle.portrait.and.arrow.right' as const}]
					: [])
			]
		}
	]
}

const ExpireCopyFeedback = Command.make('Gateway/ExpireCopyFeedback', {args: {}, success: Message}, () =>
	Effect.as(Effect.sleep('3 seconds'), Message.CopyFeedbackExpired())
)

const Gateway = Component.define({
	message: Message,
	model: Model,
	name: 'Gateway',
	props: Schema.Struct({route: GatewayRoute, autoSignIn: Schema.Boolean})
}).make({
	init: initial => ({
		account: AsyncResult.initial(),
		aiUsage: AsyncResult.initial(),
		busy: false,
		dialog: undefined,
		fieldError: undefined,
		fieldVersion: 0,
		keys: AsyncResult.initial(),
		mcpUsage: AsyncResult.initial(),
		menuFeedback: undefined,
		route: initial.props.route,
		servers: AsyncResult.initial(),
		signInProblem: undefined,
		signingIn: false
	}),
	parts: (p, model) => {
		const signIn =
			!p.props.autoSignIn &&
			Array.some(
				[model.account, model.keys, model.servers],
				(result: AsyncResult.AsyncResult<unknown, unknown>) =>
					AsyncResult.isFailure(result) && needsSignInCause(result.cause)
			)
		const keys = ReadGroup(model.keys, model.aiUsage, 'AI keys', 3, keyRows)
		const servers = ReadGroup(model.servers, model.mcpUsage, 'MCP servers', 2, (items, usage) =>
			serverRows(items, usage.report)
		)
		const dialog = Option.map(Option.fromUndefinedOr(model.dialog), state => {
			const secret = Redacted.value(state.secret)
			const value = String.trim(secret)
			const valid = Schema.is(AiKeySecret)(value)
			const invalid = value !== '' && !valid
			const saved = Option.getOrElse(AsyncResult.value(model.keys), Array.empty)
			return {
				action: model.busy ? 'Saving…' : credentialAction(saved, valid ? keyProvider(value) : undefined),
				error: invalid ? KEY_MESSAGE : state.error,
				invalid,
				secret,
				valid
			}
		}).pipe(Option.getOrUndefined)

		return {
			back: p.part((el, event: string) => el.on(event, Message.Back())),
			busy: model.busy,
			cancel: p.part((el, event: string) => el.on(event, Message.CancelKey())),
			clear: p.part((el, event: string) =>
				el.on(event, () => (model.fieldError === undefined ? undefined : Message.ClearFieldError()))
			),
			connect: p.part((el, event: string, id: ServerId) => el.on(event, Message.Perform({id}))),
			dialog,
			edit: p.part((el, event: string, text: (payload: unknown) => string | undefined) =>
				el.on(event, payload =>
					Option.map(Option.fromUndefinedOr(text(payload)), value =>
						Message.EditedKey({secret: Redacted.make(value)})
					).pipe(Option.getOrUndefined)
				)
			),
			empty: keys.rows?.length === 0 && servers.rows?.length === 0,
			fieldError: model.fieldError,
			fieldVersion: String.String(model.fieldVersion),
			home: GatewayRoute.isAnyOf(['Home'])(model.route),
			keys,
			menuFeedback: model.menuFeedback,
			retry: p.part((el, event: string) => el.on(event, Message.Retry())),
			save: p.part((el, event: string) => el.on(event, Message.SaveKey())),
			servers,
			signIn,
			signInAction: p.part((el, event: string) => el.on(event, Message.SignIn())),
			signInProblem: model.signInProblem,
			signingIn: model.signingIn,
			submit: p.part((el, event: string, text: (payload: unknown) => string | undefined) =>
				el.on(event, payload =>
					Option.map(Option.fromUndefinedOr(text(payload)), value =>
						Message.SubmitField({entry: Redacted.make(value)})
					).pipe(Option.getOrUndefined)
				)
			),
			toolbar: {
				actions: toolbarActions(model, p.props.autoSignIn),
				choose: p.part((el, event: string, identify: (payload: unknown) => string | undefined) =>
					el.on(event, payload =>
						Option.map(Option.fromUndefinedOr(identify(payload)), id => Message.Chosen({id})).pipe(
							Option.getOrUndefined
						)
					)
				)
			}
		}
	},
	subscriptions: state => {
		const period = periodOf(state.model.route)
		const home = GatewayRoute.isAnyOf(['Home'])(state.model.route)
		return [
			Router.subscription(GatewayRoute, state.model.route, route => Message.Route({route})),
			home &&
				Subscription.make(
					'account',
					observe(
						reads => reads.account,
						result => Message.Account({result})
					)
				),
			home &&
				Subscription.make(
					'keys',
					observe(
						reads => reads.keys,
						result => Message.Keys({result})
					)
				),
			home &&
				Subscription.make(
					'servers',
					observe(
						reads => reads.servers,
						result => Message.Servers({result})
					)
				),
			home &&
				Subscription.make('ai-usage', period, range =>
					observe(
						reads => reads.aiUsage(range),
						result => Message.AiUsage({period: range, result})
					)
				),
			home &&
				Subscription.make('mcp-usage', period, range =>
					observe(
						reads => reads.mcpUsage(range),
						result => Message.McpUsage({period: range, result})
					)
				)
		]
	},
	update: {
		Account: ($, message) => $.evolve({account: message.result}),
		ActionFailed: ($, message) => {
			if (message.save && $.model.dialog !== undefined) {
				return $.evolve({busy: false, dialog: {...$.model.dialog, error: message.error}})
			}
			return $.evolve({busy: false, fieldError: message.error})
		},
		ActionFinished: ($, message) => {
			if (message.action === 'SaveKey') return $.evolve({busy: false, dialog: undefined})
			if (message.action === 'Connect') return $.evolve({busy: false})
			return $.evolve({busy: false, fieldVersion: $.model.fieldVersion + 1})
		},
		AiUsage: ($, message) =>
			message.period === periodOf($.model.route)
				? readUpdate($, $.props.autoSignIn, 'aiUsage', message.result)
				: $.model,
		AuthDone: ($, message) => {
			const next = $.evolve({signInProblem: message.problem, signingIn: false})
			if (!message.changed) return next
			return next.run(Command.asNoop(Refresh.make({newSession: true, period: periodOf($.model.route)})))
		},
		Back: $ => $.run(Command.asNoop(Router.replace(GatewayRoute, GatewayRoute.Home({search: {}})))),
		CancelKey: $ => ($.model.busy ? $.model : $.evolve({dialog: undefined})),
		Chosen: ($, {id}) => {
			if (id === 'copy') return $.run(Command.map(Copy.make({}), text => Message.CopyFeedback({text})))
			if (id === 'retry')
				return $.run(Command.asNoop(Refresh.make({newSession: false, period: periodOf($.model.route)})))
			if (id === 'sign-out' && !$.model.signingIn) {
				return $.evolve({signingIn: true, signInProblem: undefined}).run(authAction(true))
			}
			if (
				!Schema.is(TimeFrame)(id) ||
				!GatewayRoute.isAnyOf(['Home'])($.model.route) ||
				id === periodOf($.model.route)
			) {
				return $.model
			}
			return $.run(Command.asNoop(Router.patchSearch(GatewayRoute, $.model.route, {period: id}, {history: 'push'})))
		},
		ClearFieldError: $ => $.evolve({fieldError: undefined, menuFeedback: undefined}),
		CopyFeedback: ($, {text}) => $.evolve({menuFeedback: text}).run(ExpireCopyFeedback.make({})),
		CopyFeedbackExpired: $ => $.evolve({menuFeedback: undefined}),
		EditedKey: ($, message) => {
			if ($.model.dialog === undefined || $.model.busy) return $.model
			return $.evolve({dialog: {error: undefined, secret: message.secret}})
		},
		Keys: ($, message) => readUpdate($, $.props.autoSignIn, 'keys', message.result),
		McpUsage: ($, message) =>
			message.period === periodOf($.model.route)
				? readUpdate($, $.props.autoSignIn, 'mcpUsage', message.result)
				: $.model,
		Perform: ($, message) => {
			if ($.model.busy) return $.model
			return $.evolve({busy: true, fieldError: undefined}).run(runAction(Action.cases.Connect.make({id: message.id})))
		},
		Retry: $ => $.run(Command.asNoop(Refresh.make({newSession: false, period: periodOf($.model.route)}))),
		Route: ($, message) => {
			if (periodOf(message.route) === periodOf($.model.route)) return $.evolve({route: message.route})
			return $.evolve({aiUsage: AsyncResult.initial(), mcpUsage: AsyncResult.initial(), route: message.route})
		},
		SaveKey: $ => {
			if ($.model.busy || $.model.dialog === undefined) return $.model
			const value = String.trim(Redacted.value($.model.dialog.secret))
			if (!Schema.is(AiKeySecret)(value)) return $.model
			return $.evolve({busy: true}).run(runAction(Action.cases.SaveKey.make({input: {secret: Redacted.make(value)}})))
		},
		Servers: ($, message) => readUpdate($, $.props.autoSignIn, 'servers', message.result),
		SignIn: $ => {
			if ($.model.signingIn) return $.model
			return $.evolve({signInProblem: undefined, signingIn: true}).run(authAction(false))
		},
		SubmitField: ($, message) => {
			if ($.model.busy) return $.model
			const value = String.trim(Redacted.value(message.entry))
			if (value === '') return $.model
			const entry = Redacted.make(value)
			if (Schema.is(AiKeySecret)(value)) {
				return $.evolve({
					dialog: {error: undefined, secret: entry},
					fieldError: undefined,
					fieldVersion: $.model.fieldVersion + 1,
					menuFeedback: undefined
				})
			}
			if (Result.isFailure(Url.fromString(value))) {
				return $.evolve({
					fieldError:
						'Enter a full HTTPS MCP URL, an OpenCode key (oc_sk_), an Anthropic key (sk-ant-), or an OpenAI key (sk-).'
				})
			}
			return $.evolve({busy: true, fieldError: undefined}).run(runAction(Action.cases.AddServer.make({url: entry})))
		}
	}
})

export type GatewayScreen = Component.Headless.Parts<typeof Gateway>

export function GatewayView<M, R>(
	h: View.HelperBase<M, unknown>,
	props: {readonly route: typeof GatewayRoute.Type; readonly autoSignIn: boolean},
	view: (screen: GatewayScreen) => View.Content<M, R>
) {
	return Gateway(h, {props, view})
}
