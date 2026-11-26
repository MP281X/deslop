import {Command, Component, Router, Subscription} from '@effect/ui'
import type {View} from '@effect/ui'
import {Html} from '@effect/ui/html'

import {Array, Layer, Option, Redacted, Result, Schema, pipe} from 'effect'
import type {Cause} from 'effect'

import {Url} from 'effect/http'
import {AsyncResult} from 'effect/reactivity'

import {blockingFailure, isDeniedCause, needsSignInCause} from '@deslop/runtime/client/live-stream'
import {accountAtom} from '@deslop/runtime/web/client'
import {AppShell} from '@deslop/ui/app-shell'
import {Button} from '@deslop/ui/control'
import {SidebarControl} from '@deslop/ui/glass'
import {observe} from '@deslop/ui/state'

import {AiKeySecret} from '#contracts'

import {aiKeyAtom, aiUsageAtom, mcpUsageAtom, serversAtom} from '#web/home/client.ts'
import {Action, Copy, Execute, Message, Model, Refresh, SignIn} from '#web/home/model.ts'
import {KeyRows, ServerRows} from '#web/home/rows.ts'
import {GatewayMenu, KeyDialog, PasteField} from '#web/home/toolbar.ts'
import {GatewayRoute, periodOf} from '#web/routes.ts'

type H = Html.H<Message>

const GatewayDef = Html.component({
	message: Message,
	model: Model,
	name: 'Gateway',
	props: Schema.Struct({route: GatewayRoute})
})

function Unavailable(h: H, label: string, failure: Cause.Cause<unknown>) {
	if (needsSignInCause(failure)) return h.p.class('gateway-notice').attr('role', 'status').children('Signing in…')
	if (isDeniedCause(failure)) return h.p.class('gateway-notice').attr('role', 'alert').children('Access denied')
	return h.div
		.class('gateway-notice')
		.attr('role', 'alert')
		.children(
			h.span.class('axis-dot').attr('aria-hidden', 'true'),
			`Couldn’t load ${label}`,
			Button(h)
				.class('gateway-action')
				.on('click', () => Message.Retry())
				.children('Retry')
		)
}

function ReadPair<A, B>(
	h: H,
	label: string,
	source: AsyncResult.AsyncResult<readonly A[], unknown>,
	usage: AsyncResult.AsyncResult<B, unknown>,
	body: (value: readonly A[], report: B) => View.Input<Message>
) {
	return Option.match(blockingFailure(source), {
		onNone: () => {
			const value = AsyncResult.value(source)
			if (Option.exists(value, Array.isReadonlyArrayEmpty)) return undefined
			return Option.match(blockingFailure(usage), {
				onNone: () =>
					Option.match(Option.all({report: AsyncResult.value(usage), value}), {
						onNone: () => h.p.class('gateway-notice').attr('role', 'status').children(`Loading ${label}…`),
						onSome: ready => body(ready.value, ready.report)
					}),
				onSome: failure => Unavailable(h, label, failure)
			})
		},
		onSome: failure => Unavailable(h, label, failure)
	})
}

function view(h: H, model: Model) {
	if (!GatewayRoute.isAnyOf(['Home'])(model.route)) {
		return h.main.class('gateway').children(h.a.class('gateway-notice').attr('href', '/').children('Back to Gateway'))
	}
	const menu = GatewayMenu(h, model)
	return h.div.class('gateway').children(
		AppShell(h, {
			actions: menu.trigger,
			content: h.main.class('gateway-content').children(
				PasteField(h, model),
				model.sidebarOpen &&
					h.div.attrs({'aria-label': 'AI keys and MCP servers', role: 'list'}).children(
						ReadPair(h, 'AI keys', model.keys, model.aiUsage, (keys, usage) => KeyRows(h, keys, usage)),
						ReadPair(h, 'MCP servers', model.servers, model.mcpUsage, (servers, usage) =>
							ServerRows(h, servers, usage.report, model.pending !== undefined)
						)
					),
				menu.panel,
				model.dialog !== undefined && KeyDialog(h, model.dialog, model)
			),
			sidebar: SidebarControl(h, model.sidebarOpen, Message.ToggleSidebar())
		})
	)
}

function redirectFor(result: AsyncResult.AsyncResult<unknown, unknown>, model: Model) {
	return !model.signingIn && AsyncResult.isFailure(result) && needsSignInCause(result.cause)
}

