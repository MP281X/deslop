import {Router} from '@effect/ui'

import {Boolean, Effect, Function, Layer, Option, String, pipe} from 'effect'

import Linking from 'react-native/Libraries/Linking/Linking'

import {appOrigin, scheme} from '#iphone/origin.ts'
import {DeployRoute, isDetail} from '#screens/routes.ts'

function pathOf(url: string) {
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
				Linking.addEventListener('url', event => {
					pipe(
						Option.fromNullishOr(event.url),
						Option.flatMap(pathOf),
						Option.flatMap(DeployRoute.parse),
						Option.match({
							onNone: Function.constVoid,
							onSome: route => {
								// oxlint-disable-next-line eslint/no-restricted-properties -- This device event enters the mounted router from outside Effect.
								Effect.runFork(
									pipe(
										router.location().route,
										isDetail,
										Boolean.match({onFalse: () => router.push(route), onTrue: () => router.replace(route)})
									)
								)
							}
						})
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
			Layer.provideMerge(
				FollowLinks,
				Router.memory({
					routes: DeployRoute,
					url: pipe(Option.fromNullishOr(url), Option.flatMap(pathOf), Option.getOrElse(Function.constant('/')))
				})
			)
	)
)
