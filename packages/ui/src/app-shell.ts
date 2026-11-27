import {Component, Mount} from '@effect/ui'
import type {View} from '@effect/ui'
import type {Html} from '@effect/ui/html'

import {Array, Boolean, Effect, Function, Option, Queue, Result, Schema, Stream, pipe} from 'effect'

import {Capacitor} from '@capacitor/core'

import {Button} from './control.ts'
import {Glass} from './glass.ts'
import {ToolbarItem, nativeToolbar} from './native.ts'
import {SymbolIcon} from './symbol.ts'
import type {SymbolName} from './symbol.ts'

const SYMBOLS: Readonly<Partial<Record<string, string>>> = {
	'Airport travel': 'location',
	'New note': 'square.and.pencil',
	'Next page': 'chevron.left',
	'Note options': 'ellipsis',
	'Out of date. Retry': 'exclamationmark.circle',
	'Paste booking': 'document.on.clipboard',
	'Paste link': 'plus',
	'Previous page': 'chevron.right',
	'Queue options': 'line.3.horizontal.decrease',
	Share: 'square.and.arrow.up',
	Sidebar: 'sidebar.left',
	'Sign out': 'rectangle.portrait.and.arrow.right'
}

function toolbarButtons(element: HTMLElement) {
	return Array.fromIterable(element.querySelectorAll<HTMLButtonElement>('button[aria-label]:not([popover] *)'))
}

const Toolbar = Mount.makeStream('NativeToolbar', {args: {}}, (element: HTMLElement) =>
	nativeToolbar(
		Stream.callback<readonly ToolbarItem[]>(queue =>
			Effect.acquireRelease(
				Effect.sync(() => {
					function publish() {
						// Panels inside the action group still accept input when opened in the top layer.
						for (const panel of element.querySelectorAll<HTMLElement>('[popover]')) {
							panel.style.setProperty('pointer-events', 'auto')
						}
						Queue.offerUnsafe(
							queue,
							Array.filterMap(toolbarButtons(element), button => {
								const title = button.getAttribute('aria-label') ?? ''
								const symbol = SYMBOLS[title]
								if (symbol === undefined) return Result.fail(undefined)
								button.setAttribute('tabindex', '-1')
								button.style.setProperty('pointer-events', 'none')
								button.setAttribute('aria-hidden', 'true')
								// Trips renders distinct sidebar buttons for the compact and wide layouts.
								if (button.getClientRects().item(0) === null) return Result.fail(undefined)
								return Result.succeed({
									disabled: button.disabled,
									id: title,
									leading: title === 'Sidebar',
									selected: button.getAttribute('aria-pressed') === 'true',
									symbol,
									title
								})
							})
						)
					}
					const observer = new MutationObserver(publish)
					observer.observe(element, {
						attributeFilter: ['aria-label', 'aria-pressed', 'disabled'],
						childList: true,
						subtree: true
					})
					addEventListener('resize', publish)
					publish()
					return () => {
						removeEventListener('resize', publish)
						observer.disconnect()
					}
				}),
				dispose => Effect.sync(dispose)
			)
		),
		title => {
			Option.getOrUndefined(
				Array.findFirst(
					toolbarButtons(element),
					button => button.getAttribute('aria-label') === title && button.getClientRects().item(0) !== null
				)
			)?.click()
		}
	)
)

export function AppShell<M>(
	h: Html.H<M>,
	options: {sidebar: View.Input<M>; actions?: View.Input<M>; content: View.Input<M>}
) {
	const controls = h.div
		.class('shell-controls')
		.children(options.sidebar, options.actions !== undefined && Glass(h, 'shell-actions').children(options.actions))
	// The web buttons still own their click handlers and are the anchors for HTML popovers.
	return h.div
		.class('app-shell')
		.children(
			Boolean.match(Capacitor.getPlatform() === 'ios', {
				onFalse: () => controls,
				onTrue: () =>
					controls
						.attr(
							'style',
							'position:fixed;inset-block-start:env(safe-area-inset-top,0px);inset-inline-end:env(safe-area-inset-right,0px);opacity:0;pointer-events:none;overflow:visible'
						)
						.onMount(Toolbar({}))
			}),
			options.content
		)
}

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

function ShellButton<M>(h: Html.H<M>, action: ShellAction<M>) {
	const disabled = action.disabled ?? false
	return Option.match(Option.fromUndefinedOr(action.pressed), {
		onNone: () => Button(h, {disabled}),
		onSome: pressed => Button(h, {disabled, pressed})
	})
		.key(action.id)
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
							sidebar !== undefined && Glass(h).children(ShellButton(h, sidebar)),
							Array.isReadonlyArrayNonEmpty(actions) &&
								Glass(h, 'shell-actions').children(Array.map(actions, action => ShellButton(h, action)))
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
