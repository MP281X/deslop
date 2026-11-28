import './styles.css'

import {Router} from '@effect/ui'
import type {View} from '@effect/ui'
import {BrowserHost, Html} from '@effect/ui/html'

import {Array, Boolean, Effect, Function, Layer, Option, Predicate, String, pipe} from 'effect'

import type {ButtonOptions, PaneLeaf} from '@deslop/components/model'
import {styles, webStyle} from '@deslop/components/web'
import {webComponents} from '@deslop/components/web/components'
import {mountPage} from '@deslop/components/web/page'
import {SignOut} from '@deslop/runtime/client/shell'
import {AuthError} from '@deslop/runtime/shared/auth'
import {layerWebShell} from '@deslop/runtime/web/shell'

import {GatewayApp} from '#app'
import type {GatewayScreen} from '#app'
import {Copy, GatewayRoute, Open, layerGateway} from '#reads'
import {ADD_LABEL, ADD_PLACEHOLDER, Workspace, inputValue} from '#view'
import type {GatewayUi} from '#view'

import {KEY_FORM, KEY_LABEL} from '#ai-proxy/view.ts'
import {TRACE_HEIGHT, TRACE_WIDTH, tracePoints} from '#usage/screen.ts'
import anthropic from '#web/marks/anthropic.svg'
import openai from '#web/marks/openai.svg'
import opencode from '#web/marks/opencode.svg'

const MARKS = {anthropic, openai, opencode}

function entryOf(payload: unknown) {
	if (!Predicate.hasProperty(payload, 'fields') || !Predicate.hasProperty(payload.fields, 'entry')) return undefined
	if (Predicate.isString(payload.fields.entry)) return payload.fields.entry
	return undefined
}

function attributeWhen(condition: boolean, value: string) {
	if (condition) return value
	return undefined
}

// Gateway's buttons are a little smaller than the shared ones.
function Control<M>(h: Html.H<M>, options: ButtonOptions) {
	const control = h.button
		.attr('disabled', attributeWhen(options.disabled === true, ''))
		.class('design-control gateway-button')
		.style(webStyle(styles.control))
	return Option.match(Option.fromUndefinedOr(options.form), {
		onNone: () => options.press(control.attr('type', 'button'), 'click'),
		onSome: form => control.attrs({form, type: 'submit'})
	})
		.attr('aria-label', options.description)
		.children(options.label)
}

function Sparkline<M>(h: Html.H<M>, values: readonly number[]) {
	const points = pipe(
		tracePoints(values),
		Array.map(point => `${point.x},${point.y}`),
		Array.join(' ')
	)
	return h
		.el('svg')
		.attrs({'aria-hidden': 'true', class: 'gateway-trace', viewBox: `0 0 ${TRACE_WIDTH} ${TRACE_HEIGHT}`})
		.children(h.el('polyline').attrs({fill: 'none', points, stroke: 'currentColor'}))
}

function PasteField<M>(h: Html.H<M>, screen: GatewayScreen) {
	return screen
		.submit(h.form, 'submit', entryOf)
		.class('gateway-add')
		.children(
			screen
				.clear(h.input, 'input')
				.key(screen.fieldVersion)
				.class('gateway-input')
				.attrs({
					'aria-describedby': attributeWhen(screen.fieldError !== undefined, 'gateway-add-error'),
					'aria-invalid': attributeWhen(screen.fieldError !== undefined, 'true'),
					'aria-label': ADD_LABEL,
					autocapitalize: 'none',
					autocomplete: 'off',
					disabled: attributeWhen(screen.busy, ''),
					enterkeyhint: 'go',
					name: 'entry',
					placeholder: ADD_PLACEHOLDER,
					spellcheck: 'false',
					type: 'text'
				}),
			screen.fieldError !== undefined &&
				h.p.class('gateway-alert').id('gateway-add-error').attr('role', 'alert').children(screen.fieldError)
		)
}

