import {Mount} from '@effect/ui'
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
