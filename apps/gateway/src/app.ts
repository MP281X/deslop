import {Command, Component, Router, Subscription, UiSchema} from '@effect/ui'

import {Array, Boolean, Effect, Function, Option, Redacted, Result, Schema, String, pipe} from 'effect'

import {Url} from 'effect/http'
import {AsyncResult} from 'effect/reactivity'

import {chooseToolbar} from '@deslop/components/model'
import type {ToolbarAction, ToolbarOptions} from '@deslop/components/model'
import {blockingFailure} from '@deslop/runtime/client/live-stream'
import {Refresh, shellApp} from '@deslop/runtime/client/shell'
import type {AppScreen} from '@deslop/runtime/client/shell'
import {Account} from '@deslop/runtime/shared/schema'
import {DateTimeUtcFromFiniteMillis, TimeFrame} from '@deslop/runtime/shared/time'

import {Action, Copy, Entry, Execute, GatewayRoute, SignOut, periodOf, readGateway} from './reads.ts'

import {aiMeteringFields, aiMeteringMessages} from '#ai-metering/screen.ts'
import {AiKeySecret, KEY_MESSAGE, keyProvider} from '#ai-proxy/contract.ts'
import {aiProxyFields, aiProxyMessages, credentialAction, keyRows} from '#ai-proxy/screen.ts'
import type {ServerId} from '#connections/contract.ts'
import {connectionsFields, connectionsMessages, serverRows} from '#connections/screen.ts'
import {readGroup} from '#usage/screen.ts'

const AccountRead = AsyncResult.Schema({error: Schema.Unknown, success: Account})

// The screen's model and messages: each feature's part, and the page's own. The shell owns the clock and the redirect to sign in.
type Model = typeof Model.Type
const Model = Schema.Struct({
	...aiMeteringFields,
	...aiProxyFields,
	...connectionsFields,
	account: AccountRead,
	busy: Schema.Boolean,
	fieldError: Schema.UndefinedOr(Schema.String),
	fieldVersion: Schema.Int,
	menuFeedback: Schema.UndefinedOr(Schema.String),
	route: GatewayRoute,
	// What Auth did not end, and how many sign-ins had begun then: a later sign-in no longer shows it.
	signOutProblem: Schema.UndefinedOr(Schema.Struct({signIns: Schema.UndefinedOr(Schema.Int), text: Schema.String})),
	signingOut: Schema.Boolean
})

const Message = UiSchema.TaggedEnum({
	...aiMeteringMessages,
	...aiProxyMessages,
	...connectionsMessages,
	Account: {result: AccountRead},
	ActionFailed: {error: Schema.String, save: Schema.Boolean},
	ActionFinished: {action: Schema.Literals(['AddServer', 'Connect', 'SaveKey'])},
	Back: {},
	Chosen: {id: Schema.String},
	ClearFieldError: {},
	CopyFeedback: {text: Schema.String},
	CopyFeedbackExpired: {},
	Route: {route: GatewayRoute},
	SignedOut: {changed: Schema.Boolean, problem: Schema.UndefinedOr(Schema.String)},
	SubmitField: {entry: Entry}
})
type Message = typeof Message.Type

function readEntry(text: Parameters<ToolbarOptions['choose']>[2], message: (entry: Entry) => Message) {
	return (payload: unknown) => {
		const value = text(payload)
		if (value === undefined) return undefined
		return message(Redacted.make(value))
	}
}

function runAction(action: Action) {
	return Command.match(Execute.make({action}), {
		onFailure: error => Message.ActionFailed({error, save: Action.isAnyOf(['SaveKey'])(action)}),
		onSuccess: () => Message.ActionFinished({action: action._tag})
	})
}

