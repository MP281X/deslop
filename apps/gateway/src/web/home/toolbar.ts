import type {Html} from '@effect/ui/html'

import {Array, Boolean, Function, Option, Redacted, Schema, String} from 'effect'

import {AsyncResult} from 'effect/reactivity'

import {blockingFailure} from '@deslop/runtime/client/live-stream'
import {TimeFrame} from '@deslop/runtime/shared/time'
import {CheckedChoice} from '@deslop/ui/app-shell'
import type {ShellAction, ShellMenuItem} from '@deslop/ui/app-shell'
import {Button, PopoverPanel} from '@deslop/ui/control'
import {WebSignOut} from '@deslop/ui/session'
import {SymbolIcon} from '@deslop/ui/symbol'
import {FitSheet} from '@deslop/ui/viewport'

import {AiKeySecret, KEY_MESSAGE, keyProvider} from '#contracts'

import {Action, Execute, Message} from '#web/home/model.ts'
import type {Model} from '#web/home/model.ts'
import {credentialAction} from '#web/home/rows.ts'
import {periodOf} from '#web/routes.ts'

export type H = Html.H<Message>

function when(flag: boolean, value: string) {
	if (flag) return value
	return undefined
}

function isStale(model: Model) {
	return Array.some(
		[model.keys, model.aiUsage, model.servers, model.mcpUsage],
		(result: AsyncResult.AsyncResult<unknown, unknown>) =>
			AsyncResult.isFailure(result) && Option.isNone(blockingFailure(result))
	)
}

function rangesOf(model: Model) {
	const period = periodOf(model.route)
	return Array.map(TimeFrame.literals, value => ({
		checked: value === period,
		id: `range-${value}`,
		message: Message.Period({period: value}),
		title: value
	}))
}

export function gatewayActions(model: Model): readonly ShellAction<Message>[] {
	const account = Option.getOrUndefined(AsyncResult.value(model.account))
	const stale = isStale(model)
	const options: readonly ShellMenuItem<Message>[] = [
		{id: 'copy', message: Message.Copy(), title: model.menuFeedback ?? 'Copy MCP URL'},
		...Array.filter([{id: 'retry', message: Message.Retry(), title: 'Out of date · Retry'}], () => stale),
		...Array.filter([{id: 'sign-out', message: Message.SignOut(), title: 'Sign out'}], () => account?.signOut === true)
	]
	return [
		{
			id: 'range',
			menu: [{items: rangesOf(model), title: ''}],
			message: Message.Panel({panel: 'range'}),
			symbol: 'clock',
			title: `Range: ${periodOf(model.route)}`
		},
		{
			id: 'options',
			menu: [{items: options, title: ''}],
			message: Message.Panel({panel: 'options'}),
			symbol: Boolean.match(stale, {
				onFalse: Function.constant('ellipsis'),
				onTrue: Function.constant('exclamationmark.circle')
			}),
			title: 'Gateway controls'
		}
	]
}

export function RangeMenu(h: H, model: Model) {
	return PopoverPanel(
		h,
		'gateway-range',
		'Range',
		Array.map(rangesOf(model), item => CheckedChoice(h, item))
	)
		.attr('role', 'menu')
		.popover('auto', model.panel === 'range')
		.on('toggle', event => {
			if (!event.open) return Message.PanelClosed({panel: 'range'})
			return undefined
		})
}

export function OptionsMenu(h: H, model: Model) {
	const account = Option.getOrUndefined(AsyncResult.value(model.account))
	return PopoverPanel(h, 'gateway-options', 'Gateway controls', [
		Button(h)
			.attr('role', 'menuitem')
			.on('click', Message.Copy())
			.children('Copy MCP URL', SymbolIcon(h, 'doc.on.clipboard')),
		model.menuFeedback !== undefined &&
			h.p.class('axis-muted gateway-menu-caption').attr('role', 'status').children(model.menuFeedback),
		isStale(model) &&
			Button(h)
				.attrs({'aria-label': 'Out of date. Try again', role: 'menuitem'})
				.on('click', Message.Retry())
				.children(
					h.span.children(h.span.class('axis-dot').attr('aria-hidden', 'true'), 'Out of date'),
					SymbolIcon(h, 'arrow.clockwise')
				),
		account !== undefined && h.p.class('axis-muted gateway-menu-caption').children(`@${account.name}`),
		account?.signOut === true && WebSignOut(h, {icon: true})
	])
		.attr('role', 'menu')
		.popover('auto', model.panel === 'options')
		.on('toggle', event => {
			if (!event.open) return Message.PanelClosed({panel: 'options'})
			return undefined
		})
}

export function PasteField(h: H, model: Model) {
	const busy = h.isRunning(Execute)
	return h.header.class('gateway-toolbar').children(
		h.form
			.class('gateway-add')
			.on('submit', event => {
				const entry = String.trim(event.fields['entry'] ?? '')
				if (busy || entry === '') return undefined
				return Message.SubmitField({entry: Redacted.make(entry)})
			})
			.children(
				h.input
					.class('axis-control')
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
					}),
				model.fieldError !== undefined && h.p.id('gateway-add-error').attr('role', 'alert').children(model.fieldError)
			)
	)
}

export function KeyDialog(h: H, dialog: NonNullable<Model['dialog']>, model: Model) {
	const secret = Redacted.value(dialog.secret)
	const value = String.trim(secret)
	const valid = Schema.is(AiKeySecret)(value)
	const invalid = value !== '' && !valid
	const saving = h.isRunning(Execute)
	const error = when(invalid, KEY_MESSAGE) ?? dialog.error
	const keys = Option.getOrElse(AsyncResult.value(model.keys), () => [])
	const provider = Boolean.match(valid, {onFalse: Function.constUndefined, onTrue: () => keyProvider(value)})
	return h.dialog
		.class('gateway-key-sheet')
		.attr('aria-labelledby', 'gateway-key-label')
		.modal(true)
		.onMount(FitSheet({}))
		.on('cancel', Message.CancelKey(), {preventDefault: true})
		.children(
			h.form
				.on('submit', event => {
					const entry = String.trim(event.fields['secret'] ?? '')
					if (saving || !Schema.is(AiKeySecret)(entry)) return undefined
					return Message.Perform({action: Action.cases.SaveKey.make({input: {secret: Redacted.make(entry)}})})
				})
				.children(
					h.label.id('gateway-key-label').attr('for', 'gateway-key').children('OpenCode, Anthropic or OpenAI key'),
					h.input
						.class('axis-control')
						.id('gateway-key')
						.attrs({
							'aria-describedby': when(error !== undefined, 'gateway-key-error'),
							'aria-invalid': when(invalid, 'true'),
							autocapitalize: 'none',
							autocomplete: 'off',
							autofocus: '',
							disabled: when(saving, ''),
							enterkeyhint: 'go',
							name: 'secret',
							required: '',
							spellcheck: 'false',
							type: 'password'
						})
						.value(secret)
						.on('input', event => Message.EditedKey({secret: Redacted.make(event.value)})),
					error !== undefined && h.p.id('gateway-key-error').attr('role', 'alert').children(error),
					h.div.class('gateway-key-actions').children(
						Button(h, {disabled: saving})
							.class('axis-control gateway-action')
							.attr('aria-label', 'Cancel')
							.on('click', Message.CancelKey())
							.children(SymbolIcon(h, 'xmark')),
						Button(h, {disabled: saving || !valid, type: 'submit'})
							.class('axis-control gateway-action')
							.children(
								Boolean.match(saving, {
									onFalse: () => credentialAction(keys, provider),
									onTrue: Function.constant('Saving…')
								})
							)
					)
				)
		)
}
