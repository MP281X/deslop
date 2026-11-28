import {Router} from '@effect/ui'

import {Boolean, Effect, Function, Layer, Option, Schema, pipe} from 'effect'

import Linking from 'react-native/Libraries/Linking/Linking'

import {followIPhoneLinks, iphonePath} from '@deslop/components/native/router'

import {ChapterNumberFromString, Series} from '#contracts'

import {appOrigin, variant} from '#iphone/origin.ts'
import {readChapterActivity} from '#iphone/push.ts'
import {OpmRoute, targetOf} from '#screens/routes.ts'

type ChapterActivityLink = typeof ChapterActivityLink.Type
const ChapterActivityLink = Schema.TemplateLiteralParser([
	variant.scheme,
	'://chapter/',
	Series,
	'/',
	ChapterNumberFromString
])

function linkOf(url: string) {
	return pipe(
		Schema.decodeUnknownOption(ChapterActivityLink)(url),
		Option.map(parts => ({
			activity: Option.some(url),
			route: OpmRoute.Library({params: {}, search: {chapter: parts[4], series: parts[2]}})
		})),
		Option.orElse(() =>
			pipe(
				iphonePath(appOrigin, variant.scheme, url),
				Option.flatMap(OpmRoute.parse),
				Option.map(route => ({activity: Option.none<string>(), route}))
			)
		)
	)
}

function readActivity(link: {activity: Option.Option<string>}) {
	return Option.match(link.activity, {onNone: Function.constant(Effect.void), onSome: readChapterActivity})
}

const FollowLinks = followIPhoneLinks((router, url) =>
	Option.map(linkOf(url), link =>
		pipe(
			!Option.exists(OpmRoute.parse(router.location().url), route => targetOf(route) !== undefined),
			Boolean.match({
				onFalse: () => router.replace(link.route),
				// oxlint-disable-next-line @deslop/coding-standards/no-native-method-call -- This is Effect UI Router navigation.
				onTrue: () => router.push(link.route)
			}),
			Effect.tap(() => readActivity(link))
		)
	)
)

export const layerIPhoneRouter = Layer.unwrap(
	Effect.gen(function* () {
		const initial = Option.flatMap(Option.fromNullishOr(yield* Effect.promise(() => Linking.getInitialURL())), linkOf)
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
