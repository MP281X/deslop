import type {Html} from '@effect/ui/html'

import {Array, Boolean, Function, Predicate, String, pipe} from 'effect'

import {Layout, Row, styles, webStyle} from '@deslop/design/web'

import {gatewayRows} from '#screens/gateway.ts'
import type {GatewayScreen} from '#screens/gateway.ts'
import {ADD_LABEL, ADD_PLACEHOLDER, KEY_LABEL, inputValue} from '#screens/input.ts'
import {TRACE_HEIGHT, TRACE_WIDTH, tracePoints} from '#screens/rows.ts'
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

function Action<M>(h: Html.H<M>, label: string, disabled = false) {
	return h.button
		.attr('disabled', attributeWhen(disabled, ''))
		.class('design-control gateway-button')
		.style(webStyle(styles.control))
		.children(label)
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

function KeySheet<M>(h: Html.H<M>, screen: GatewayScreen) {
	if (screen.dialog === undefined) return undefined
	return {
		actions: h.div
			.class('gateway-key-actions')
			.children(
				screen.cancel(Action(h, 'Cancel', screen.busy).attr('type', 'button'), 'click'),
				Action(h, screen.dialog.action, screen.busy || !screen.dialog.valid).attrs({
					form: 'gateway-key-form',
					type: 'submit'
				})
			),
		body: screen
			.save(h.form, 'submit')
			.id('gateway-key-form')
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
		.children(h.p.attr('role', 'status').children(text), retry?.(Action(h, 'Retry').attr('type', 'button'), 'click'))
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

export function Workspace<M>(h: Html.H<M>, screen: GatewayScreen) {
	if (!screen.home) {
		return Layout(h, {
			content: h.main.class('gateway-notice').children(h.a.attr('href', '/').children('Back to Gateway'))
		})
	}
	return Layout(h, {
		content: h.div.class('gateway').children(
			PasteField(h, screen),
			screen.menuFeedback !== undefined &&
				h.p.class('gateway-feedback').attr('role', 'status').children(screen.menuFeedback),
			screen.signInProblem !== undefined && Notice(h, screen.signInProblem),
			h.div
				.class('gateway-rows')
				.attrs({'aria-label': 'AI keys and MCP servers', role: 'list'})
				.children(
					gatewayRows(screen, {
						key: row =>
							h.div
								.key(row.item.id)
								.attr('role', 'listitem')
								.children(
									Row(h, {
										active: false,
										cover: h.img.class('gateway-mark').attrs({alt: '', src: MARKS[row.provider]}),
										item: row.item,
										trailing: h.span
											.class('gateway-figures')
											.children(
												Sparkline(h, row.values),
												h.span.children(row.value, h.span.class('gateway-payer').children(row.label))
											)
									})
								),
						loading: (count, keys) => Skeleton(h, count, keys),
						notice: (text, retry) => Notice(h, text, retry),
						server: row => {
							function action() {
								if (row.action === undefined) return undefined
								return screen.connect(
									Action(h, row.action, screen.busy).attrs({
										'aria-label': `${row.action} ${row.item.title}`,
										type: 'button'
									}),
									'click',
									row.id
								)
							}
							return h.div
								.key(row.item.id)
								.attr('role', 'listitem')
								.children(Row(h, {active: false, item: row.item, trailing: action()}))
						}
					})
				)
		),
		sheet: KeySheet(h, screen),
		toolbar: screen.toolbar
	})
}
