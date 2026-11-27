import {Array, Boolean, Function, Option, Result, String, pipe} from 'effect'

import {CheckedChoice} from '@deslop/ui/app-shell'
import type {ShellAction} from '@deslop/ui/app-shell'
import {Button, PopoverPanel} from '@deslop/ui/control'
import {isNative} from '@deslop/ui/native'
import {Sheet} from '@deslop/ui/sheet'
import {SymbolIcon} from '@deslop/ui/symbol'

import {ExposeInput, ExposureName} from '#contracts'
import type {Snapshot} from '#contracts'

import {Operation} from '#web/inventory/client.ts'
import {DialogState, Message} from '#web/inventory/model.ts'
import type {H} from '#web/inventory/model.ts'
import {machineHost} from '#web/inventory/rows.ts'

type Expose = typeof DialogState.cases.Expose.Type

function exposureChoices(dialog: Expose, pending: boolean) {
	return Array.map(ExposeInput.fields.kind.literals, kind => ({
		checked: kind === dialog.kind,
		disabled: pending,
		id: kind,
		message: Message.ExposureKind({kind}),
		title: String.capitalize(kind)
	}))
}

export function DialogActions(dialog: DialogState, pending: boolean): readonly ShellAction<Message>[] {
	const close: ShellAction<Message> = {
		disabled: pending && DialogState.isAnyOf(['Expose'])(dialog),
		id: 'close',
		message: Message.ClosedDialog(),
		symbol: 'xmark',
		title: 'Close'
	}
	if (!DialogState.isAnyOf(['Expose'])(dialog)) return [close]
	return [
		{
			disabled: pending,
			id: 'exposure-kind',
			menu: [{items: exposureChoices(dialog, pending), title: ''}],
			message: Message.ExposureMenu({open: true}),
			symbol: 'chevron.down',
			title: 'Who can reach the port'
		},
		close
	]
}

function ExposureMenu(h: H, dialog: Expose, pending: boolean) {
	return h.div.class('deploy-expose-kind').children(
		Button(h, {disabled: pending})
			.class('axis-control deploy-text-control')
			.attrs({'aria-expanded': `${dialog.choosing}`, 'aria-haspopup': 'menu', 'aria-label': 'Who can reach the port'})
			.on('click', Message.ExposureMenu({open: !dialog.choosing}))
			.children(String.capitalize(dialog.kind), SymbolIcon(h, 'chevron.down')),
		PopoverPanel(
			h,
			'deploy-exposure-kind',
			'Who can reach the port',
			Array.map(exposureChoices(dialog, pending), item => CheckedChoice(h, item).class('deploy-text-control'))
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
		!isNative && ExposureMenu(h, dialog, pending),
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
					Button(h, {disabled: pending || (!publicAccess && tailnetHost === ''), type: 'submit'})
						.class('axis-control deploy-text-control')
						.children(
							Boolean.match(pending, {onFalse: Function.constant('Expose'), onTrue: Function.constant('Exposing…')})
						)
				)
			)
	)
}

export function Dialog(h: H, dialog: DialogState, pending: boolean, snapshot?: Snapshot) {
	const content = DialogState.match(dialog, {
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
	return Sheet(h, {
		body: content.body,
		className: Boolean.match(DialogState.isAnyOf(['Logs'])(dialog), {
			onFalse: Function.constant('deploy-dialog'),
			onTrue: Function.constant('deploy-dialog deploy-logs')
		}),
		close: Message.ClosedDialog(),
		closeDisabled: DialogState.isAnyOf(['Expose'])(dialog) && pending,
		closeHidden: isNative,
		key: dialog._tag,
		title: content.name,
		titleId: 'deploy-dialog-title'
	})
}
