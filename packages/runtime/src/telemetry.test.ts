import {assert, it} from '@effect/vitest'

import {Array, Boolean, Cause, Context, Effect, Fiber, Layer, MutableList, String, pipe} from 'effect'

import {FetchHttpClient, HttpClient, HttpClientResponse} from 'effect/http'
import {OtlpExporter} from 'effect/observability'
import {TestClock} from 'effect/testing'

import {layerOtlp, layerWebTelemetry} from '#telemetry.ts'

it.effect(
	'keeps app data available when telemetry settings cannot be read',
	Effect.fnUntraced(function* () {
		for (const response of [new Response('offline', {status: 503}), Response.json({unexpected: true})]) {
			const services = yield* Layer.build(
				Layer.provide(
					layerWebTelemetry('fixture'),
					Layer.succeed(
						HttpClient.HttpClient,
						HttpClient.make(request => Effect.succeed(HttpClientResponse.fromWeb(request, response)))
					)
				)
			)
			assert.strictEqual(yield* Effect.provideContext(Effect.succeed('ready'), services), 'ready')
		}
	}, Effect.scoped)
)

it.effect(
	'bounds stalled telemetry settings without swallowing caller cancellation',
	Effect.fnUntraced(function* () {
		const page = Effect.scoped(
			Effect.gen(function* () {
				const services = yield* Layer.build(
					Layer.provide(
						layerWebTelemetry('fixture'),
						Layer.succeed(
							HttpClient.HttpClient,
							HttpClient.make(() => Effect.never)
						)
					)
				)
				return yield* Effect.provideContext(Effect.succeed('ready'), services)
			})
		)
		const waiting = yield* Effect.forkChild(page)
		yield* TestClock.adjust('3 seconds')
		assert.strictEqual(yield* Fiber.join(waiting), 'ready')
		const cancelled = yield* Effect.forkChild(page)
		yield* Fiber.interrupt(cancelled)
		const exit = yield* Fiber.await(cancelled)
		assert.isTrue(exit._tag === 'Failure' && Cause.hasInterrupts(exit.cause))
	})
)

it.effect(
	'keeps app data available when the exporter cannot be constructed',
	Effect.fnUntraced(function* () {
		const services = yield* Layer.build(layerOtlp('fixture', 'not a URL', 'web', '0.1.0'))
		assert.strictEqual(yield* Effect.provideContext(Effect.succeed('ready'), services), 'ready')
	}, Effect.scoped)
)

it.effect(
	'redacts query credentials from successful and failed HTTP exports while retaining useful query values',
	Effect.fnUntraced(function* () {
		const sent = MutableList.make<string>()
		const fetch = Layer.succeed(FetchHttpClient.Fetch, (input, init) => {
			const request = new Request(input, init)
			// oxlint-disable-next-line no-restricted-properties -- FetchHttpClient.Fetch requires a Promise<Response> at its native boundary.
			return Effect.runPromise(
				Effect.gen(function* () {
					if (request.method === 'POST') {
						MutableList.append(sent, yield* Effect.promise(() => request.text()))
						assert.isNull(request.headers.get('authorization'))
						return Response.json({})
					}
					return new Response('fixture', {
						status: Boolean.match(String.includes('/denied')(request.url), {onFalse: () => 200, onTrue: () => 403})
					})
				})
			)
		})
		const services = yield* Layer.build(
			Layer.provide(layerOtlp('fixture', 'https://receiver.test', 'server', '0.1.0'), fetch)
		)
		const client = Context.get(yield* Layer.build(Layer.provide(FetchHttpClient.layer, fetch)), HttpClient.HttpClient)
		for (const path of ['callback', 'denied']) {
			yield* pipe(
				client.get(
					`https://fixture.test/${path}?code=private-value&state=private-value&request=private-value&refresh_token=private-value&X-Amz-Signature=private-value&resource=visible`,
					{headers: {authorization: 'Bearer header-secret'}}
				),
				Effect.flatMap(HttpClientResponse.filterStatusOk),
				Effect.tapError(error => Effect.logError(error)),
				Effect.withSpan('fixture.request'),
				Effect.ignore,
				Effect.provideContext(services)
			)
		}
		yield* (yield* Effect.fromOption(Context.getOption(services, OtlpExporter.Flusher))).flush
		const packets = Array.join(MutableList.toArray(sent), '\n')
		assert.include(packets, 'visible')
		assert.include(packets, 'REDACTED')
		assert.notInclude(packets, 'private-value')
		assert.notInclude(packets, 'header-secret')
	}, Effect.scoped)
)
