import {Mount} from '@effect/ui'
import type {View} from '@effect/ui'
import type {Html} from '@effect/ui/html'

import {Effect, MutableRef, Option, Schema, Stream, pipe} from 'effect'

import {button} from '@ui-sdk/core/button'
import {applyAttrs, attrs, bind, releaseAttrs, subscribe} from '@ui-sdk/core/renderer'

const SERIAL = MutableRef.make(0)

export type ButtonType = typeof ButtonType.Type
const ButtonType = Schema.Literals(['button', 'submit', 'reset'])

// As in the Svelte adapter, the host mount owns one UI SDK instance and its bound part.
const BindButton = Mount.makeStream(
	'BindButton',
	{args: {disabled: Schema.Boolean, type: ButtonType}},
	(node: HTMLButtonElement, options, changes) =>
		Stream.unwrap(
			Effect.map(
				Effect.acquireRelease(
					Effect.sync(() => {
						const id = `ui-sdk-button-${MutableRef.getAndIncrement(SERIAL)}`
						const instance = button({...options, id})
						const part = instance.part('root')
						const unbind = bind(part, node)
						function render() {
							applyAttrs(node, attrs(part))
						}
						const unsubscribe = subscribe(part, render)
						render()
						return {id, instance, unbind, unsubscribe}
					}),
					({instance, unbind, unsubscribe}) =>
						Effect.sync(() => {
							unsubscribe()
							unbind()
							releaseAttrs(node, 'render')
							instance.destroy()
						})
				),
				({id, instance}) =>
					pipe(
						changes,
						Stream.tap(next => Effect.sync(() => instance.setOptions({...next, id}))),
						Stream.drain
					)
			)
		)
)

export function Button<M>(h: Html.H<M>, options: {disabled?: boolean; pressed?: boolean; type?: ButtonType} = {}) {
	const type = options.type ?? 'button'
	return h.button
		.attr('type', type)
		.attr('aria-pressed', Option.getOrUndefined(Option.map(Option.fromUndefinedOr(options.pressed), x => `${x}`)))
		.onMount(BindButton({disabled: options.disabled ?? false, type}))
}

export function PopoverPanel<M>(h: Html.H<M>, id: string, label: string, children: View.Input<M>) {
	return h.div
		.class('axis-popover')
		.id(id)
		.attrs({'aria-label': label, popover: 'auto', role: 'group'})
		.children(h.div.class('axis-popover-body').children(children))
}

export const PressFeedback = Mount.makeStream('PressFeedback', {args: {}}, (root: HTMLElement) =>
	Stream.unwrap(
		Effect.as(
			Effect.acquireRelease(
				Effect.sync(() => {
					const touch = MutableRef.make(Option.none<{node: Element; pointer: number; x: number; y: number}>())
					function clear() {
						Option.getOrUndefined(MutableRef.get(touch))?.node.removeAttribute('data-touch-pressed')
						MutableRef.set(touch, Option.none())
					}
					function start(event: PointerEvent) {
						if (event.pointerType !== 'touch' || !event.isPrimary || !(event.target instanceof Element)) return
						const node = event.target.closest('button, [data-pressable]')
						if (node === null || node.matches(':disabled, [aria-disabled="true"]')) return
						clear()
						node.setAttribute('data-touch-pressed', '')
						MutableRef.set(touch, Option.some({node, pointer: event.pointerId, x: event.clientX, y: event.clientY}))
					}
					function move(event: PointerEvent) {
						const press = Option.getOrUndefined(MutableRef.get(touch))
						if (press === undefined || event.pointerId !== press.pointer) return
						if (Math.hypot(event.clientX - press.x, event.clientY - press.y) > 8) clear()
					}
					root.addEventListener('pointerdown', start)
					root.addEventListener('pointermove', move)
					root.addEventListener('pointerup', clear)
					root.addEventListener('pointercancel', clear)
					root.addEventListener('scroll', clear, true)
					return () => {
						clear()
						root.removeEventListener('pointerdown', start)
						root.removeEventListener('pointermove', move)
						root.removeEventListener('pointerup', clear)
						root.removeEventListener('pointercancel', clear)
						root.removeEventListener('scroll', clear, true)
					}
				}),
				release => Effect.sync(release)
			),
			Stream.never
		)
	)
)
