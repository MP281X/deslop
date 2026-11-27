import {Mount} from '@effect/ui'

import {Effect, Number, Option, Schema, Stream, pipe} from 'effect'

function remember(list: HTMLElement, key: string) {
	const storageKey = `axis-list:${key}`
	function save() {
		if (list.clientHeight > 0) sessionStorage.setItem(storageKey, `${list.scrollTop}`)
	}
	const frame = requestAnimationFrame(() => {
		// Wait for the ready list to be in the DOM; a placeholder cannot hold its offset.
		const top = pipe(
			sessionStorage.getItem(storageKey),
			Option.fromNullOr,
			Option.flatMap(Number.parse),
			Option.getOrUndefined
		)
		if (top !== undefined) list.scrollTo({top})
		list.addEventListener('scroll', save, {passive: true})
	})
	return () => {
		cancelAnimationFrame(frame)
		list.removeEventListener('scroll', save)
	}
}

export const ListPosition = Mount.makeStream(
	'Axis/ListPosition',
	{args: {active: Schema.Boolean, key: Schema.String}},
	(list: HTMLElement, _initial, changes) =>
		Stream.switchMap(changes, ({active, key}) =>
			Stream.unwrap(
				Effect.as(
					Effect.acquireRelease(
						Effect.sync(() => {
							if (active) return remember(list, key)
							return undefined
						}),
						release => Effect.sync(() => release?.())
					),
					Stream.never
				)
			)
		)
)
