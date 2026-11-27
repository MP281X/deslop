import {Command, Component, Router, Subscription} from '@effect/ui'
import type {View} from '@effect/ui'
import {Html} from '@effect/ui/html'

import {Array, Layer, Option, Redacted, Result, Schema, pipe} from 'effect'

import {Url} from 'effect/http'
import {AsyncResult, AtomRegistry} from 'effect/reactivity'

import {blockingFailure, needsSignInCause} from '@deslop/runtime/client/live-stream'
import {ActionShell} from '@deslop/ui/app-shell'
import {Loading, Notice} from '@deslop/ui/axis'
import {PressFeedback} from '@deslop/ui/control'
import {isNative, sessionAccount} from '@deslop/ui/native'
import {ReadCombined, ReadFailure, observe} from '@deslop/ui/state'

import {AiKeySecret} from '#contracts'

import {aiKeyAtom, aiUsageAtom, mcpUsageAtom, serversAtom} from '#web/home/client.ts'
import {Action, Copy, Execute, Message, Model, Refresh, SignIn, SignInWeb, SignOut} from '#web/home/model.ts'
import {KeyRows, ServerRows} from '#web/home/rows.ts'
import {KeyDialog, OptionsMenu, PasteField, RangeMenu, gatewayActions} from '#web/home/toolbar.ts'
import {GatewayRoute, periodOf} from '#web/routes.ts'

type H = Html.H<Message>

const GatewayDef = Html.component({
	message: Message,
	model: Model,
	name: 'Gateway',
	props: Schema.Struct({route: GatewayRoute})
})

function ReadPair<A, B>(
	h: H,
	label: string,
	skeleton: string,
	source: AsyncResult.AsyncResult<readonly A[], unknown>,
	usage: AsyncResult.AsyncResult<B, unknown>,
	body: (value: readonly A[], report: B) => View.Input<Message>
) {
	const value = AsyncResult.value(source)
	if (Option.exists(value, Array.isReadonlyArrayEmpty)) {
		return Option.getOrUndefined(
			Option.map(blockingFailure(source), cause => ReadFailure(h, cause, `Couldn’t load ${label}`, Message.Retry()))
		)
	}
	return ReadCombined({
		failed: cause => ReadFailure(h, cause, `Couldn’t load ${label}`, Message.Retry()),
		failure: Option.orElse(blockingFailure(source), () => blockingFailure(usage)),
		loading: () =>
			Loading(h, `Loading ${label}`, h.div.class('gateway-skeleton', skeleton).attr('aria-hidden', 'true')),
		ready: read => body(read.items, read.report),
		value: Option.all({items: value, report: AsyncResult.value(usage)})
	})
}

function needsSignIn(model: Model) {
	return Array.some(
		[model.account, model.keys, model.servers],
		(result: AsyncResult.AsyncResult<unknown, unknown>) =>
			AsyncResult.isFailure(result) && needsSignInCause(result.cause)
	)
}

function GatewayReads(h: H, model: Model) {
	if (isNative && needsSignIn(model)) {
		return Notice(h, model.signInProblem ?? 'Sign in to Gateway', Message.SignIn(), 'Sign in')
	}
	const empty =
		AsyncResult.isSuccess(model.keys) &&
		Array.isReadonlyArrayEmpty(model.keys.value) &&
		AsyncResult.isSuccess(model.servers) &&
		Array.isReadonlyArrayEmpty(model.servers.value)
	return [
		h.div.attrs({'aria-label': 'AI keys and MCP servers', role: 'list'}).children(
			ReadPair(h, 'AI keys', 'gateway-skeleton-keys', model.keys, model.aiUsage, (keys, usage) =>
				KeyRows(h, keys, usage)
			),
			ReadPair(h, 'MCP servers', 'gateway-skeleton-servers', model.servers, model.mcpUsage, (servers, usage) =>
				ServerRows(h, servers, usage.report, h.isRunning(Execute))
			)
		),
		empty && Notice(h, 'No keys or MCP servers yet')
	]
}

function view(h: H, model: Model) {
	if (!GatewayRoute.isAnyOf(['Home'])(model.route)) {
		return h.main.class('gateway').children(h.a.class('gateway-back').attr('href', '/').children('Back to Gateway'))
	}
	return h.div
		.class('gateway axis-controls')
		.onMount(PressFeedback({}))
		.children(
			ActionShell(h, {
				actions: gatewayActions(model),
				content: h.main.class('gateway-content').children(PasteField(h, model), GatewayReads(h, model)),
				overlays: [
					!isNative && RangeMenu(h, model),
					!isNative && OptionsMenu(h, model),
					model.dialog !== undefined && KeyDialog(h, model.dialog, model)
				]
			})
		)
}

type ReadKey = typeof ReadKey.Type
const ReadKey = Schema.Literals(['aiUsage', 'keys', 'mcpUsage', 'servers'])

