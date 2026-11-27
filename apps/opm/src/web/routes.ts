import {Route} from '@effect/ui'

import {Schema} from 'effect'

import {ChapterNumberFromString, Series} from '#contracts'
import type {ChapterIdentity} from '#contracts'

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
