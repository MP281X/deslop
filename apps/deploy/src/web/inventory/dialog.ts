import type {View} from '@effect/ui'

import {Array, Boolean, Function, Option, Result, String, pipe} from 'effect'

import {Button} from '@deslop/ui/control'
import {Glass, GlassPanel} from '@deslop/ui/glass'
import {SymbolIcon} from '@deslop/ui/symbol'

import {ExposeInput, ExposureName} from '#contracts'
import type {Snapshot} from '#contracts'

import {Operation} from '#web/inventory/client.ts'
import {DialogState, Message} from '#web/inventory/model.ts'
import type {H} from '#web/inventory/model.ts'
import {machineHost} from '#web/inventory/rows.ts'
import {FitSheet} from '#web/inventory/viewport.ts'

type Expose = typeof DialogState.cases.Expose.Type

function closeButton(h: H, disabled = false) {
	return Glass(h).children(
		Button(h, {disabled})
			.class('deploy-icon-control')
			.attr('aria-label', 'Close')
			.on('click', Message.ClosedDialog())
			.children(SymbolIcon(h, 'xmark'))
	)
}

function ExposureMenu(h: H, dialog: Expose, pending: boolean) {
	return h.div.class('deploy-expose-kind').children(
		Glass(h).children(
			Button(h, {disabled: pending})
				.class('deploy-text-control')
				.attrs({'aria-expanded': `${dialog.choosing}`, 'aria-haspopup': 'menu', 'aria-label': 'Who can reach the port'})
				.on('click', Message.ExposureMenu({open: !dialog.choosing}))
				.children(String.capitalize(dialog.kind), SymbolIcon(h, 'chevron.down'))
		),
		GlassPanel(
			h,
			'deploy-exposure-kind',
			'Who can reach the port',
			Array.map(ExposeInput.fields.kind.literals, kind =>
				Button(h, {disabled: pending})
					.key(kind)
					.class('deploy-text-control')
					.attrs({'aria-checked': `${kind === dialog.kind}`, role: 'menuitemradio'})
					.on('click', Message.ExposureKind({kind}))
					.children(String.capitalize(kind), kind === dialog.kind && SymbolIcon(h, 'checkmark'))
			)
		)
			.attr('role', 'menu')
			.popover('auto', dialog.choosing)
			.on('toggle', event => {
				if (!event.open) return Message.ExposureMenu({open: false})
				return undefined
			})
	)
}

function ExposeForm(h: H, dialog: Expose, snapshot: Snapshot, pending: boolean, port: number) {
	const publicAccess = dialog.kind === 'public'
	const tailnetHost = Option.getOrElse(machineHost(snapshot), Function.constant(''))
	return h.div.children(
		h.p.class('axis-muted').children(`Port ${port}`),
		ExposureMenu(h, dialog, pending),
		h.form
			.on('submit', event => {
				const hostname = Boolean.match(publicAccess, {
					onFalse: () => tailnetHost,
					onTrue: () => pipe(event.fields['hostname'] ?? '', String.trim, String.toLowerCase)
				})
				if (pending || hostname === '') return undefined
				return Message.Operation({
					operation: Operation.cases.Expose.make({
						input: {
							hostname,
							kind: dialog.kind,
							name: ExposureName.make(
								Boolean.match(publicAccess, {onFalse: () => `tailnet:${port}`, onTrue: () => `public:${hostname}`})
							),
							port,
							publicAccess
						}
					})
				})
			})
			.children(
				Boolean.match(publicAccess, {
					onFalse: () =>
						h.p.children(
							Boolean.match(tailnetHost === '', {
								onFalse: () => `https://${tailnetHost}:${port}`,
								onTrue: Function.constant('No tailnet address')
							})
						),
					onTrue: () =>
						h.label.children(
							'Hostname',
							h.input
								.attrs({
									autocapitalize: 'none',
									name: 'hostname',
									placeholder: 'app.example.com',
									required: '',
									spellcheck: 'false',
									type: 'text'
								})
								.disabled(pending)
						)
				}),
				h.div.class('deploy-dialog-actions').children(
					Glass(h).children(
						Button(h, {disabled: pending || (!publicAccess && tailnetHost === ''), type: 'submit'})
							.class('deploy-text-control')
							.children(
								Boolean.match(pending, {onFalse: Function.constant('Expose'), onTrue: Function.constant('Exposing…')})
							)
					)
				)
			)
	)
}

export function Dialog(h: H, dialog: DialogState, snapshot: Snapshot | undefined, pending: boolean) {
	const title = h.div.id('deploy-dialog-title').class('axis-title')
	const content: {body: View.Input<Message>; name: string} | undefined = DialogState.match(dialog, {
		Expose: exposure => {
			const port = Option.getOrUndefined(exposure.port.port)
			if (snapshot === undefined || port === undefined) return undefined
			return {
				body: ExposeForm(h, exposure, snapshot, pending, port),
				name: Option.getOrElse(exposure.port.process, () => exposure.port.name)
			}
		},
		Failure: failure => ({
			body: h.p.attr('role', 'alert').children(failure.text),
			name: 'Couldn’t complete the action'
		}),
		Logs: logs => ({
			body: Option.match(logs.result, {
				onNone: () => h.p.attr('role', 'status').children('Loading logs…'),
				onSome: result =>
					Result.match(result, {
						onFailure: error => h.p.attr('role', 'alert').children(error),
						onSuccess: text =>
							h.pre
								.attr('tabindex', '0')
								.children(
									Boolean.match(String.isEmpty(String.trim(text)), {
										onFalse: () => text,
										onTrue: Function.constant('No logs')
									})
								)
					})
			}),
			name: `${logs.name} logs`
		})
	})
	if (content === undefined) return undefined
	return h.dialog
		.key(dialog._tag)
		.class('deploy-dialog', dialog._tag === 'Logs' && 'deploy-logs')
		.attr('aria-labelledby', 'deploy-dialog-title')
		.modal(true)
		.onMount(FitSheet({}))
		.on('cancel', Message.ClosedDialog(), {preventDefault: true})
		.children(
			h.div
				.class('deploy-dialog-heading')
				.children(title.children(content.name), closeButton(h, dialog._tag === 'Expose' && pending)),
			h.div.class('deploy-dialog-body').children(content.body)
		)
}