function readUpdate<K extends ReadKey>($: Component.Step<Model, Message, never>, key: K, result: Model[K]) {
	const next = $.set({...$.model, [key]: result})
	if (
		isNative ||
		$.model.signingIn ||
		!AsyncResult.isFailure<unknown, unknown>(result) ||
		!needsSignInCause(result.cause)
	) {
		return next
	}
	return next.evolve({signingIn: true}).run(Command.asNoop(SignInWeb.make({})))
}

export const Gateway = pipe(
	GatewayDef.make({
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
			panel: undefined,
			route: initial.props.route,
			servers: AsyncResult.initial(),
			signInProblem: undefined,
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
						observe(sessionAccount, result => Message.Account({result}))
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
					return $.evolve({busy: false, dialog: {...$.model.dialog, error: message.error}})
				}
				return $.evolve({busy: false, fieldError: message.error})
			},
			ActionFinished: ($, message) => {
				if (message.action === 'SaveKey') {
					return $.evolve({busy: false, dialog: undefined}).viewTransition(['axis-sheet-close'])
				}
				if (message.action === 'Connect') return $.evolve({busy: false})
				return $.evolve({busy: false, fieldVersion: $.model.fieldVersion + 1})
			},
			AiUsage: ($, message) => {
				if (message.period !== periodOf($.model.route)) return $.model
				return readUpdate($, 'aiUsage', message.result)
			},
			AuthDone: ($, message) => {
				const next = $.evolve({signInProblem: message.problem, signingIn: false})
				if (!message.sessionChanged) return next
				return next.run(Command.asNoop(Refresh.make({newSession: true, period: periodOf($.model.route)})))
			},
			CancelKey: $ => {
				if ($.model.busy) return $.model
				return $.evolve({dialog: undefined}).viewTransition(['axis-sheet-close'])
			},
			ClearFieldError: $ => $.evolve({fieldError: undefined}),
			Copy: $ => $.run(Copy.make({})),
			CopyFeedback: ($, message) => $.evolve({menuFeedback: message.text}),
			EditedKey: ($, message) => {
				if ($.model.dialog === undefined || $.model.busy) return $.model
				return $.evolve({dialog: {error: undefined, secret: message.secret}})
			},
			Keys: ($, message) => readUpdate($, 'keys', message.result),
			McpUsage: ($, message) => {
				if (message.period !== periodOf($.model.route)) return $.model
				return readUpdate($, 'mcpUsage', message.result)
			},
			Panel: ($, message) => {
				if ($.model.panel === message.panel) return $.evolve({panel: undefined})
				return $.evolve({menuFeedback: undefined, panel: message.panel})
			},
			PanelClosed: ($, message) => {
				if ($.model.panel !== message.panel) return $.model
				return $.evolve({panel: undefined})
			},
			Perform: ($, message) => {
				if ($.model.busy) return $.model
				return $.evolve({busy: true}).run(Execute.make({action: message.action}))
			},
			Period: ($, message) => {
				if (!GatewayRoute.isAnyOf(['Home'])($.model.route)) return $.model
				const next = $.evolve({panel: undefined})
				if (message.period === periodOf($.model.route)) return next
				return next.run(
					Command.asNoop(Router.patchSearch(GatewayRoute, $.model.route, {period: message.period}, {history: 'push'}))
				)
			},
			Retry: $ => $.run(Command.asNoop(Refresh.make({newSession: false, period: periodOf($.model.route)}))),
			Route: ($, message) => {
				if (periodOf(message.route) === periodOf($.model.route)) return $.evolve({route: message.route})
				return $.evolve({
					aiUsage: AsyncResult.initial(),
					mcpUsage: AsyncResult.initial(),
					route: message.route
				}).viewTransition(['axis-layout'])
			},
			Servers: ($, message) => readUpdate($, 'servers', message.result),
			SignIn: $ => {
				if ($.model.signingIn) return $.model
				return $.evolve({signInProblem: undefined, signingIn: true}).run(SignIn.make({}))
			},
			SignOut: $ => $.run(SignOut.make({})),
			SubmitField: ($, message) => {
				if ($.model.busy) return $.model
				const value = Redacted.value(message.entry)
				if (Schema.is(AiKeySecret)(value)) {
					return $.evolve({
						dialog: {error: undefined, secret: message.entry},
						fieldError: undefined,
						fieldVersion: $.model.fieldVersion + 1,
						panel: undefined
					}).viewTransition(['axis-sheet-open'])
				}
				if (Result.isFailure(Url.fromString(value))) {
					return $.evolve({
						fieldError:
							'Enter a full HTTPS MCP URL, an OpenCode key (oc_sk_), an Anthropic key (sk-ant-), or an OpenAI key (sk-).'
					})
				}
				return $.evolve({busy: true, fieldError: undefined}).run(
					Execute.make({action: Action.cases.AddServer.make({url: message.entry})})
				)
			}
		},
		view
	}),
	Component.provide(
		pipe(
			Execute.layer,
			Layer.merge(Refresh.layer),
			Layer.provideMerge(AtomRegistry.layerOptions({defaultIdleTTL: 400}))
		)
	)
)
