import {Command, Component, Router, Subscription, UiSchema} from '@effect/ui'
import type {View} from '@effect/ui'

import {Array, Boolean, Effect, Function, Option, Redacted, Result, Schema, String, pipe} from 'effect'
import type {Cause} from 'effect'

import {Url} from 'effect/http'
import {AsyncResult} from 'effect/reactivity'

import type {ToolbarAction} from '@deslop/components/model'
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

import {Action, Authenticate, Copy, Execute, Refresh} from '#screens/actions.ts'
import type {inputValue} from '#screens/input.ts'
import {observe} from '#screens/reads.ts'
import {GatewayRoute, periodOf} from '#screens/routes.ts'
import {credentialAction, keyRows, serverRows} from '#screens/rows.ts'
import type {KeyRow, ServerRow} from '#screens/rows.ts'

const redactedEntry = Action.cases.AddServer.fields.url

const AccountRead = AsyncResult.Schema({error: Schema.Unknown, success: Account})
const KeysRead = AsyncResult.Schema({error: Schema.Unknown, success: Schema.Array(AiKeyItem)})
const ServersRead = AsyncResult.Schema({error: Schema.Unknown, success: Schema.Array(ConnectionItem)})
const AiUsageRead = AsyncResult.Schema({error: Schema.Unknown, success: AiUsageWindow})
const McpUsageRead = AsyncResult.Schema({error: Schema.Unknown, success: McpUsageWindow})

