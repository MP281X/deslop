import {Array, Boolean, Function, Option, pipe} from 'effect'

import type {Components} from '@deslop/components/components'
import type {Choice, PaneLeaf, Press, SheetOptions} from '@deslop/components/model'

import type {DeployScreen} from '#app'

const EXPOSURE = 'deploy-exposure'

export type Exposure = NonNullable<DeployScreen['detail']>['exposures'][number]
export type SheetCommon<C> = {
	readonly dismiss: DeployScreen['dismiss']
	readonly label: string
	readonly open: true
	readonly pending: boolean
	readonly toolbar: SheetOptions<C>['toolbar']
}

// The one piece the hosts draw differently: the web links out, the iPhone presses.
export type DeployUi<H, C, S> = Components<H, C, S> & {
	site: (host: H, site: Exposure, open: (url: string) => Press) => PaneLeaf<C>
}

// The ports of the app the admin can publish.
export function portChoices(screen: DeployScreen, app: NonNullable<DeployScreen['detail']>) {
	const items = Array.map(
		app.ports,
		port =>
			({
				description: `Expose ${app.name} ${port.label}`,
				disabled: screen.pending,
				id: port.id,
				label: port.label,
				press: pipe(
					port.target,
					Option.filter(() => screen.admin),
					Option.match({
						onNone: Function.constUndefined,
						onSome: target => (element, event) => screen.expose(element, event, target)
					})
				)
			}) satisfies Choice
	)
	if (Array.isReadonlyArrayEmpty(items)) return undefined
	return {items, label: 'Port'}
}

// The sheet that publishes a port: its form, its toolbar menu and the button that submits it.
export function exposeSheet<H, C, S>(
	host: H,
	screen: DeployScreen,
	ui: DeployUi<H, C, S>,
	dialog: Extract<NonNullable<DeployScreen['dialog']>, {readonly _tag: 'Expose'}>,
	common: SheetCommon<C>
) {
	return {
		...common,
		actions: ui.button(host, {
			disabled: dialog.disabled,
			form: EXPOSURE,
			label: Boolean.match(screen.pending, {
				onFalse: Function.constant('Expose'),
				onTrue: Function.constant('Exposing…')
			}),
			press: screen.submit
		}),
		body: ui.section(
			host,
			dialog.label,
			ui.form(host, EXPOSURE, screen.submit, [
				ui.caption(host, dialog.subtitle),
				Boolean.match(dialog.kind === 'tailnet', {
					onFalse: () =>
						ui.textField(host, {
							disabled: screen.pending,
							input: screen.hostname,
							label: 'Hostname',
							placeholder: 'app.example.com',
							value: dialog.hostname
						}),
					onTrue: () => ui.paragraph(host, dialog.text)
				})
			])
		),
		height: ui.regularSheetHeight
	} satisfies SheetOptions<C>
}
