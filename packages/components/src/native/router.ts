import {Router} from '@effect/ui'

import {Boolean, Effect, Function, Layer, Option, String, pipe} from 'effect'

import Linking from 'react-native/Libraries/Linking/Linking'

function iphonePath(appOrigin: string, scheme: string, url: string) {
	for (const prefix of [`${scheme}://`, appOrigin]) {
		if (String.startsWith(`${prefix}/`)(url)) return Option.some(String.slice(prefix.length)(url))
	}
	return Option.none()
}

// This Effect UI release has no iOS Router host. Feed the shared Router the OS's warm links.
function followIPhoneLinks(navigate: (router: Router.Router, url: string) => Option.Option<Effect.Effect<unknown>>) {
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

// Where a link opens and what to do once it has: an app's own link can mean more than a path.
export type IPhoneLink = {readonly followed: Effect.Effect<void>; readonly path: string}

export function iphoneRouter(
	routes: Router.Routes,
	appOrigin: string,
	scheme: string,
	options: {
		link?: (url: string) => Option.Option<IPhoneLink>
		replace?: (location: Router.Location) => boolean
		validateInitial?: boolean
	} = {}
) {
	function linkOf(url: string) {
		return pipe(
			Option.fromUndefinedOr(options.link),
			Option.flatMap(link => link(url)),
			Option.orElse(() =>
				Option.map(iphonePath(appOrigin, scheme, url), path => ({followed: Effect.void, path}) satisfies IPhoneLink)
			)
		)
	}
	const follow = followIPhoneLinks((router, url) =>
		pipe(
			Option.fromNullishOr(url),
			Option.flatMap(linkOf),
			Option.flatMap(link =>
				Option.map(routes.parse(link.path), route =>
					pipe(
						options.replace?.(router.location()) ?? true,
						Boolean.match({
							// oxlint-disable-next-line @deslop/coding-standards/no-native-method-call -- This is Effect UI Router navigation.
							onFalse: () => router.push(route),
							onTrue: () => router.replace(route)
						}),
						Effect.tap(() => link.followed)
					)
				)
			)
		)
	)
	return Layer.unwrap(
		Effect.gen(function* () {
			const initial = Option.flatMap(Option.fromNullishOr(yield* Effect.promise(() => Linking.getInitialURL())), linkOf)
			yield* Option.match(initial, {onNone: () => Effect.void, onSome: link => link.followed})
			return Layer.provideMerge(
				follow,
				Router.memory({
					routes,
					url: pipe(
						initial,
						Option.map(link => link.path),
						Option.filter(path => options.validateInitial !== true || Option.isSome(routes.parse(path))),
						Option.getOrElse(Function.constant('/'))
					)
				})
			)
		})
	)
}
