import {assert, it} from '@effect/vitest'

import {Cause, Effect, Fiber, Layer, Queue, Ref, pipe} from 'effect'

import {HttpClient, HttpClientResponse} from 'effect/http'
import type {HttpClientError} from 'effect/http/HttpClientError'
import {TestClock} from 'effect/testing'

import {layerWebTelemetry} from './telemetry.ts'

it.effect(
	'keeps app data available when telemetry settings cannot be read',
	Effect.fnUntraced(function* () {
		for (const response of [new Response('offline', {status: 503}), Response.json({unexpected: true})]) {
			const calls = yield* Ref.make(0)
			const services = yield* Layer.build(
				Layer.provide(
					layerWebTelemetry('fixture'),
					Layer.succeed(
						HttpClient.HttpClient,
						HttpClient.makeWith<HttpClientError, never, HttpClientError, never>(
							request =>
								Effect.flatMap(request, input =>
									pipe(
										calls,
										Ref.update(count => count + 1),
										Effect.as(HttpClientResponse.fromWeb(input, response))
									)
								),
							Effect.succeed
						)
					)
				)
			)
			assert.strictEqual(yield* Ref.get(calls), 1)
			assert.strictEqual(yield* Effect.provideContext(Effect.succeed('ready'), services), 'ready')
		}
	}, Effect.scoped)
)

it.effect(
	'bounds stalled telemetry settings without swallowing caller cancellation',
	Effect.fnUntraced(function* () {
		const entered = yield* Queue.unbounded<void>()
		const page = Effect.scoped(
			Effect.gen(function* () {
				const services = yield* Layer.build(
					Layer.provide(
						layerWebTelemetry('fixture'),
						Layer.succeed(
							HttpClient.HttpClient,
							HttpClient.makeWith<HttpClientError, never, HttpClientError, never>(
								request => pipe(request, Effect.andThen(Queue.offer(entered, undefined)), Effect.andThen(Effect.never)),
								Effect.succeed
							)
						)
					)
				)
				return yield* Effect.provideContext(Effect.succeed('ready'), services)
			})
		)
		const waiting = yield* Effect.forkChild(page)
		yield* Queue.take(entered)
		yield* TestClock.adjust('2999 millis')
		assert.isUndefined(waiting.pollUnsafe())
		yield* TestClock.adjust('1 millis')
		assert.strictEqual(yield* Fiber.join(waiting), 'ready')
		const cancelled = yield* Effect.forkChild(page)
		yield* Queue.take(entered)
		yield* Fiber.interrupt(cancelled)
		const exit = yield* Fiber.await(cancelled)
		assert.isTrue(exit._tag === 'Failure' && Cause.hasInterrupts(exit.cause))
	})
)
