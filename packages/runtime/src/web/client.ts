import {Config, ConfigProvider, Effect, Layer, Predicate, pipe} from 'effect'

import {createRouter} from '@tanstack/react-router'
import type {AnyContext, AnyRoute} from '@tanstack/react-router'
import {Atom} from 'effect/reactivity'
import * as Rpc from 'effect/rpc'
import {Socket} from 'effect/socket'

import {Error, Loading, NotFound} from '@deslop/components-web/fallbacks'

import {layerWebSdk} from '#telemetry.ts'

export function makeRouter<TRouteTree extends AnyRoute & {types: {routerContext: AnyContext}}>(routeTree: TRouteTree) {
	const root = document.querySelector('#root')
	if (Predicate.isNull(root)) throw new TypeError('Missing application mount element with id "root"')

	return {
		root,
		router: createRouter({
			context: {},
			defaultErrorComponent: Error,
			defaultNotFoundComponent: NotFound,
			defaultPendingComponent: Loading,
			defaultPendingMs: 0,
			defaultPreload: 'intent',
			routeTree,
			scrollRestoration: true
		})
	}
}

export function layer(applicationName: string) {
	const protocol = pipe(
		// The default ping timeout equals the 5-second ping interval, so any pong delay closes the socket.
		Rpc.RpcClient.layerProtocolSocket({pingTimeout: '15 seconds', retryTransientErrors: true}),
		Layer.provide(
			pipe(
				Socket.layerWebSocket(Effect.sync(() => `${location.origin}/api/rpc`)),
				Layer.provide(Socket.layerWebSocketConstructorGlobal)
			)
		),
		Layer.provideMerge(Rpc.RpcSerialization.layerSchemaBinary())
	)

	Atom.runtime.addGlobalLayer(
		pipe(
			Layer.unwrap(
				Effect.map(pipe(Config.URL('VITE_OTEL_URL'), Config.withDefault(new URL('http://localhost:4318'))), url =>
					layerWebSdk(`${applicationName}-client`, url)
				)
			),
			Layer.provide(ConfigProvider.layer(ConfigProvider.fromUnknown(import.meta.env)))
		)
	)
	return protocol
}