export const Gateway = pipe(
	GatewayDef.make({
		init: initial => ({
			account: AsyncResult.initial(),
			aiUsage: AsyncResult.initial(),
			dialog: undefined,
			fieldError: undefined,
			fieldVersion: 0,
			keys: AsyncResult.initial(),
			mcpUsage: AsyncResult.initial(),
			menuFeedback: undefined,
			pending: undefined,
			route: initial.props.route,
			servers: AsyncResult.initial(),
			sidebarOpen: true,
			signingIn: false
		}),
		subscriptions: state => {
			const period = periodOf(state.model.route)
			const home = GatewayRoute.isAnyOf(['Home'])(state.model.route)
			return [
				Router.subscription(GatewayRoute, state.model.route, route => Message.Route({route})),
				home &&
					Subscription.make(
						'account',
						observe(accountAtom, result => Message.Account({result}))
					),
				home &&
					Subscription.make(
						'keys',
						observe(aiKeyAtom, result => Message.Keys({result}))
					),
				home &&
					Subscription.make(
						'servers',
						observe(serversAtom, result => Message.Servers({result}))
					),
				home &&
					Subscription.make('ai-usage', period, range =>
						observe(aiUsageAtom(range), result => Message.AiUsage({period: range, result}))
					),
				home &&
					Subscription.make('mcp-usage', period, range =>
						observe(mcpUsageAtom(range), result => Message.McpUsage({period: range, result}))
					)
			]
		},
		update: {
			Account: ($, message) => $.evolve({account: message.result}),
			ActionFailed: ($, message) => {
				if (message.action === 'SaveKey' && $.model.dialog !== undefined) {
					return $.evolve({dialog: {...$.model.dialog, error: message.error}, pending: undefined})
				}
				return $.evolve({fieldError: message.error, pending: undefined})
			},
			ActionFinished: ($, message) => {
				if (message.action === 'SaveKey') return $.evolve({dialog: undefined, pending: undefined})
				return $.evolve({fieldVersion: $.model.fieldVersion + 1, pending: undefined})
			},
			AiUsage: ($, message) => {
				if (message.period !== periodOf($.model.route)) return $.model
				if (redirectFor(message.result, $.model)) {
					return $.evolve({aiUsage: message.result, signingIn: true}).run(Command.asNoop(SignIn.make({})))
				}
				return $.evolve({aiUsage: message.result})
			},
			CancelKey: $ => $.evolve({dialog: undefined}),
			ClearFieldError: $ => $.evolve({fieldError: undefined}),
			Copy: $ => $.run(Copy.make({})),
			CopyFeedback: ($, message) => $.evolve({menuFeedback: message.text}),
			EditedKey: ($, message) => {
				if ($.model.dialog === undefined || $.model.pending === 'SaveKey') return $.model
				return $.evolve({dialog: {error: undefined, secret: message.secret}})
			},
			Keys: ($, message) => {
				if (redirectFor(message.result, $.model)) {
					return $.evolve({keys: message.result, signingIn: true}).run(Command.asNoop(SignIn.make({})))
				}
				return $.evolve({keys: message.result})
			},
			McpUsage: ($, message) => {
				if (message.period !== periodOf($.model.route)) return $.model
				if (redirectFor(message.result, $.model)) {
					return $.evolve({mcpUsage: message.result, signingIn: true}).run(Command.asNoop(SignIn.make({})))
				}
				return $.evolve({mcpUsage: message.result})
			},
			Perform: ($, message) => {
				if ($.model.pending !== undefined) return $.model
				return $.evolve({pending: message.action._tag}).run(Execute.make({action: message.action}))
			},
			Period: ($, message) => {
				if (!GatewayRoute.isAnyOf(['Home'])($.model.route)) return $.model
				return $.run(
					Command.asNoop(Router.patchSearch(GatewayRoute, $.model.route, {period: message.period}, {history: 'push'}))
				)
			},
			Retry: $ => $.run(Command.asNoop(Refresh.make({period: periodOf($.model.route)}))),
			Route: ($, message) => {
				if (periodOf(message.route) === periodOf($.model.route)) return $.evolve({route: message.route})
				return $.evolve({aiUsage: AsyncResult.initial(), mcpUsage: AsyncResult.initial(), route: message.route})
			},
			Servers: ($, message) => {
				if (redirectFor(message.result, $.model)) {
					return $.evolve({servers: message.result, signingIn: true}).run(Command.asNoop(SignIn.make({})))
				}
				return $.evolve({servers: message.result})
			},
			SubmitField: ($, message) => {
				if ($.model.pending !== undefined) return $.model
				const value = Redacted.value(message.entry)
				if (Schema.is(AiKeySecret)(value)) {
					return $.evolve({
						dialog: {error: undefined, secret: message.entry},
						fieldError: undefined,
						fieldVersion: $.model.fieldVersion + 1
					})
				}
				if (Result.isFailure(Url.fromString(value))) {
					return $.evolve({
						fieldError:
							'Enter a full HTTPS MCP URL, an OpenCode key (oc_sk_), an Anthropic key (sk-ant-), or an OpenAI key (sk-).'
					})
				}
				return $.evolve({fieldError: undefined, pending: 'AddServer'}).run(
					Execute.make({action: Action.cases.AddServer.make({url: message.entry})})
				)
			},
			ToggleSidebar: $ => $.evolve({sidebarOpen: !$.model.sidebarOpen})
		},
		view
	}),
	Component.provide(Layer.merge(Execute.layer, Refresh.layer))
)
