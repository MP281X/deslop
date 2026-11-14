import {Array, Function, Option, Predicate, String, pipe} from 'effect'

import {RouterProvider, createRouter} from '@tanstack/react-router'
import type {AnyContext, AnyRoute, AnyRouter} from '@tanstack/react-router'
import {AtomRegistry} from 'effect/reactivity'
import {StrictMode} from 'react'
import {createRoot} from 'react-dom/client'

import {pageErrorAtom} from '@deslop/runtime/web/client'
import type {PageErrorSource} from '@deslop/runtime/web/client'

import {NotFound, ReadFailure} from '#components/fallbacks.tsx'

const reported = new WeakSet<object>()

export function mountRouter<TRouteTree extends AnyRoute & {types: {routerContext: AnyContext}}>(routeTree: TRouteTree) {
	const root = document.querySelector('#root')
	if (Predicate.isNull(root)) throw new TypeError('Missing application mount element with id "root"')
	const router = createRouter({
		context: {},
		defaultErrorComponent: ReadFailure,
		defaultNotFoundComponent: NotFound,
		defaultPreload: 'intent',
		routeTree,
		scrollRestoration: true
	})
	const errors = AtomRegistry.make()
	function report(error: unknown, source: PageErrorSource, stack?: string | null) {
		if (Predicate.isObjectOrArray(error)) {
			if (reported.has(error)) return
			reported.add(error)
		}
		errors.set(pageErrorAtom, {
			error,
			route: pipe(
				Array.findLast(router.state.matches, match => match.error === error),
				Option.orElse(() => Array.last(router.state.matches)),
				Option.flatMap(match => Option.liftPredicate(match.routeId, String.isString)),
				Option.getOrElse(Function.constant('__root__'))
			),
			source,
			stack
		})
	}
	// The typed router takes full options in `update`; this view merges the partial one the router has always accepted.
	const anyRouter: AnyRouter = router
	anyRouter.update({defaultOnCatch: (error, caught) => report(error, 'route', caught.componentStack)})
	createRoot(root, {
		onCaughtError: (error, caught) => report(error, 'caught', caught.componentStack),
		onUncaughtError: (error, caught) => report(error, 'uncaught', caught.componentStack)
	}).render(
		<StrictMode>
			<RouterProvider router={router} />
		</StrictMode>
	)
	return router
}
