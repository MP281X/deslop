import {
	Array,
	Cause,
	Context,
	Effect,
	Layer,
	MutableRef,
	Option,
	Predicate,
	Record,
	Schedule,
	Schema,
	Stream,
	String,
	pipe
} from 'effect'

import {RouterProvider, createRouter} from '@tanstack/react-router'
import type {AnyContext, AnyRoute, AnyRouter, RouterOptions} from '@tanstack/react-router'
import {FetchHttpClient} from 'effect/http'
import {OtlpExporter} from 'effect/observability'
import {Atom, AtomRegistry} from 'effect/reactivity'
import * as Rpc from 'effect/rpc'
import {Socket} from 'effect/socket'
import {StrictMode} from 'react'
import {createRoot} from 'react-dom/client'

import {Error, NotFound} from '@deslop/components-web/fallbacks'

import {RPC_PATH} from '#schema.ts'
import {layerWebTelemetry} from '#telemetry.ts'

import {AuthError} from '#auth/schema.ts'

const errorTelemetry = MutableRef.make(Option.none<Context.Context<never>>())
const reported = new WeakSet<object>()

const errorAtom = Atom.fn(
	(failure: {error: unknown; route: string; source: 'route' | 'caught' | 'uncaught'; stack?: string | null}) => {
		const log = Effect.logError(
			'Web error',
			Cause.fail(failure.error),
			...Option.toArray(Option.fromNullishOr(failure.stack))
		)
		return Option.match(MutableRef.get(errorTelemetry), {
			onNone: () => log,
			onSome: services =>
				Effect.provideContext(
					pipe(
						log,
						Effect.andThen(Effect.die(failure.error)),
						Effect.withSpan('Web.error', {
							attributes: {'web.error.source': failure.source, 'web.route.id': failure.route},
							root: true
						}),
						Effect.exit
					),
					services
				)
		})
	}
)

export function makeRouter<TRouteTree extends AnyRoute & {types: {routerContext: AnyContext}}>(
	routeTree: TRouteTree,
	getScrollRestorationKey?: RouterOptions<TRouteTree, 'never'>['getScrollRestorationKey']
) {
	const root = document.querySelector('#root')
	if (Predicate.isNull(root)) throw new TypeError('Missing application mount element with id "root"')

	return {
		root,
		router: createRouter({
			context: {},
			defaultErrorComponent: Error,
			defaultNotFoundComponent: NotFound,
			defaultPreload: 'intent',
			getScrollRestorationKey,
			routeTree,
			scrollRestoration: true
		})
	}
}

// The page's router under StrictMode, mounted where makeRouter found #root.
export function mount(app: {root: Element; router: AnyRouter}) {
	const errors = AtomRegistry.make()
	function report(error: unknown, source: 'route' | 'caught' | 'uncaught', stack?: string | null) {
		if (Predicate.isObjectOrArray(error)) {
			if (reported.has(error)) return
			reported.add(error)
		}
		errors.set(errorAtom, {
			error,
			route: pipe(
				Array.findLast(app.router.state.matches, match => match.error === error),
				Option.orElse(() => Array.last(app.router.state.matches)),
				Option.flatMap(match => Option.liftPredicate(match.routeId, String.isString)),
				Option.getOrElse(() => '__root__')
			),
			source,
			stack
		})
	}
	app.router.update({defaultOnCatch: (error, info) => report(error, 'route', info.componentStack)})
	createRoot(app.root, {
		onCaughtError: (error, info) => report(error, 'caught', info.componentStack),
		onUncaughtError: (error, info) => report(error, 'uncaught', info.componentStack)
	}).render(
		<StrictMode>
			<RouterProvider router={app.router} />
		</StrictMode>
	)
}

// Every app's icon by its folder, from the icon glob a page runs four levels above its own routes.
export function appIcons(icons: Record<string, string>) {
	return Record.fromEntries(
		Array.map(Record.toEntries(icons), entry => [String.split(entry[0], '/')[4] ?? '', entry[1]] as const)
	)
}

// A live stream recovers from transport and authorization outages, never a refusal or domain failure.
export function reconnecting<A, E extends {_tag: string}, R>(stream: Stream.Stream<A, E, R>) {
	return pipe(
		stream,
		Stream.retry($ =>
			pipe(
				$(Schedule.spaced('1 second')),
				Schedule.while(
					metadata =>
						metadata.input._tag === 'RpcClientError' ||
						(Schema.is(AuthError)(metadata.input) && metadata.input.error === 'temporarily_unavailable')
				)
			)
		)
	)
}

// The RPC socket alone, without the page's telemetry, so Scope's page never traces itself.
export const layerProtocol = pipe(
	// The default ping timeout equals the 5-second ping interval, so any pong delay closes the socket.
	Rpc.RpcClient.layerProtocolSocket({pingTimeout: '15 seconds', retryTransientErrors: true}),
	Layer.provide(
		pipe(
			Socket.layerWebSocket(Effect.sync(() => `${location.origin}${RPC_PATH}`)),
			Layer.provide(Socket.layerWebSocketConstructorGlobal)
		)
	),
	Layer.provideMerge(Rpc.RpcSerialization.layerSchemaBinary())
)

export function layer(applicationName: string) {
	Atom.runtime.addGlobalLayer(
		pipe(
			layerWebTelemetry(applicationName),
			Layer.provide(FetchHttpClient.layer),
			Layer.tap(services => {
				if (Option.isNone(Context.getOption(services, OtlpExporter.Flusher))) return Effect.void
				return Effect.acquireRelease(
					Effect.sync(() => MutableRef.set(errorTelemetry, Option.some(services))),
					() =>
						Effect.sync(() =>
							MutableRef.update(
								errorTelemetry,
								Option.filter(current => current !== services)
							)
						)
				)
			})
		)
	)
	return layerProtocol
}
