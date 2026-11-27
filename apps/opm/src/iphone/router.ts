import {Router} from '@effect/ui'

import {Boolean, Effect, Function, Layer, Option, Schema, String, pipe} from 'effect'

import Linking from 'react-native/Libraries/Linking/Linking'

import {ChapterNumberFromString, Series} from '#contracts'

import {appOrigin, scheme} from '#iphone/origin.ts'
import {readChapterActivity} from '#iphone/push.ts'
import {OpmRoute, targetOf} from '#screens/routes.ts'

const ChapterActivityLink = Schema.TemplateLiteralParser([scheme, '://chapter/', Series, '/', ChapterNumberFromString])

function linkOf(url: string) {
	const activity = Schema.decodeUnknownOption(ChapterActivityLink)(url)
	if (Option.isSome(activity)) {
		const [, , series, , chapter] = activity.value
		return Option.some({activity: url, route: OpmRoute.Library({params: {}, search: {chapter, series}})})
	}
	for (const prefix of [`${scheme}://`, appOrigin]) {
		if (!String.startsWith(prefix)(url)) continue
		const path = String.slice(prefix.length)(url)
		if (String.startsWith('/')(path)) {
			return Option.map(OpmRoute.parse(path), route => ({activity: undefined, route}))
		}
	}
	return Option.none()
}

function readActivity(link: {activity: string | undefined}) {
	if (link.activity === undefined) return Effect.void
	return readChapterActivity(link.activity)
}

const FollowLinks = Layer.effectDiscard(
	Effect.gen(function* () {
		const router = yield* Router.Router
		yield* Effect.acquireRelease(
			Effect.sync(() =>
				Linking.addEventListener('url', event => {
					Option.map(linkOf(event.url), link => {
						// oxlint-disable-next-line eslint/no-restricted-properties -- The iPhone hands warm links to the mounted router here.
						Effect.runFork(
							pipe(
								Boolean.match(
									!Option.exists(OpmRoute.parse(router.location().url), route => targetOf(route) !== undefined),
									{onFalse: () => router.replace(link.route), onTrue: () => router.push(link.route)}
								),
								Effect.tap(() => readActivity(link))
							)
						)
					})
				})
			),
			subscription => Effect.sync(() => subscription.remove())
		)
	})
)

export const layerIPhoneRouter = Layer.unwrap(
	Effect.gen(function* () {
		const url = yield* Effect.promise(() => Linking.getInitialURL())
		const initial = pipe(Option.fromNullishOr(url), Option.flatMap(linkOf))
		yield* Option.match(initial, {onNone: () => Effect.void, onSome: readActivity})
		return Layer.provideMerge(
			FollowLinks,
			Router.memory({
				routes: OpmRoute,
				url: pipe(
					initial,
					Option.map(link => OpmRoute.print(link.route)),
					Option.getOrElse(Function.constant('/'))
				)
			})
		)
	})
)
