import {Router} from '@effect/ui'

import {Effect, Layer, Option, String} from 'effect'

import Linking from 'react-native/Libraries/Linking/Linking'

import {appOrigin, scheme} from '#iphone/origin.ts'
import {AppRoute} from '#screens/routes.ts'

function pathOf(url: string | null) {
	if (url === null) return Option.none()
	for (const prefix of [`${scheme}://`, appOrigin]) {
		const path = String.replace(prefix, '')(url)
		if (String.startsWith(prefix)(url) && String.startsWith('/')(path)) return Option.some(path)
	}
	return Option.none()
}

// This Effect UI release has no iOS Router host. Feed the shared Router the OS's cold and warm links.
const FollowLinks = Layer.effectDiscard(
	Effect.gen(function* () {
		const router = yield* Router.Router
		yield* Effect.acquireRelease(
			Effect.sync(() =>
				Linking.addEventListener('url', ({url}) => {
					const route = Option.flatMap(pathOf(url), AppRoute.parse)
					if (Option.isNone(route)) return
					// oxlint-disable-next-line eslint/no-restricted-properties -- This device event enters the mounted router from outside Effect.
					Effect.runFork(
						router.location().route._tag === 'Item' ? router.replace(route.value) : router.push(route.value)
					)
				})
			),
			subscription => Effect.sync(() => subscription.remove())
		)
	})
)

export const layerIPhoneRouter = Layer.unwrap(
	Effect.map(
		Effect.promise(() => Linking.getInitialURL()),
		url =>
			Layer.provideMerge(FollowLinks, Router.memory({routes: AppRoute, url: Option.getOrElse(pathOf(url), () => '/')}))
	)
)
