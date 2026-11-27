import {Command, Route, Router} from '@effect/ui'

import {Effect, Schema} from 'effect'

import {ChapterNumberFromString, Series} from '#contracts'
import type {ChapterIdentity} from '#contracts'

export type OpmRoute = typeof OpmRoute.Type
export const OpmRoute = Route.union({
	Library: Route.make('/', {
		search: {chapter: Schema.optional(ChapterNumberFromString), series: Schema.optional(Series)}
	}),
	NotFound: Route.make('/*')
})

export function libraryOf(route: OpmRoute) {
	if (OpmRoute.isAnyOf(['Library'])(route)) return route
	return OpmRoute.Library({params: {}, search: {}})
}

export function targetOf(route: OpmRoute) {
	if (!OpmRoute.isAnyOf(['Library'])(route) || route.search.chapter === undefined) return undefined
	return {number: route.search.chapter, series: route.search.series ?? 'manga'} satisfies ChapterIdentity
}

export class CloseChapter extends Command.Service<CloseChapter>()('Opm/Close', {
	args: {back: Schema.Boolean, route: OpmRoute}
}) {
	static readonly layer = this.toLayer(
		Effect.map(Router.Router, router => request => {
			if (OpmRoute.isAnyOf(['NotFound'])(request.route)) return Effect.asVoid(router.replace(libraryOf(request.route)))
			if (request.back) return Effect.asVoid(router.back)
			return Effect.asVoid(router.patchSearch(request.route, {chapter: undefined}, {scroll: false}))
		})
	)
}