type Model = typeof Model.Type
const Model = Schema.Struct({
	account: AccountRead,
	aiUsage: AiUsageRead,
	busy: Schema.Boolean,
	dialog: Schema.UndefinedOr(Schema.Struct({error: Schema.UndefinedOr(Schema.String), secret: redactedEntry})),
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

const Message = UiSchema.TaggedEnum({
	Account: {result: AccountRead},
	ActionFailed: {error: Schema.String, save: Schema.Boolean},
	ActionFinished: {action: Schema.Literals(['AddServer', 'Connect', 'SaveKey'])},
	AiUsage: {period: TimeFrame, result: AiUsageRead},
	AuthDone: {changed: Schema.Boolean, problem: Schema.UndefinedOr(Schema.String)},
	Back: {},
	CancelKey: {},
	Chosen: {id: Schema.String},
	ClearFieldError: {},
	CopyFeedback: {text: Schema.String},
	CopyFeedbackExpired: {},
	EditedKey: {secret: redactedEntry},
	Keys: {result: KeysRead},
	McpUsage: {period: TimeFrame, result: McpUsageRead},
	Perform: {id: ServerId},
	Retry: {},
	Route: {route: GatewayRoute},
	SaveKey: {},
	Servers: {result: ServersRead},
	SignIn: {},
	SubmitField: {entry: redactedEntry}
})
type Message = typeof Message.Type

function readNotice(problem: string, retry: boolean) {
	return {loading: undefined, problem, retry, rows: undefined}
}

function readGroup<A, B, Row>(
	source: AsyncResult.AsyncResult<readonly A[], unknown>,
	usage: AsyncResult.AsyncResult<B, unknown>,
	label: string,
	placeholderCount: number,
	rows: (items: readonly A[], usage: B) => readonly Row[]
) {
	const items = Option.getOrUndefined(AsyncResult.value(source))
	const report = Option.getOrUndefined(AsyncResult.value(usage))
	function failed(cause: Cause.Cause<unknown>) {
		if (needsSignInCause(cause)) return readNotice('Signing in…', false)
		if (isDeniedCause(cause)) return readNotice('Access denied', false)
		return readNotice(`Couldn’t load ${label}`, true)
	}
	const failure = Option.getOrUndefined(blockingFailure(source))
	if (failure !== undefined) return failed(failure)
	if (items !== undefined && Array.isReadonlyArrayEmpty(items)) {
		return {loading: undefined, problem: undefined, retry: false, rows: Array.empty<Row>()}
	}
	const usageFailure = Option.getOrUndefined(blockingFailure(usage))
	if (usageFailure !== undefined) return failed(usageFailure)
	if (items === undefined || report === undefined) {
		return {loading: items?.length ?? placeholderCount, problem: undefined, retry: false, rows: undefined}
	}
	return {loading: undefined, problem: undefined, retry: false, rows: rows(items, report)}
}

function readEntry(text: typeof inputValue, message: (entry: Redacted.Redacted) => Message) {
	return (payload: unknown) => {
		const value = text(payload)
		if (value === undefined) return undefined
		return message(Redacted.make(value))
	}
}

function authAction(signOut: boolean) {
	return Command.match(Authenticate.make({signOut}), {
		onFailure: error => Message.AuthDone({changed: false, problem: error.message}),
		onSuccess: Message.AuthDone
	})
}

function runAction(action: Action) {
	return Command.match(Execute.make({action}), {
		onFailure: error => Message.ActionFailed({error, save: Action.isAnyOf(['SaveKey'])(action)}),
		onSuccess: () => Message.ActionFinished({action: action._tag})
	})
}

type ReadKey = typeof ReadKey.Type
const ReadKey = Schema.Literals(['aiUsage', 'keys', 'mcpUsage', 'servers'])

function readUpdate<K extends ReadKey>(
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

function toolbarActions(model: Model, accountCaption: boolean) {
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
			menu: Array.map(TimeFrame.literals, period => ({checked: period === range, id: period, label: period})),
			symbol: 'clock'
		},
		{
			id: 'options',
			label: 'Gateway controls',
			menu: [
				{id: 'copy', label: 'Copy MCP URL', symbol: 'doc.on.clipboard'},
				...Boolean.match(stale, {
					onFalse: Array.empty,
					onTrue: () => [{id: 'retry', label: 'Out of date · Retry', symbol: 'arrow.clockwise' as const}]
				}),
				...Option.toArray(
					pipe(
						Option.fromUndefinedOr(account),
						Option.filter(() => accountCaption),
						Option.map(viewer => ({disabled: true, id: 'account', label: `@${viewer.name}`}))
					)
				),
				...Boolean.match(account?.signOut === true, {
					onFalse: Array.empty,
					onTrue: () => [{id: 'sign-out', label: 'Sign out', symbol: 'rectangle.portrait.and.arrow.right' as const}]
				})
			],
			symbol: Boolean.match(stale, {
				onFalse: Function.constant('ellipsis' as const),
				onTrue: Function.constant('exclamationmark.circle' as const)
			})
		}
	] satisfies readonly ToolbarAction[]
}

const ExpireCopyFeedback = Command.make('Gateway/ExpireCopyFeedback', {args: {}}, () =>
	Effect.as(Effect.sleep('3 seconds'), Message.CopyFeedbackExpired())
)

const Gateway = Component.define({
	message: Message,
	model: Model,
	name: 'Gateway',
	props: Schema.Struct({autoSignIn: Schema.Boolean, route: GatewayRoute})
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
		const keys = readGroup(model.keys, model.aiUsage, 'AI keys', 3, keyRows)
		const servers = readGroup(model.servers, model.mcpUsage, 'MCP servers', 2, (items, usage) =>
			serverRows(items, usage.report)
		)
		const dialog = pipe(
			Option.fromUndefinedOr(model.dialog),
			Option.map(state => {
				const secret = Redacted.value(state.secret)
				const value = String.trim(secret)
				const valid = Schema.is(AiKeySecret)(value)
				const invalid = value !== '' && !valid
				const saved = Option.getOrElse(AsyncResult.value(model.keys), Array.empty)
				const provider = Boolean.match(valid, {onFalse: Function.constUndefined, onTrue: () => keyProvider(value)})
				return {
					action: Boolean.match(model.busy, {
						onFalse: () => credentialAction(saved, provider),
						onTrue: Function.constant('Saving…')
					}),
					error: Boolean.match(invalid, {onFalse: () => state.error, onTrue: Function.constant(KEY_MESSAGE)}),
					invalid,
					secret,
					valid
				}
			}),
			Option.getOrUndefined
		)

		return {
			back: p.part((el, event: string) => el.on(event, Message.Back())),
			busy: model.busy,
			cancel: p.part((el, event: string) => el.on(event, Message.CancelKey())),
			clear: p.part((el, event: string) =>
				el.on(event, () => {
					if (model.fieldError !== undefined) return Message.ClearFieldError()
					return undefined
				})
			),
			connect: p.part((el, event: string, id: ServerId) => el.on(event, Message.Perform({id}))),
			dialog,
			edit: p.part((el, event: string, text: typeof inputValue) =>
				el.on(
					event,
					readEntry(text, secret => Message.EditedKey({secret}))
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
			submit: p.part((el, event: string, text: typeof inputValue) =>
				el.on(
					event,
					readEntry(text, entry => Message.SubmitField({entry}))
				)
			),
			toolbar: {
				actions: toolbarActions(model, p.props.autoSignIn),
				choose: p.part((el, event: string, identify: typeof inputValue) =>
					el.on(event, payload => {
						const id = identify(payload)
						if (id === undefined) return undefined
						return Message.Chosen({id})
					})
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
		AiUsage: ($, message) => {
			if (message.period !== periodOf($.model.route)) return $.model
			return readUpdate($, $.props.autoSignIn, 'aiUsage', message.result)
		},
		AuthDone: ($, message) => {
			const next = $.evolve({signInProblem: message.problem, signingIn: false})
			if (!message.changed) return next
			return next.run(Command.asNoop(Refresh.make({newSession: true, period: periodOf($.model.route)})))
		},
		Back: $ => $.run(Command.asNoop(Router.replace(GatewayRoute, GatewayRoute.Home({search: {}})))),
		CancelKey: $ => {
			if ($.model.busy) return $.model
			return $.evolve({dialog: undefined})
		},
		Chosen: ($, message) => {
			if (message.id === 'copy') return $.run(Command.map(Copy.make({}), text => Message.CopyFeedback({text})))
			if (message.id === 'retry') {
				return $.run(Command.asNoop(Refresh.make({newSession: false, period: periodOf($.model.route)})))
			}
			if (message.id === 'sign-out' && !$.model.signingIn) {
				return $.evolve({signInProblem: undefined, signingIn: true}).run(authAction(true))
			}
			if (
				!Schema.is(TimeFrame)(message.id) ||
				!GatewayRoute.isAnyOf(['Home'])($.model.route) ||
				message.id === periodOf($.model.route)
			) {
				return $.model
			}
			return $.run(
				Command.asNoop(Router.patchSearch(GatewayRoute, $.model.route, {period: message.id}, {history: 'push'}))
			)
		},
		ClearFieldError: $ => $.evolve({fieldError: undefined, menuFeedback: undefined}),
		CopyFeedback: ($, message) => $.evolve({menuFeedback: message.text}).run(ExpireCopyFeedback.make({})),
		CopyFeedbackExpired: $ => $.evolve({menuFeedback: undefined}),
		EditedKey: ($, message) => {
			if ($.model.dialog === undefined || $.model.busy) return $.model
			return $.evolve({dialog: {error: undefined, secret: message.secret}})
		},
		Keys: ($, message) => readUpdate($, $.props.autoSignIn, 'keys', message.result),
		McpUsage: ($, message) => {
			if (message.period !== periodOf($.model.route)) return $.model
			return readUpdate($, $.props.autoSignIn, 'mcpUsage', message.result)
		},
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

export function gatewayRows<Key, Server, Skeleton, Notice>(
	screen: GatewayScreen,
	draw: {
		readonly key: (row: KeyRow) => Key
		readonly loading: (count: number, keys: boolean) => Skeleton
		readonly notice: (text: string, retry?: GatewayScreen['retry']) => Notice
		readonly server: (row: ServerRow) => Server
	}
) {
	function retryWhen(enabled: boolean) {
		if (enabled) return screen.retry
		return undefined
	}
	return [
		...Array.map(screen.keys.rows ?? [], draw.key),
		screen.keys.loading !== undefined && draw.loading(screen.keys.loading, true),
		screen.keys.problem !== undefined && draw.notice(screen.keys.problem, retryWhen(screen.keys.retry)),
		...Array.map(screen.servers.rows ?? [], draw.server),
		screen.servers.loading !== undefined && draw.loading(screen.servers.loading, false),
		screen.servers.problem !== undefined && draw.notice(screen.servers.problem, retryWhen(screen.servers.retry)),
		screen.empty && draw.notice('No keys or MCP servers yet')
	]
}

export function GatewayView<M>(
	h: View.HelperBase<M, unknown>,
	props: {readonly route: typeof GatewayRoute.Type; readonly autoSignIn: boolean},
	view: (screen: GatewayScreen) => View.Content<M>
) {
	return Gateway(h, {props, view})
}
