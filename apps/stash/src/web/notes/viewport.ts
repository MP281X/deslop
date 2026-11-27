import {Mount} from '@effect/ui'

import {Array, Effect, MutableRef, Option, Predicate, Stream} from 'effect'

export const FitComposer = Mount.makeStream('Stash/FitComposer', {args: {}}, (sheet: HTMLDialogElement) =>
	Stream.unwrap(
		Effect.as(
			Effect.acquireRelease(
				Effect.sync(() => {
					const viewport = window.visualViewport
					if (viewport === null) return
					function fit() {
						if (viewport === null) return
						sheet.style.setProperty('--sheet-viewport-height', `${viewport.height}px`)
						sheet.style.setProperty('--sheet-viewport-top', `${viewport.offsetTop}px`)
					}
					fit()
					viewport.addEventListener('resize', fit)
					viewport.addEventListener('scroll', fit)
					return () => {
						viewport.removeEventListener('resize', fit)
						viewport.removeEventListener('scroll', fit)
					}
				}),
				release => Effect.sync(() => release?.())
			),
			Stream.never
		)
	)
)

const uaVisualTransition = MutableRef.make('')

addEventListener(
	'popstate',
	event => {
		if (event.hasUAVisualTransition) MutableRef.set(uaVisualTransition, location.href)
	},
	{capture: true}
)

export function usedHistoryMotion() {
	return MutableRef.getAndSet(uaVisualTransition, '') === location.href
}

export function hasListBehind() {
	const index = navigation.currentEntry?.index
	if (index === undefined || index < 1) return false
	// oxlint-disable-next-line @deslop/coding-standards/no-native-method-call -- Navigation's own entries() lists the session history.
	const entry = Option.getOrUndefined(Array.get(navigation.entries(), index - 1))
	if (Predicate.isNullish(entry?.url)) return false
	const previous = new URL(entry.url)
	if (previous.origin !== location.origin || previous.pathname !== '/') return false
	const pane = previous.searchParams.get('pane')
	return pane === 'list' || (pane === null && !previous.searchParams.has('note'))
}
