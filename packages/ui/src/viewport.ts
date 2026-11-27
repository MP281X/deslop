import {Command, Mount, Router} from '@effect/ui'

import {Array, Effect, MutableRef, Option, Predicate, Stream, pipe} from 'effect'

const historyMotion = MutableRef.make('')

addEventListener(
	'popstate',
	event => {
		if (event.hasUAVisualTransition) MutableRef.set(historyMotion, location.href)
	},
	{capture: true}
)

export function usedHistoryMotion() {
	return MutableRef.getAndSet(historyMotion, '') === location.href
}

export function hasHistoryBehind(matches: (previous: URL) => boolean) {
	// Older WebKit versions do not expose Navigation.
	const history: Partial<Pick<Window, 'navigation'>> = window
	const index = history.navigation?.currentEntry?.index
	if (history.navigation === undefined || index === undefined || index < 1) return false
	// oxlint-disable-next-line @deslop/coding-standards/no-native-method-call -- Navigation owns the browser's session history.
	const entry = Option.getOrUndefined(Array.get(history.navigation.entries(), index - 1))
	if (Predicate.isNullish(entry?.url)) return false
	const previous = new URL(entry.url)
	return previous.origin === location.origin && matches(previous)
}

export const historyBack = Command.asNoop(Router.Back.make({}))

export const FitSheet = Mount.makeStream('Axis/FitSheet', {args: {}}, (sheet: HTMLDialogElement) =>
	Stream.unwrap(
		Effect.as(
			Effect.acquireRelease(
				Effect.sync(() =>
					pipe(
						window.visualViewport,
						Option.fromNullOr,
						Option.map(viewport => {
							function fit() {
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
						Option.getOrUndefined
					)
				),
				release => Effect.sync(() => release?.())
			),
			Stream.never
		)
	)
)
