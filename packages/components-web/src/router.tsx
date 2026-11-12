import {Array, Option, Predicate, Schema, String, pipe} from 'effect'

import {RouterProvider, createRouter} from '@tanstack/react-router'
import type {AnyContext, AnyRoute, AnyRouter} from '@tanstack/react-router'
import {AtomRegistry} from 'effect/reactivity'
import {StrictMode} from 'react'
import {createRoot} from 'react-dom/client'

import {errorAtom} from '@deslop/runtime/web/client'

import {Failure, NotFound} from '#components/fallbacks.tsx'

const reported = new WeakSet<object>()

export function mount<TRouteTree extends AnyRoute & {types: {routerContext: AnyContext}}>(routeTree: TRouteTree) {
	const root = document.querySelector('#root')
	if (Predicate.isNull(root)) throw new TypeError('Missing application mount element with id "root"')
	const router = createRouter({
		context: {},
		defaultErrorComponent: Failure,
		defaultNotFoundComponent: NotFound,
		defaultPreload: 'intent',
		routeTree,
		scrollRestoration: true
	})
	const errors = AtomRegistry.make()
	function report(error: unknown, source: 'route' | 'caught' | 'uncaught', stack?: string | null) {
		if (Predicate.isObjectOrArray(error)) {
			if (reported.has(error)) return
			reported.add(error)
		}
		errors.set(errorAtom, {
			error,
			route: pipe(
				Array.findLast(router.state.matches, match => match.error === error),
				Option.orElse(() => Array.last(router.state.matches)),
				Option.flatMap(match => Option.liftPredicate(match.routeId, String.isString)),
				Option.getOrElse(() => '__root__')
			),
			source,
			stack
		})
	}
	// The typed router takes full options in `update`; this view merges the partial one the router has always accepted.
	const anyRouter: AnyRouter = router
	anyRouter.update({defaultOnCatch: (error, info) => report(error, 'route', info.componentStack)})
	createRoot(root, {
		onCaughtError: (error, info) => report(error, 'caught', info.componentStack),
		onUncaughtError: (error, info) => report(error, 'uncaught', info.componentStack)
	}).render(
		<StrictMode>
			<RouterProvider router={router} />
		</StrictMode>
	)
	return router
}

export function searchOf<S extends Schema.Decoder<object>>(schema: S) {
	return (search: Record<string, unknown>) =>
		Option.getOrElse(Schema.decodeOption(schema)(search), () => Schema.decodeSync(schema)({}))
}
