import {RegistryContext, scheduleTask} from '@effect/atom-react'

import {
	Array,
	Boolean,
	Duration,
	Effect,
	Fiber,
	Function,
	MutableHashMap,
	Option,
	Predicate,
	String,
	pipe
} from 'effect'

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

// Each read a loader holds open, by its atom: a later load of the same read replaces the hold rather than adding one.
const holds = MutableHashMap.empty<Atom.Atom<unknown>, {readonly fiber: Fiber.Fiber<void>; readonly owner: object}>()

function holdOf(atom: Atom.Atom<unknown>) {
	return MutableHashMap.get(holds, atom)
}

// A loader's answer: its page's reads open beside the page's code. A navigation's page reads them as soon as it renders, so they are held 5 seconds; a preload on intent holds them 30, by when the page reads them or they were not wanted. The route renders with their first answers, so a quick read shows no skeleton; after 200ms it renders without them, and its Suspense shows one.
export function preload<E>(
	load: {readonly context: RouterContext; readonly preload: boolean},
	atoms: readonly Atom.Atom<AsyncResult.AsyncResult<unknown, E>>[]
) {
	const hold = Boolean.match(load.preload, {
		onFalse: Function.constant(Duration.seconds(5)),
		onTrue: Function.constant(Duration.seconds(30))
	})
	// oxlint-disable-next-line no-restricted-properties -- TanStack Router awaits a loader's Promise.
	return Effect.runPromise(
		pipe(
			Effect.forEach(
				atoms,
				atom =>
					Effect.gen(function* () {
						const owner = {}
						const previous = holdOf(atom)
						const fiber = yield* pipe(
							AtomRegistry.mount(load.context.registry, atom),
							Effect.andThen(Effect.sleep(hold)),
							Effect.ensuring(
								Effect.sync(() => {
									if (Option.exists(holdOf(atom), held => held.owner === owner)) {
										MutableHashMap.remove(holds, atom)
									}
								})
							),
							Effect.scoped,
							Effect.forkDetach({startImmediately: true})
						)
						MutableHashMap.set(holds, atom, {fiber, owner})
						yield* Option.match(previous, {onNone: () => Effect.void, onSome: held => Fiber.interrupt(held.fiber)})
					}),
				{concurrency: 'unbounded', discard: true}
			),
			Effect.andThen(
				Effect.forEach(atoms, atom => pipe(load.context.registry, AtomRegistry.getResult(atom), Effect.exit), {
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
