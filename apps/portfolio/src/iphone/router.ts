import {Router} from '@effect/ui'

import {Effect, Function, Layer, Option, String, pipe} from 'effect'

import Linking from 'react-native/Libraries/Linking/Linking'

import {appOrigin, scheme} from '#iphone/origin.ts'
import {PortfolioRoute} from '#screens/routes.ts'

function pathOf(url: string) {
	for (const prefix of [`${scheme}://`, appOrigin]) {
		if (String.startsWith(`${prefix}/`)(url)) return Option.some(String.slice(prefix.length)(url))
	}
	return Option.none()
}

const FollowLinks = Layer.effectDiscard(
	Effect.gen(function* () {
		const router = yield* Router.Router
		yield* Effect.acquireRelease(
			Effect.sync(() =>
				Linking.addEventListener('url', ({url}) => {
					pipe(
						pathOf(url),
						Option.flatMap(PortfolioRoute.parse),
						Option.match({
							onNone: Function.constVoid,
							onSome: route => {
								// oxlint-disable-next-line eslint/no-restricted-properties -- This device event enters the mounted router from outside Effect.
								Effect.runFork(router.replace(route))
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
					routes: PortfolioRoute,
					url: pipe(
						Option.fromNullishOr(url),
						Option.flatMap(pathOf),
						Option.filter(path => Option.isSome(PortfolioRoute.parse(path))),
						Option.getOrElse(() => '/')
					)
				})
			)
	)
)
