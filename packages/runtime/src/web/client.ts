import {Effect, Layer, Predicate, Schedule, Stream, pipe} from 'effect'

import {createRouter} from '@tanstack/react-router'
import type {AnyContext, AnyRoute, RouterOptions} from '@tanstack/react-router'
import {FetchHttpClient, HttpClient, HttpClientResponse} from 'effect/http'
import {Atom} from 'effect/reactivity'
import * as Rpc from 'effect/rpc'
import {Socket} from 'effect/socket'

import {Error, NotFound} from '@deslop/components-web/fallbacks'

import {RPC_PATH, RUNTIME_PATH, RuntimeConfig} from '#schema.ts'
import {layerOtlp} from '#telemetry.ts'

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

// A live stream opens again after the socket drops; its other failures reach the screen.
export function reconnecting<A, E extends {_tag: string}, R>(stream: Stream.Stream<A, E, R>) {
	return Stream.retry(stream, $ =>
		pipe(
			$(Schedule.spaced('1 second')),
			Schedule.while(metadata => metadata.input._tag === 'RpcClientError')
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
			Layer.unwrap(
				Effect.gen(function* () {
					const response = yield* (yield* HttpClient.HttpClient).get(RUNTIME_PATH)
					const config = yield* HttpClientResponse.schemaBodyJson(RuntimeConfig)(response)
					if (config.traces === '') return Layer.empty
					return layerOtlp(`${applicationName}-client`, config.traces, 'web', config.version)
				})
			),
			Layer.provide(FetchHttpClient.layer)
		)
	)
	return layerProtocol
}
