import type {Html} from '@effect/ui/html'

import {Array, Predicate} from 'effect'

import {Layout, Row, styles, webStyle} from '@deslop/design/web'

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

function Action<M>(h: Html.H<M>, label: string, disabled = false) {
	return h.button
		.attr('disabled', disabled ? '' : undefined)
		.class('design-control gateway-button')
		.style(webStyle(styles.control))
		.children(label)
}

function Sparkline<M>(h: Html.H<M>, values: readonly number[]) {
	const points = Array.join(
		Array.map(tracePoints(values), ({x, y}) => `${x},${y}`),
		' '
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
					'aria-describedby': screen.fieldError === undefined ? undefined : 'gateway-add-error',
					'aria-invalid': screen.fieldError === undefined ? undefined : 'true',
					'aria-label': ADD_LABEL,
					autocapitalize: 'none',
					autocomplete: 'off',
					disabled: screen.busy ? '' : undefined,
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
	const dialog = screen.dialog
	if (dialog === undefined) return undefined
	return {
		actions: h.div
			.class('gateway-key-actions')
			.children(
				screen.cancel(Action(h, 'Cancel', screen.busy).attr('type', 'button'), 'click'),
				Action(h, dialog.action, screen.busy || !dialog.valid).attrs({form: 'gateway-key-form', type: 'submit'})
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
						'aria-describedby': dialog.error === undefined ? undefined : 'gateway-key-error',
						'aria-invalid': dialog.invalid ? 'true' : undefined,
						autocapitalize: 'none',
						autocomplete: 'off',
						autofocus: '',
						disabled: screen.busy ? '' : undefined,
						enterkeyhint: 'go',
						spellcheck: 'false',
						type: 'password'
					})
					.value(dialog.secret),
				dialog.error !== undefined &&
					h.p.class('gateway-alert').id('gateway-key-error').attr('role', 'alert').children(dialog.error)
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
			retry !== undefined && retry(Action(h, 'Retry').attr('type', 'button'), 'click')
		)
}

function Skeleton<M>(h: Html.H<M>, count: number, keys: boolean) {
	return h.div
		.attrs({'aria-busy': 'true', 'aria-label': keys ? 'Loading AI keys' : 'Loading MCP servers', role: 'status'})
		.children(
			Array.makeBy(count, index =>
				h.div
					.key(String(index))
					.class('gateway-placeholder', keys ? 'gateway-placeholder-key' : undefined)
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
				.children([
					...Array.map(screen.keys.rows ?? [], row =>
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
							)
					),
					screen.keys.loading !== undefined && Skeleton(h, screen.keys.loading, true),
					screen.keys.problem !== undefined &&
						Notice(h, screen.keys.problem, screen.keys.retry ? screen.retry : undefined),
					...Array.map(screen.servers.rows ?? [], row =>
						h.div
							.key(row.item.id)
							.attr('role', 'listitem')
							.children(
								Row(h, {
									active: false,
									item: row.item,
									trailing:
										row.action === undefined
											? undefined
											: screen.connect(
													Action(h, row.action, screen.busy).attrs({
														'aria-label': `${row.action} ${row.item.title}`,
														type: 'button'
													}),
													'click',
													row.id
												)
								})
							)
					),
					screen.servers.loading !== undefined && Skeleton(h, screen.servers.loading, false),
					screen.servers.problem !== undefined &&
						Notice(h, screen.servers.problem, screen.servers.retry ? screen.retry : undefined),
					screen.empty && Notice(h, 'No keys or MCP servers yet')
				])
		),
		sheet: KeySheet(h, screen),
		toolbar: screen.toolbar
	})
}
