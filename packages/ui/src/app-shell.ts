import {Component, Mount} from '@effect/ui'
import type {View} from '@effect/ui'
import type {Html} from '@effect/ui/html'

import {Array, Boolean, Function, Option, Queue, Schema, Stream, pipe} from 'effect'

import {Capacitor} from '@capacitor/core'

import {Button} from './control.ts'
import {ToolbarItem, nativeToolbar} from './native.ts'
import {SymbolIcon} from './symbol.ts'
import type {SymbolName} from './symbol.ts'

const DeclaredToolbar = Mount.makeStream(
	'DeclaredToolbar',
	{args: {items: Schema.Array(ToolbarItem)}},
	(_node: HTMLElement, {items}, changes) =>
		Stream.callback<string>(out =>
			Stream.runDrain(
				nativeToolbar(
					Stream.concat(
						Stream.succeed(items),
						Stream.map(changes, update => update.items)
					),
					id => {
						Queue.offerUnsafe(out, id)
					}
				)
			)
		)
)

export type ShellMenuItem<M> = {checked?: boolean; disabled?: boolean; id: string; message: M; title: string}

export type ShellMenuGroup<M> = {items: readonly ShellMenuItem<M>[]; title: string}

export type ShellAction<M> = {
	disabled?: boolean
	id: string
	menu?: readonly ShellMenuGroup<M>[]
	message: M
	pressed?: boolean
	symbol: SymbolName
	title: string
}

export function CheckedChoice<M>(h: Html.H<M>, item: ShellMenuItem<NoInfer<M>>) {
	return Button(h, {disabled: item.disabled ?? false})
		.key(item.id)
		.attrs({'aria-checked': `${item.checked === true}`, role: 'menuitemradio'})
		.on('click', item.message)
		.children(item.title, item.checked === true && SymbolIcon(h, 'checkmark'))
}

function ShellButton<M>(h: Html.H<M>, action: ShellAction<M>) {
	const disabled = action.disabled ?? false
	return Option.match(Option.fromUndefinedOr(action.pressed), {
		onNone: () => Button(h, {disabled}),
		onSome: pressed => Button(h, {disabled, pressed})
	})
		.key(action.id)
		.class('axis-control')
		.attrs({
			'aria-haspopup': Boolean.match(action.menu !== undefined, {
				onFalse: Function.constUndefined,
				onTrue: Function.constant('menu')
			}),
			'aria-label': action.title,
			style: `anchor-name: --axis-action-${action.id}`,
			title: action.title
		})
		.on('click', () => action.message)
		.children(SymbolIcon(h, action.symbol))
}

export function ActionShell<M>(
	h: Html.H<M>,
	options: {
		actions: readonly ShellAction<M>[]
		content: View.Input<M>
		overlays?: View.Input<M>
		sidebar?: ShellAction<M>
	}
) {
	const native = Capacitor.getPlatform() === 'ios'
	const {sidebar, actions} = options
	const controls = Option.match(Option.fromUndefinedOr(sidebar), {
		onNone: () => actions,
		onSome: action => [action, ...actions]
	})
	return h.div
		.class('app-shell action-shell')
		.attrs({'data-native': Boolean.match(native, {onFalse: Function.constUndefined, onTrue: Function.constant('')})})
		.children(
			Boolean.match(native, {
				onFalse: () =>
					h.div
						.class('shell-controls')
						.children(
							sidebar !== undefined && ShellButton(h, sidebar),
							Array.isReadonlyArrayNonEmpty(actions) &&
								h.div.class('shell-actions').children(Array.map(actions, action => ShellButton(h, action)))
						),
				onTrue: () => {
					const items = Array.map(controls, action =>
						ToolbarItem.make({
							disabled: action.disabled ?? false,
							id: action.id,
							leading: action === sidebar,
							menu: Option.getOrUndefined(
								Option.map(Option.fromUndefinedOr(action.menu), groups =>
									Array.map(groups, group => ({
										items: Array.map(group.items, item => ({
											checked: item.checked ?? false,
											disabled: item.disabled ?? false,
											id: item.id,
											title: item.title
										})),
										title: group.title
									}))
								)
							),
							selected: action.pressed ?? false,
							symbol: action.symbol,
							title: action.title
						})
					)
					return h.div.attr('hidden', '').onMount(
						Mount.map(DeclaredToolbar({items}), id =>
							pipe(
								controls,
								Array.flatMap(action => {
									if (action.menu === undefined) return [action]
									return Array.flatMap(action.menu, group => group.items)
								}),
								Array.findFirst(action => action.id === id && action.disabled !== true),
								Option.match({onNone: () => Component.noop, onSome: action => action.message})
							)
						)
					)
				}
			}),
			options.content,
			options.overlays
		)
}
