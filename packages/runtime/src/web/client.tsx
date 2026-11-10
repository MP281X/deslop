import {
	Array,
	Cause,
	Context,
	Effect,
	Layer,
	MutableRef,
	Option,
	Predicate,
	Schedule,
	Schema,
	Stream,
	String,
	pipe
} from 'effect'

import {RouterProvider, createRouter} from '@tanstack/react-router'
import type {AnyContext, AnyRoute, AnyRouter} from '@tanstack/react-router'
import {FetchHttpClient} from 'effect/http'
import {OtlpExporter} from 'effect/observability'
import {Atom, AtomRegistry} from 'effect/reactivity'
import * as Rpc from 'effect/rpc'
import {Socket} from 'effect/socket'
import {StrictMode} from 'react'
import {createRoot} from 'react-dom/client'

import {Denied, Error, NotFound, SignIn} from '@deslop/components-web/fallbacks'

import {RPC_PATH} from '#schema.ts'
import {layerWebTelemetry} from '#telemetry.ts'

import {isDenied, layerRpcStreamClient, needsSignIn, signInUrl, withoutDeniedData} from '#auth/lib/utils.ts'
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

// Every failed read: sign in without a session, a lock on a refusal, otherwise the one destructive retry.
export function Failure(props: {error: unknown; reset: () => void}) {
	if (needsSignIn(props.error)) return <SignIn href={signInUrl(location.href)} />
	if (isDenied(props.error)) return <Denied />
	return <Error error={props.error} reset={props.reset} />
}

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

// The one way to read a live RPC stream: an outage keeps its content, a refusal clears it, and a transport miss reconnects.
export function live<A, E extends {_tag: string}, R>(get: Atom.AtomContext, stream: Stream.Stream<A, E, R>) {
	return withoutDeniedData(get, stream, reconnecting)
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
	Layer.provideMerge(Rpc.RpcSerialization.layerSchemaBinary()),
	Layer.provideMerge(layerRpcStreamClient)
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
