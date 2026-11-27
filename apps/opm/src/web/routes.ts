import {Route} from '@effect/ui'

import {Array, MutableRef, Option, Predicate, Schema} from 'effect'

import type {ChapterIdentity} from '#contracts'
import {ChapterNumberFromString, Series} from '#contracts'

export const OpmRoute = Route.union({
	Library: Route.make('/', {
		search: {chapter: Schema.optional(ChapterNumberFromString), series: Schema.optional(Series)}
	}),
	NotFound: Route.make('/*')
})

export function libraryOf(route: typeof OpmRoute.Type) {
	if (OpmRoute.isAnyOf(['Library'])(route)) return route
	return OpmRoute.Library({params: {}, search: {}})
}

export function targetOf(route: typeof OpmRoute.Type) {
	if (!OpmRoute.isAnyOf(['Library'])(route) || route.search.chapter === undefined) return undefined
	return {number: route.search.chapter, series: route.search.series ?? 'manga'} satisfies ChapterIdentity
}

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
	return previous.origin === location.origin && previous.pathname === '/' && !previous.searchParams.has('chapter')
}
