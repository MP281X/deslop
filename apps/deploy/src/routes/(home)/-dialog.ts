import {Array, Boolean, Function, Option, String, pipe} from 'effect'

import {Button} from '@deslop/ui/control'

import {Operation} from '#lib/machine.ts'
import {DialogState, ExposureKind, Message} from '#routes/(home)/-model.ts'
import type {H} from '#routes/(home)/-model.ts'
import {machineHost} from '#routes/(home)/-rows.ts'
import {ExposureName} from '#services/inventory/schema.ts'
import type {Snapshot} from '#services/inventory/schema.ts'

type Expose = typeof DialogState.cases.Expose.Type

function closeButton(h: H, label: string, disabled?: boolean) {
	return Button(h, {disabled: disabled ?? false})
		.on('click', () => Message.ClosedDialog())
		.children(label)
}

function ExposeForm(h: H, dialog: Expose, snapshot: Snapshot, pending: boolean, port: number) {
	const publicAccess = dialog.kind === 'public'
	const tailnetHost = Option.getOrElse(machineHost(snapshot), Function.constant(''))
	return h.div.children(
		h.p.class('axis-muted').children(`Port ${port}`),
		h.div.class('deploy-expose-kinds').children(
			Array.map(ExposureKind.literals, (kind: ExposureKind) =>
				Button(h, {disabled: pending, pressed: kind === dialog.kind})
					.key(kind)
					.on('click', () => Message.ExposureKind({kind}))
					.children(String.capitalize(kind))
			)
		),
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
				h.div
					.class('deploy-dialog-actions')
					.children(
						closeButton(h, 'Cancel', pending),
						Button(h, {disabled: pending || (!publicAccess && tailnetHost === ''), type: 'submit'}).children(
							Boolean.match(pending, {onFalse: Function.constant('Expose'), onTrue: Function.constant('Exposing…')})
						)
					)
			)
	)
}

export function Dialog(h: H, dialog: DialogState, snapshot: Snapshot, pending: boolean) {
	const title = h.strong.id('deploy-dialog-title')
	return h.dialog
		.class('deploy-dialog')
		.modal(true)
		.on('cancel', () => Message.ClosedDialog())
		.attr('aria-labelledby', 'deploy-dialog-title')
		.children(
			DialogState.match(dialog, {
				Expose: exposure =>
					Option.getOrUndefined(
						Option.map(exposure.port.port, port => [
							title.children(Option.getOrElse(exposure.port.process, () => exposure.port.name)),
							ExposeForm(h, exposure, snapshot, pending, port)
						])
					),
				Failure: failure => [
					title.children('Couldn’t complete the action'),
					h.p.attr('role', 'alert').children(failure.text),
					closeButton(h, 'Close')
				],
				Logs: logs => [
					title.children(`${logs.name} logs`),
					Option.match(logs.text, {
						onNone: () => h.p.attr('role', 'status').children('Loading logs…'),
						onSome: text =>
							h.pre
								.attr('tabindex', '0')
								.children(
									Boolean.match(String.isEmpty(String.trim(text)), {
										onFalse: () => text,
										onTrue: Function.constant('No logs')
									})
								)
					}),
					h.div.class('deploy-dialog-actions').children(closeButton(h, 'Close'))
				]
			})
		)
}
