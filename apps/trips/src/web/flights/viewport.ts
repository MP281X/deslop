import {Mount} from '@effect/ui'

import {Array, Effect, Option, Predicate, Stream} from 'effect'

export const FitSheet = Mount.makeStream('Trips/FitSheet', {args: {}}, (sheet: HTMLDialogElement) =>
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

export function hasListBehind() {
	const index = window.navigation?.currentEntry?.index
	if (index === undefined || index < 1) return false
	// oxlint-disable-next-line @deslop/coding-standards/no-native-method-call -- Navigation's own entries() lists the session history.
	const entry = Option.getOrUndefined(Array.get(window.navigation.entries(), index - 1))
	if (Predicate.isNullish(entry?.url)) return false
	const previous = new URL(entry.url)
	if (previous.protocol !== location.protocol || previous.host !== location.host) return false
	return previous.searchParams.get('pane') === 'list'
}
