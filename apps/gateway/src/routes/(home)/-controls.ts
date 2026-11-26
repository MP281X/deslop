import type {Html} from '@effect/ui/html'

import {Array, Boolean, Function, Option, Redacted, Schema, String} from 'effect'

import {AsyncResult} from 'effect/reactivity'

import {blockingFailure} from '@deslop/runtime/client/live-stream'
import {TimeFrame} from '@deslop/runtime/shared/time'
import {Button} from '@deslop/ui/control'
import {Glass} from '@deslop/ui/glass'

import {Action} from '#lib/gateway.ts'
import {Message, periodOf} from '#routes/(home)/-model.ts'
import type {Model} from '#routes/(home)/-model.ts'
import {credentialAction} from '#routes/(home)/-rows.ts'
import icon from '#routes/icon.svg'
import {AiKeySecret, KEY_MESSAGE} from '#services/ai-proxy/schema.ts'

type H = Html.H<Message>

function when(flag: boolean, value: string) {
	if (flag) return value
	return undefined
}

function Menu(h: H, model: Model, stale: boolean) {
	const account = AsyncResult.match(model.account, {
		onFailure: Function.constUndefined,
		onInitial: Function.constUndefined,
		onSuccess: result => result.value
	})
	const period = periodOf(model.route)
	return h.div
		.id('gateway-menu')
		.class('gateway-menu')
		.attr('popover', 'auto')
		.children(
			h.label.class('gateway-range').children(
				'Range',
				h.select
					.class('gateway-action')
					.key(period)
					.on('change', event => {
						if (Schema.is(TimeFrame)(event.value)) return Message.Period({period: event.value})
						return undefined
					})
					.children(
						Array.map(TimeFrame.literals, value =>
							h.option
								.key(value)
								.attrs({selected: when(value === period, ''), value})
								.children(value)
						)
					)
			),
			Button(h)
				.class('gateway-action')
				.on('click', () => Message.Copy())
				.children('Copy MCP URL'),
			model.menuFeedback !== undefined &&
				h.span.class('axis-muted').attr('role', 'status').children(model.menuFeedback),
			stale &&
				Button(h)
					.class('gateway-action')
					.on('click', () => Message.Retry())
					.attr('aria-label', 'Out of date. Try again')
					.children(h.span.class('axis-dot').attr('aria-hidden', 'true'), 'Out of date'),
			account !== undefined && h.div.class('axis-muted').children(`@${account.name}`),
			account?.signOut === true &&
				h.form
					.attrs({action: `/auth/sign-out?${new URLSearchParams({next: location.href})}`, method: 'post'})
					.children(Button(h, {type: 'submit'}).class('gateway-action').children('Sign out'))
		)
}

export function Toolbar(h: Html.H<Message>, model: Model) {
	const stale = Array.some(
		[model.keys, model.aiUsage, model.servers, model.mcpUsage],
		(result: AsyncResult.AsyncResult<unknown, unknown>) =>
			AsyncResult.isFailure(result) && Option.isNone(blockingFailure(result))
	)
	const busy = model.pending !== undefined
	return h.header.class('gateway-toolbar').children(
		Glass(h).children(
			Button(h)
				.class('gateway-menu-trigger')
				.attrs({
					'aria-label': Boolean.match(stale, {
						onFalse: Function.constant('Gateway controls'),
						onTrue: Function.constant('Gateway controls. Out of date')
					}),
					popovertarget: 'gateway-menu'
				})
				.children(h.img.attrs({alt: '', src: icon}), stale && h.span.class('axis-dot').attr('aria-hidden', 'true'))
		),
		Menu(h, model, stale),
		h.form
			.class('gateway-add')
			.on('submit', event => {
				const entry = String.trim(event.fields['entry'] ?? '')
				if (busy || entry === '') return undefined
				return Message.SubmitField({entry: Redacted.make(entry)})
			})
			.children(
				Glass(h).children(
					h.input
						.key(model.fieldVersion.toString())
						.attrs({
							'aria-describedby': when(model.fieldError !== undefined, 'gateway-add-error'),
							'aria-invalid': when(model.fieldError !== undefined, 'true'),
							'aria-label': 'MCP server URL or provider key',
							autocapitalize: 'none',
							autocomplete: 'off',
							disabled: when(busy, ''),
							enterkeyhint: 'go',
							name: 'entry',
							placeholder: 'Paste a key or a server URL',
							spellcheck: 'false',
							type: 'text'
						})
						.on('input', () => {
							if (model.fieldError !== undefined) return Message.ClearFieldError()
							return undefined
						})
				)
			),
		model.fieldError !== undefined &&
			h.p.id('gateway-add-error').class('gateway-notice').attr('role', 'alert').children(model.fieldError)
	)
}

export function KeyDialog(h: Html.H<Message>, dialog: NonNullable<Model['dialog']>, model: Model) {
	const secret = Redacted.value(dialog.secret)
	const value = String.trim(secret)
	const valid = Schema.is(AiKeySecret)(value)
	const invalid = value !== '' && !valid
	const saving = model.pending === 'SaveKey'
	const error = when(invalid, KEY_MESSAGE) ?? dialog.error
	const keys = Option.getOrElse(AsyncResult.value(model.keys), () => [])
	return h.dialog
		.class('gateway-dialog')
		.modal(true)
		.attr('aria-labelledby', 'gateway-key-title')
		.on('cancel', () => Message.CancelKey())
		.children(
			h.form
				.on('submit', event => {
					const entry = String.trim(event.fields['secret'] ?? '')
					if (saving || !Schema.is(AiKeySecret)(entry)) return undefined
					return Message.Perform({action: Action.cases.SaveKey.make({input: {secret: Redacted.make(entry)}})})
				})
				.children(
					h.strong.id('gateway-key-title').children('AI key'),
					h.label.class('axis-muted').attr('for', 'gateway-key').children('OpenCode, Anthropic or OpenAI key'),
					h.input
						.id('gateway-key')
						.attrs({
							'aria-describedby': when(error !== undefined, 'gateway-key-error'),
							'aria-invalid': when(invalid, 'true'),
							autocapitalize: 'none',
							autocomplete: 'off',
							autofocus: '',
							disabled: when(saving, ''),
							name: 'secret',
							required: '',
							spellcheck: 'false',
							type: 'password'
						})
						.value(secret)
						.on('input', event => Message.EditedKey({secret: Redacted.make(event.value)})),
					error !== undefined && h.p.id('gateway-key-error').attr('role', 'alert').children(error),
					h.div.class('gateway-dialog-actions').children(
						Button(h, {disabled: saving})
							.class('gateway-action')
							.on('click', () => Message.CancelKey())
							.children('Cancel'),
						Button(h, {disabled: saving || !valid, type: 'submit'})
							.class('gateway-action')
							.children(
								Boolean.match(saving, {
									onFalse: () => credentialAction(value, valid, keys),
									onTrue: Function.constant('Saving…')
								})
							)
					)
				)
		)
}