// What the key sheet shows of what was typed: the button's words, the problem with it and whether it can be saved.
function keyDialog(model: Model) {
	return pipe(
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

const Screen = Component.define({
	message: Message,
	model: Model,
	name: 'Gateway',
	props: Schema.Struct({now: DateTimeUtcFromFiniteMillis, route: GatewayRoute, signIns: Schema.optionalKey(Schema.Int)})
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
		signOutProblem: undefined,
		signingOut: false
	}),
	parts: (p, model) => {
		const keys = readGroup(model.keys, model.aiUsage, 'AI keys', 3, keyRows)
		const servers = readGroup(model.servers, model.mcpUsage, 'MCP servers', 2, (items, usage) =>
			serverRows(items, usage.report)
		)
		const choose = p.part(chooseToolbar<Message>(Message.Chosen))
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
			dialog: keyDialog(model),
			edit: p.part((el, event: string, text: Parameters<ToolbarOptions['choose']>[2]) =>
				el.on(
					event,
					readEntry(text, secret => Message.EditedKey({secret}))
				)
			),
			empty: keys.rows?.length === 0 && servers.rows?.length === 0,
			fieldError: model.fieldError,
			fieldVersion: String.String(model.fieldVersion),
			keys,
			menuFeedback: model.menuFeedback,
			reads: [model.account, model.keys, model.servers],
			routeMissing: !GatewayRoute.isAnyOf(['Home'])(model.route),
			save: p.part((el, event: string) => el.on(event, Message.SaveKey())),
			servers,
			signOutProblem: Option.getOrUndefined(
				pipe(
					Option.fromUndefinedOr(model.signOutProblem),
					Option.filter(found => found.signIns === p.props.signIns),
					Option.map(found => found.text)
				)
			),
			submit: p.part((el, event: string, text: Parameters<ToolbarOptions['choose']>[2]) =>
				el.on(
					event,
					readEntry(text, entry => Message.SubmitField({entry}))
				)
			),
			toolbar: (accountCaption: boolean) => ({actions: toolbarActions(model, accountCaption), choose})
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
					readGateway(
						reads => reads.account,
						result => Message.Account({result})
					)
				),
			home &&
				Subscription.make(
					'keys',
					readGateway(
						reads => reads.keys,
						result => Message.Keys({result})
					)
				),
			home &&
				Subscription.make(
					'servers',
					readGateway(
						reads => reads.servers,
						result => Message.Servers({result})
					)
				),
			home &&
				Subscription.make('ai-usage', period, range =>
					readGateway(
						reads => reads.aiUsage(range),
						result => Message.AiUsage({period: range, result})
					)
				),
			home &&
				Subscription.make('mcp-usage', period, range =>
					readGateway(
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
			return $.evolve({aiUsage: message.result})
		},
		Back: $ => $.run(Command.asNoop(Router.replace(GatewayRoute, GatewayRoute.Home({search: {}})))),
		CancelKey: $ => {
			if ($.model.busy) return $.model
			return $.evolve({dialog: undefined})
		},
		Chosen: ($, message) => {
			if (message.id === 'copy') {
				return $.run(
					Command.match(Copy.make({}), {
						onFailure: () => Message.CopyFeedback({text: 'Couldn’t copy MCP URL'}),
						onSuccess: () => Message.CopyFeedback({text: 'MCP URL copied'})
					})
				)
			}
			if (message.id === 'retry') {
				return $.run(Command.asNoop(Refresh.make({authenticated: false})))
			}
			if (message.id === 'sign-out' && !$.model.signingOut) {
				return $.evolve({signOutProblem: undefined, signingOut: true}).run(
					Command.match(SignOut.make({}), {
						onFailure: error => Message.SignedOut({changed: false, problem: error.message}),
						onSuccess: confirmed =>
							Message.SignedOut({
								changed: true,
								problem: Boolean.match(confirmed, {
									onFalse: Function.constant('Auth did not confirm ending the shared session.'),
									onTrue: Function.constUndefined
								})
							})
					})
				)
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
		Keys: ($, message) => $.evolve({keys: message.result}),
		McpUsage: ($, message) => {
			if (message.period !== periodOf($.model.route)) return $.model
			return $.evolve({mcpUsage: message.result})
		},
		Perform: ($, message) => {
			if ($.model.busy) return $.model
			return $.evolve({busy: true, fieldError: undefined}).run(runAction(Action.cases.Connect.make({id: message.id})))
		},
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
		Servers: ($, message) => $.evolve({servers: message.result}),
		SignedOut: ($, message) => {
			const next = $.evolve({
				signOutProblem: Option.getOrUndefined(
					Option.map(Option.fromUndefinedOr(message.problem), text => ({signIns: $.props.signIns, text}))
				),
				signingOut: false
			})
			if (!message.changed) return next
			return next.run(Command.asNoop(Refresh.make({authenticated: true})))
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

export type GatewayScreen = AppScreen<Component.Headless.Parts<typeof Screen>>

export const GatewayApp = shellApp({
	every: '1 minute',
	missing: 'Page not found',
	name: 'Gateway',
	props: Schema.Struct({route: GatewayRoute}),
	screen: Screen
})
