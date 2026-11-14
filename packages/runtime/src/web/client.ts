import {Cause, Context, Effect, Layer, MutableRef, Option, Schema, pipe} from 'effect'

import {FetchHttpClient, HttpClient, HttpClientResponse} from 'effect/http'
import {OtlpExporter} from 'effect/observability'
import {Atom} from 'effect/reactivity'

import {layerWebTelemetry} from './telemetry.ts'

import {layerSocketProtocol} from '#client/protocol.ts'
import {Account, RPC_PATH} from '#shared/schema.ts'

const errorTelemetry = MutableRef.make(Option.none<Context.Context<never>>())

export type PageErrorSource = typeof PageErrorSource.Type
const PageErrorSource = Schema.Literals(['route', 'caught', 'uncaught'])

// One page error, logged and traced as its own root span once the page's telemetry is up.
export const pageErrorAtom = Atom.fn(
	(failure: {error: unknown; route: string; source: PageErrorSource; stack?: string | null}) => {
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
		HttpClient.get('/api/account'),
		Effect.flatMap(HttpClientResponse.filterStatusOk),
		Effect.flatMap(HttpClientResponse.schemaBodyJson(Account))
	)
)

// The page's RPC socket to its own origin.
export const layerPageProtocol = layerSocketProtocol(Effect.sync(() => `${location.origin}${RPC_PATH}`))

// Traces every atom of the page under the app's name; Scope's page skips it, so it never traces itself.
export function addPageTelemetry(applicationName: string) {
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
}