function KeySheet<M>(
	h: Html.H<M>,
	screen: GatewayScreen,
	actions: {cancel: PaneLeaf<View.Input<M>>; save: PaneLeaf<View.Input<M>>}
) {
	if (screen.dialog === undefined) return undefined
	return {
		actions: h.div.class('gateway-key-actions').children(actions.cancel, actions.save),
		body: screen
			.save(h.form, 'submit')
			.id(KEY_FORM)
			.children(
				h.label.class('gateway-key-label').attr('for', 'gateway-key').children(KEY_LABEL),
				screen
					.edit(h.input, 'input', inputValue)
					.class('gateway-input')
					.id('gateway-key')
					.attrs({
						'aria-describedby': attributeWhen(screen.dialog.error !== undefined, 'gateway-key-error'),
						'aria-invalid': attributeWhen(screen.dialog.invalid, 'true'),
						autocapitalize: 'none',
						autocomplete: 'off',
						autofocus: '',
						disabled: attributeWhen(screen.busy, ''),
						enterkeyhint: 'go',
						spellcheck: 'false',
						type: 'password'
					})
					.value(screen.dialog.secret),
				screen.dialog.error !== undefined &&
					h.p.class('gateway-alert').id('gateway-key-error').attr('role', 'alert').children(screen.dialog.error)
			),
		dismiss: screen.cancel,
		label: KEY_LABEL,
		open: true,
		pending: screen.busy
	}
}

function Notice<M>(h: Html.H<M>, text: string, retry?: GatewayScreen['retry']) {
	return h.div
		.class('gateway-notice')
		.children(
			h.p.attr('role', 'status').children(text),
			retry !== undefined && Control(h, {label: 'Retry', press: retry})
		)
}

function Skeleton<M>(h: Html.H<M>, count: number, keys: boolean) {
	return h.div
		.attrs({
			'aria-busy': 'true',
			'aria-label': Boolean.match(keys, {
				onFalse: Function.constant('Loading MCP servers'),
				onTrue: Function.constant('Loading AI keys')
			}),
			role: 'status'
		})
		.children(
			Array.makeBy(count, index =>
				h.div
					.key(String.String(index))
					.class('gateway-placeholder', attributeWhen(keys, 'gateway-placeholder-key'))
					.attr('aria-hidden', 'true')
			)
		)
}

const drawing: GatewayUi<Html.H<never>, PaneLeaf<View.Input<never>>, View.Content<never>> = {
	...webComponents<never>(),
	button: Control,
	cover: (h, provider) => h.img.class('gateway-mark').attrs({alt: '', src: MARKS[provider]}),
	entry: (h, id, row) => h.div.key(id).attr('role', 'listitem').children(row),
	feedback: (h, text) => h.p.class('gateway-feedback').attr('role', 'status').children(text),
	keySheet: KeySheet,
	loading: Skeleton,
	missing: h => h.main.class('gateway-notice').children(h.a.attr('href', '/').children('Back to Gateway')),
	notice: Notice,
	page: (h, options) =>
		h.div
			.class('gateway')
			.children(
				options.field,
				options.feedback,
				options.notice,
				h.div
					.class('gateway-rows')
					.attrs({'aria-label': 'AI keys and MCP servers', role: 'list'})
					.children(options.rows)
			),
	pasteField: PasteField,
	spend: (h, row) =>
		h.span
			.class('gateway-figures')
			.children(Sparkline(h, row.values), h.span.children(row.value, h.span.class('gateway-payer').children(row.label)))
}

const App = GatewayApp(Html.vocabulary, (h, screen) => Workspace(h, screen, drawing))

function leave(navigate: () => void) {
	return Effect.andThen(Effect.sync(navigate), Effect.never)
}

// The page leaves for the gateway's own address and for Auth's sign-out, and copies the MCP URL to the clipboard.
const layerActions = Layer.mergeAll(
	Open.toLayer(request => leave(() => location.assign(request.path))),
	Copy.toLayer(() =>
		Effect.tryPromise({
			catch: cause => AuthError.make({cause, message: 'Couldn’t copy MCP URL'}),
			try: () => navigator.clipboard.writeText(`${location.origin}/mcp`)
		})
	),
	SignOut.toLayer(() =>
		leave(() => {
			const form = document.createElement('form')
			form.hidden = true
			form.method = 'post'
			form.action = `/auth/sign-out?${new URLSearchParams({next: location.href})}`
			document.body.append(form)
			form.submit()
		})
	)
)

mountPage(GatewayRoute, root =>
	Layer.provide(
		BrowserHost.mount(App, Router.props(GatewayRoute), root),
		Layer.provideMerge(layerGateway, Layer.merge(layerActions, layerWebShell('gateway')))
	)
)
