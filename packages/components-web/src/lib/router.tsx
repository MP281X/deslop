import {RegistryContext, scheduleTask} from '@effect/atom-react'

import {Array, Effect, Function, Option, Predicate, String, pipe} from 'effect'

import {RouterProvider, createRouter, defaultStringifySearch} from '@tanstack/react-router'
import type {AnyRoute, AnyRouter} from '@tanstack/react-router'
import {AtomRegistry} from 'effect/reactivity'
import type {AsyncResult, Atom} from 'effect/reactivity'
import {StrictMode, use} from 'react'
import {createRoot} from 'react-dom/client'

import {pageErrorAtom} from '@deslop/runtime/web/client'
import type {PageErrorSource} from '@deslop/runtime/web/client'
import {searchSerializerOf} from '@deslop/runtime/web/search'

import {NotFound, ReadFailure} from '#components/blocks/states.tsx'

const reported = new WeakSet<object>()

// What every route's loader is given: the registry its page's atoms live in.
export type RouterContext = {readonly registry: AtomRegistry.AtomRegistry}

// A loader's answer: its page's reads open beside the page's code and stay open half a minute, by when the page reads them or they were not wanted. The route renders with their first answers, so a quick read shows no skeleton; after 200ms it renders without them, and its Suspense shows one.
export function preload<E>(context: RouterContext, atoms: readonly Atom.Atom<AsyncResult.AsyncResult<unknown, E>>[]) {
	// oxlint-disable-next-line no-restricted-properties -- TanStack Router awaits a loader's Promise.
	return Effect.runPromise(
		pipe(
			Effect.forEach(atoms, atom => AtomRegistry.mount(context.registry, atom), {
				concurrency: 'unbounded',
				discard: true
			}),
			Effect.andThen(Effect.sleep('30 seconds')),
			Effect.scoped,
			Effect.forkDetach,
			Effect.andThen(
				Effect.forEach(atoms, atom => pipe(context.registry, AtomRegistry.getResult(atom), Effect.exit), {
					concurrency: 'unbounded',
					discard: true
				})
			),
			Effect.timeoutOption('200 millis'),
			Effect.asVoid
		)
	)
}

// The router once its first load, the route's code and loaders, has resolved: the first paint is the page, not a pending match whose content React would then hold for 300ms.
function Routes(props: {loaded: ReturnType<AnyRouter['load']>; router: AnyRouter}) {
	use(props.loaded)
	return <RouterProvider router={props.router} />
}

// `search` is the app's search schema, whose Option fields the URL writes through its codec.
export function mountRouter<TRouteTree extends AnyRoute & {types: {routerContext: RouterContext}}>(
	routeTree: TRouteTree,
	search?: Parameters<typeof searchSerializerOf>[0]
) {
	const root = document.querySelector('#root')
	if (Predicate.isNull(root)) throw new TypeError('Missing application mount element with id "root"')
	const registry = AtomRegistry.make({defaultIdleTTL: 400, scheduleTask})
	const router = createRouter({
		context: {registry},
		defaultErrorComponent: ReadFailure,
		defaultNotFoundComponent: NotFound,
		defaultPreload: 'intent',
		routeTree,
		scrollRestoration: true,
		stringifySearch: Option.match(Option.fromUndefinedOr(search), {
			onNone: () => defaultStringifySearch,
			onSome: schema => searchSerializerOf(schema, defaultStringifySearch)
		})
	})
	function report(error: unknown, source: PageErrorSource, stack?: string | null) {
		if (Predicate.isObjectOrArray(error)) {
			if (reported.has(error)) return
			reported.add(error)
		}
		registry.set(pageErrorAtom, {
			error,
			route: pipe(
				Array.findLast(router.state.matches, match => match.error === error),
				Option.orElse(() => Array.last(router.state.matches)),
				Option.flatMap(match => Option.liftPredicate(match.routeId, String.isString)),
				Option.getOrElse(Function.constant('__root__'))
			),
			source,
			...Option.match(Option.fromUndefinedOr(stack), {onNone: () => ({}), onSome: value => ({stack: value})})
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
			<RegistryContext.Provider value={registry}>
				<Routes loaded={router.load()} router={router} />
			</RegistryContext.Provider>
		</StrictMode>
	)
	return router
}
