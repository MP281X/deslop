import {Mount} from '@effect/ui'
import type {View} from '@effect/ui'
import type {Html} from '@effect/ui/html'

import {Array, Boolean, Effect, Option, Queue, Result, Stream} from 'effect'

import {Capacitor} from '@capacitor/core'

import {Glass} from './glass.ts'
import {nativeToolbar} from './native.ts'
import type {ToolbarItem} from './native.ts'

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
