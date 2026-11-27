import {Array, MutableRef, Option, Predicate} from 'effect'

import type {AuthRoute} from '#web/routes.ts'

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

export function routePane(route: Extract<typeof AuthRoute.Type, {_tag: 'Home'}>) {
	if (route.search.pane !== undefined) return route.search.pane
	if (route.search.person !== undefined) return 'detail'
	return 'list'
}

export function hasListBehind() {
	const index = window.navigation?.currentEntry?.index ?? 0
	if (index < 1) return false
	// oxlint-disable-next-line @deslop/coding-standards/no-native-method-call -- Navigation owns the browser's session history.
	const url = Option.getOrUndefined(Array.get(window.navigation.entries(), index - 1))?.url
	if (Predicate.isNullish(url)) return false
	const previous = new URL(url)
	if (previous.origin !== location.origin || previous.pathname !== '/') return false
	const pane = previous.searchParams.get('pane')
	return pane === 'list' || (pane === null && !previous.searchParams.has('person'))
}
