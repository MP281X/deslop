import {Router} from '@effect/ui'

import {Boolean, Effect, Function, Layer, Option, String, pipe} from 'effect'

import Linking from 'react-native/Libraries/Linking/Linking'

export function iphonePath(appOrigin: string, scheme: string, url: string) {
	for (const prefix of [`${scheme}://`, appOrigin]) {
		if (String.startsWith(`${prefix}/`)(url)) return Option.some(String.slice(prefix.length)(url))
	}
	return Option.none()
}

// This Effect UI release has no iOS Router host. Feed the shared Router the OS's warm links.
export function followIPhoneLinks(
	navigate: (router: Router.Router, url: string) => Option.Option<Effect.Effect<unknown>>
) {
	return Layer.effectDiscard(
		Effect.gen(function* () {
			const router = yield* Router.Router
			yield* Effect.acquireRelease(
				Effect.sync(() =>
					Linking.addEventListener('url', event => {
						Option.map(navigate(router, event.url), next => {
							// oxlint-disable-next-line eslint/no-restricted-properties -- This device event enters the mounted router from outside Effect.
							Effect.runFork(next)
						})
					})
				),
				subscription => Effect.sync(() => subscription.remove())
			)
		})
	)
}

export function iphoneRouter(
	routes: Router.Routes,
	appOrigin: string,
	scheme: string,
	options: {replace?: (location: Router.Location) => boolean; validateInitial?: boolean} = {}
) {
	function pathOf(url: string) {
		return iphonePath(appOrigin, scheme, url)
	}
	const follow = followIPhoneLinks((router, url) =>
		pipe(
			Option.fromNullishOr(url),
			Option.flatMap(pathOf),
			Option.flatMap(routes.parse),
			Option.map(route =>
				Boolean.match(options.replace?.(router.location()) ?? true, {
					// oxlint-disable-next-line @deslop/coding-standards/no-native-method-call -- This is Effect UI Router navigation.
					onFalse: () => router.push(route),
					onTrue: () => router.replace(route)
				})
			)
		)
	)
	return Layer.unwrap(
		Effect.map(
			Effect.promise(() => Linking.getInitialURL()),
			url =>
				Layer.provideMerge(
					follow,
					Router.memory({
						routes,
						url: pipe(
							Option.fromNullishOr(url),
							Option.flatMap(pathOf),
							Option.filter(path => options.validateInitial !== true || Option.isSome(routes.parse(path))),
							Option.getOrElse(Function.constant('/'))
						)
					})
				)
		)
	)
}
