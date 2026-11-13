import {Cause, Context, Effect, Layer, MutableRef, Option, pipe} from 'effect'

import {FetchHttpClient, HttpClient, HttpClientResponse} from 'effect/http'
import {OtlpExporter} from 'effect/observability'
import {Atom} from 'effect/reactivity'
import * as Rpc from 'effect/rpc'
import {Socket} from 'effect/socket'

import {layerRpcStreamClient} from '#shared/rpc.ts'
import {Account, RPC_PATH, RUNTIME_PATH, RuntimeConfig} from '#shared/schema.ts'
import {layerOtlp} from '#shared/telemetry.ts'

const errorTelemetry = MutableRef.make(Option.none<Context.Context<never>>())

// One page error, logged and traced as its own root span once the page's telemetry is up.
export const errorAtom = Atom.fn(
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

// The signed-in account the runtime serves; without an issuer it is the developer, who cannot sign out.
export const accountAtom = Atom.runtime(FetchHttpClient.layer).atom(
	pipe(
		HttpClient.get('/auth/user'),
		Effect.flatMap(HttpClientResponse.filterStatusOk),
		Effect.flatMap(HttpClientResponse.schemaBodyJson(Account))
	)
)

// fallow-ignore-next-line unused-export -- the tests drive the runtime-config discovery directly.
export function layerWebTelemetry(applicationName: string) {
	return Layer.unwrap(
		Effect.gen(function* () {
			const config = yield* pipe(
				(yield* HttpClient.HttpClient).get(RUNTIME_PATH),
				Effect.flatMap(HttpClientResponse.filterStatusOk),
				Effect.flatMap(HttpClientResponse.schemaBodyJson(RuntimeConfig)),
				Effect.timeout('3 seconds'),
				Effect.tapError(error => Effect.logWarning('Telemetry is off: the runtime config did not load', error)),
				Effect.option
			)
			return Option.match(config, {
				onNone: () => Layer.empty,
				onSome: settings => {
					if (settings.traces === '') return Layer.empty
					return layerOtlp(`${applicationName}-client`, settings.traces, 'web', settings.version)
				}
			})
		})
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
