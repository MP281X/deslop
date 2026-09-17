import * as WebSdk from '@effect/opentelemetry/WebSdk'

import {Config, ConfigProvider, Effect, Layer, Predicate, pipe} from 'effect'

import {OTLPLogExporter} from '@opentelemetry/exporter-logs-otlp-http'
import {OTLPTraceExporter} from '@opentelemetry/exporter-trace-otlp-http'
import {BatchLogRecordProcessor} from '@opentelemetry/sdk-logs'
import {BatchSpanProcessor} from '@opentelemetry/sdk-trace-base'
import {createRouter} from '@tanstack/react-router'
import type {AnyContext, AnyRoute} from '@tanstack/react-router'
import {Atom} from 'effect/unstable/reactivity'
import * as Rpc from 'effect/unstable/rpc'
import {Socket} from 'effect/unstable/socket'

import {Error, Loading, NotFound} from '@deslop/components/fallbacks'

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
		Rpc.RpcClient.layerProtocolSocket({retryTransientErrors: true}),
		Layer.provide(
			pipe(
				Socket.layerWebSocket(Effect.sync(() => `${location.origin}/api/rpc`)),
				Layer.provide(Socket.layerWebSocketConstructorGlobal)
			)
		),
		Layer.provideMerge(Rpc.RpcSerialization.layerMsgPack)
	)
	const telemetry = pipe(
		Layer.unwrap(
			Effect.map(pipe(Config.url('VITE_OTEL_URL'), Config.withDefault(new URL('http://localhost:4318'))), url =>
				WebSdk.layer(() => ({
					logRecordProcessor: new BatchLogRecordProcessor({
						exporter: new OTLPLogExporter({url: new URL('/v1/logs', url).href})
					}),
					resource: {serviceName: `${applicationName}-client`},
					spanProcessor: new BatchSpanProcessor(new OTLPTraceExporter({url: new URL('/v1/traces', url).href}))
				}))
			)
		),
		Layer.provide(ConfigProvider.layer(ConfigProvider.fromUnknown(import.meta.env)))
	)

	Atom.runtime.addGlobalLayer(telemetry)
	return protocol
}
