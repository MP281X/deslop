import {Array, Boolean, Function, Option, Schema, String, pipe} from 'effect'

import {AsyncResult} from 'effect/reactivity'

import type {ToolbarAction} from '@deslop/components/model'

import {ExposeInput} from './contract.ts'

import {ExposureName, InventoryItem} from '#inventory/contract.ts'
import type {InventoryRead} from '#inventory/screen.ts'
import {shown} from '#inventory/screen.ts'
import {machineHost} from '#machine/screen.ts'

// The sheet that publishes a port, and the messages that fill it.
export const exposuresDialogs = {Expose: {hostname: Schema.String, kind: ExposeInput.fields.kind, port: InventoryItem}}
export const exposuresMessages = {
	Expose: {},
	ExposureKind: {kind: ExposeInput.fields.kind},
	Hostname: {value: Schema.String},
	OpenedExposure: {port: InventoryItem},
	OpenedUrl: {url: Schema.String}
}

export type ExposeDialog = {readonly _tag: 'Expose'} & Schema.Struct.Type<typeof exposuresDialogs.Expose>

// What the sheet would publish: the machine's tailnet name for a tailnet port, the typed hostname for a public one.
export function exposureInput(inventory: InventoryRead, dialog: ExposeDialog) {
	const snapshot = AsyncResult.value(inventory)
	const publicAccess = dialog.kind === 'public'
	const hostname = Boolean.match(publicAccess, {
		onFalse: () => pipe(snapshot, Option.flatMap(machineHost), Option.getOrElse(Function.constant(''))),
		onTrue: () => pipe(dialog.hostname, String.trim, String.toLowerCase)
	})
	return {
		hostname,
		kind: dialog.kind,
		name: ExposureName.make(
			Boolean.match(publicAccess, {
				onFalse: () => `tailnet:${shown(dialog.port.port, String.String)}`,
				onTrue: () => `public:${hostname}`
			})
		),
		port: Option.getOrElse(dialog.port.port, Function.constant(0)),
		publicAccess
	}
}

// The menu that picks who can reach the port.
export function reachAction(dialog: ExposeDialog, pending: boolean) {
	return {
		disabled: pending,
		id: 'reach',
		label: 'Who can reach the port',
		menu: Array.map(ExposeInput.fields.kind.literals, kind => ({
			checked: dialog.kind === kind,
			id: kind,
			label: String.capitalize(kind)
		})),
		symbol: 'chevron.down'
	} satisfies ToolbarAction
}

export function exposeSheet(
	inventory: InventoryRead,
	dialog: ExposeDialog,
	pending: boolean,
	toolbar: readonly ToolbarAction[]
) {
	const input = exposureInput(inventory, dialog)
	return {
		...dialog,
		disabled: pending || !Schema.is(ExposeInput)(input),
		hostname: dialog.hostname,
		label: `Expose ${Option.getOrElse(dialog.port.process, () => dialog.port.name)}`,
		pending,
		subtitle: `Port ${input.port} · ${String.capitalize(dialog.kind)}`,
		text: Boolean.match(input.hostname === '', {
			onFalse: () => `https://${input.hostname}:${input.port}`,
			onTrue: Function.constant('No tailnet address')
		}),
		toolbar
	}
}
