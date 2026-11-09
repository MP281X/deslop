import {RegistryContext} from '@effect/atom-react'
import {NodeHttpServer, NodeServices} from '@effect/platform-node'
import {assert, it} from '@effect/vitest'

import {Cause, Context, Effect, Function, Layer, Option, Queue, Ref, Stream, pipe} from 'effect'

import {RouterProvider, createMemoryHistory, createRouter} from '@tanstack/react-router'
import {HttpRouter, HttpServer, HttpServerResponse} from 'effect/http'
import {AsyncResult, AtomRegistry} from 'effect/reactivity'
import type {Atom} from 'effect/reactivity'
import {TestClock} from 'effect/testing'
import {createElement} from 'react'
import {renderToString} from 'react-dom/server'

import {AuthError} from '@deslop/runtime/auth/schema'
import {Auth} from '@deslop/runtime/auth/service'
import {DEVELOPER, isDenied} from '@deslop/runtime/auth/utils'
import * as ServerRuntime from '@deslop/runtime/server'

import type {serversAtom} from '#lib/utils.ts'
import {RpcContracts} from '#rpcs/contracts.ts'
import {ConnectionInfo} from '#services/connections/schema.ts'

const sample = ConnectionInfo.make({
	icons: [],
	id: 'private',
	name: 'Private MCP server',
	status: 'Connected',
	tools: 0,
	url: 'https://private.example.invalid/mcp'
})

const fixture = Effect.gen(function* () {
	const opened = yield* Queue.unbounded<void>()
	const complete = yield* Ref.make(false)
	const answers = yield* Queue.unbounded<Effect.Effect<ConnectionInfo[], AuthError>>()
	const handlers = RpcContracts.toLayer({
		'ai.keys': () => Effect.never,
		'ai.setKey': () => Effect.never,
		'ai.usage': () => Stream.never,
		'gateway.add': () => Effect.never,
		'gateway.servers': () =>
			Stream.unwrap(
				Effect.gen(function* () {
					yield* Queue.offer(opened, undefined)
					if (yield* Ref.get(complete)) return Stream.empty
					return pipe(Stream.fromQueue(answers), Stream.mapEffect(Function.identity))
				})
			),
		'gateway.usage': () => Stream.never
	})
	const context = yield* Layer.build(
		pipe(
			HttpRouter.serve(
				pipe(
					Layer.mergeAll(
						ServerRuntime.layerRpc({group: RpcContracts, handlers}),
						HttpRouter.add(
							'GET',
							'/api/runtime',
							HttpServerResponse.jsonUnsafe({name: 'gateway', traces: '', version: '0.1.0'})
						)
					),
					Layer.provide(
						Layer.succeedContext(
							Auth.makeContext(Auth.of({token: () => Effect.succeed('token'), user: () => Effect.succeed(DEVELOPER)}))
						)
					)
				)
			),
			Layer.provide(ServerRuntime.layerProtocol),
			Layer.provideMerge(NodeHttpServer.layerTest)
		)
	)
	const origin = HttpServer.formatAddress(Context.get(context, HttpServer.HttpServer).address)
	/* oxlint-disable no-restricted-globals, no-restricted-properties -- Scope the actual browser client's origin to this loopback server and restore its descriptor. */
	const previous = Object.getOwnPropertyDescriptor(globalThis, 'location')
	const browser = Object.getOwnPropertyDescriptor(globalThis, 'window')
	yield* Effect.acquireRelease(
		Effect.sync(() => {
			Object.defineProperty(globalThis, 'location', {configurable: true, value: {origin}})
			Object.defineProperty(globalThis, 'window', {configurable: true, value: {location: {origin}}})
		}),
		() =>
			Effect.sync(() => {
				if (previous === undefined) Reflect.deleteProperty(globalThis, 'location')
				else Object.defineProperty(globalThis, 'location', previous)
				if (browser === undefined) Reflect.deleteProperty(globalThis, 'window')
				else Object.defineProperty(globalThis, 'window', browser)
			})
	)
	/* oxlint-enable no-restricted-globals, no-restricted-properties */
	const atoms = yield* Effect.promise(() => import('#lib/utils.ts'))
	const registry = yield* Effect.acquireRelease(
		Effect.sync(() => AtomRegistry.make()),
		value => Effect.sync(() => value.dispose())
	)
	const updates = yield* Queue.unbounded<Atom.Type<typeof atoms.serversAtom>>()
	yield* Effect.acquireRelease(
		Effect.sync(() =>
			registry.subscribe(
				atoms.serversAtom,
				value => {
					Queue.offerUnsafe(updates, value)
				},
				{immediate: true}
			)
		),
		unsubscribe => Effect.sync(unsubscribe)
	)
	return {
		answers,
		complete,
		mcpUsageAtom: atoms.mcpUsageAtom,
		opened,
		registry,
		serversAtom: atoms.serversAtom,
		updates
	}
})

function render(result: Atom.Type<typeof serversAtom>) {
	return Effect.scoped(
		Effect.gen(function* () {
			const env = yield* fixture
			const router = yield* Effect.map(
				Effect.promise(() => import('#routeTree.gen.ts')),
				generated => createRouter({history: createMemoryHistory(), routeTree: generated.routeTree})
			)
			yield* Effect.promise(() => router.load())
			env.registry.ensureNode(env.serversAtom).setInitialValue(result)
			// The rows' figures, so a loaded server renders without waiting for the usage reader.
			env.registry
				.ensureNode(env.mcpUsageAtom('7d'))
				.setInitialValue(
					AsyncResult.success({range: {count: 7, from: 0, size: 86_400_000, to: 7 * 86_400_000}, report: []})
				)
			return renderToString(
				createElement(RegistryContext.Provider, {value: env.registry}, createElement(RouterProvider, {router}))
			)
		})
	)
}

it.layer(NodeServices.layer)(test => {
	test.effect('keeps denied servers invalid through failed and empty retries until a real emission', () =>
		Effect.scoped(
			Effect.gen(function* () {
				const env = yield* fixture
				yield* Queue.take(env.opened)
				yield* Queue.offer(env.answers, Effect.succeed([sample]))
				yield* pipe(Stream.fromQueue(env.updates), Stream.filter(AsyncResult.isSuccess), Stream.runHead)
				yield* Queue.offer(env.answers, Effect.fail(AuthError.make({error: 'access_denied', message: 'Denied'})))
				yield* pipe(Stream.fromQueue(env.updates), Stream.filter(AsyncResult.isFailure), Stream.runHead)
				assert.isTrue(Option.isNone(AsyncResult.value(env.registry.get(env.serversAtom))))
				env.registry.refresh(env.serversAtom)
				yield* Queue.take(env.opened)
				yield* Queue.offer(
					env.answers,
					Effect.fail(AuthError.make({error: 'temporarily_unavailable', message: 'Retry later'}))
				)
				yield* pipe(
					Stream.fromQueue(env.updates),
					Stream.filter(value => AsyncResult.isFailure(value) && value.cause.reasons.length > 1),
					Stream.runHead
				)
				assert.isTrue(Option.isNone(AsyncResult.value(env.registry.get(env.serversAtom))))
				assert.isTrue(Option.exists(AsyncResult.error(env.registry.get(env.serversAtom)), isDenied))
				yield* Ref.set(env.complete, true)
				env.registry.refresh(env.serversAtom)
				yield* Queue.take(env.opened)
				yield* pipe(
					Stream.fromQueue(env.updates),
					Stream.filter(value => AsyncResult.isFailure(value) && !value.waiting),
					Stream.runHead
				)
				assert.isTrue(Option.isNone(AsyncResult.value(env.registry.get(env.serversAtom))))
				yield* Ref.set(env.complete, false)
				env.registry.refresh(env.serversAtom)
				yield* Queue.take(env.opened)
				yield* Queue.offer(env.answers, Effect.succeed([]))
				yield* pipe(Stream.fromQueue(env.updates), Stream.filter(AsyncResult.isSuccess), Stream.runHead)
				assert.deepStrictEqual(Option.getOrThrow(AsyncResult.value(env.registry.get(env.serversAtom))), [])
			})
		)
	)

	test.effect('retains servers during a temporary authorization outage and reconnects without refresh', () =>
		Effect.scoped(
			Effect.gen(function* () {
				const env = yield* fixture
				yield* Queue.take(env.opened)
				yield* Queue.offer(env.answers, Effect.succeed([sample]))
				yield* pipe(Stream.fromQueue(env.updates), Stream.filter(AsyncResult.isSuccess), Stream.runHead)
				// The first miss is a dropped socket the retry usually heals; the second in a row is an outage the page marks.
				for (const attempt of [1, 2]) {
					if (attempt === 2) {
						yield* TestClock.adjust('1 second')
						yield* Queue.take(env.opened)
					}
					yield* Queue.offer(
						env.answers,
						Effect.fail(AuthError.make({error: 'temporarily_unavailable', message: 'Retry later'}))
					)
				}
				yield* pipe(Stream.fromQueue(env.updates), Stream.filter(AsyncResult.isFailure), Stream.runHead)
				assert.deepStrictEqual(Option.getOrThrow(AsyncResult.value(env.registry.get(env.serversAtom))), [sample])
				yield* TestClock.adjust('1 second')
				yield* Queue.take(env.opened)
				yield* Queue.offer(env.answers, Effect.succeed([]))
				yield* pipe(Stream.fromQueue(env.updates), Stream.filter(AsyncResult.isSuccess), Stream.runHead)
				assert.deepStrictEqual(Option.getOrThrow(AsyncResult.value(env.registry.get(env.serversAtom))), [])
			})
		)
	)

	test.effect(
		'keeps the bar and its field outside initial suspension, with no sections or Add server button',
		Effect.fnUntraced(function* () {
			const html = yield* render(AsyncResult.initial())
			assert.include(html, '>gateway</span>')
			assert.notInclude(html, 'aria-label="Sections"')
			assert.notInclude(html, '>Servers</h2>')
			assert.notInclude(html, 'aria-label="Add server"')
			assert.include(html, 'aria-label="Copy MCP URL"')
			assert.include(html, 'Paste an MCP server URL or a provider key')
			assert.include(html, 'aria-busy="true"')
			assert.notInclude(html, 'aria-label="No servers yet"')
		})
	)

	test.effect(
		'treats an empty server list as loaded content',
		Effect.fnUntraced(function* () {
			const html = yield* render(AsyncResult.success([]))
			assert.include(html, 'Servers')
			assert.notInclude(html, 'aria-label="MCP servers"')
		})
	)

	test.effect(
		'keeps servers and explains a temporary authorization outage inline',
		Effect.fnUntraced(function* () {
			const html = yield* render(
				AsyncResult.failWithPrevious(
					AuthError.make({error: 'temporarily_unavailable', message: 'Authorization is temporarily unavailable'}),
					{previous: Option.some(AsyncResult.success([sample]))}
				)
			)
			assert.include(html, sample.name)
			assert.include(html, 'aria-label="Out of date"')
			assert.notInclude(html, 'Authorization is temporarily unavailable')
			assert.notInclude(html, 'Something went wrong')
		})
	)

	test.effect(
		'does not show retained servers when access is denied',
		Effect.fnUntraced(function* () {
			const html = yield* render(
				AsyncResult.failWithPrevious(AuthError.make({error: 'access_denied', message: 'Access denied'}), {
					previous: Option.some(AsyncResult.success([sample]))
				})
			)
			assert.include(html, 'aria-label="Access denied"')
			assert.notInclude(html, sample.name)
		})
	)

	test.effect(
		'owns a failure without previous servers and offers a local retry',
		Effect.fnUntraced(function* () {
			const html = yield* render(AsyncResult.failure(Cause.die('Cannot decode server data')))
			assert.include(html, 'role="alert"')
			assert.include(html, 'Can’t load this view')
			assert.notInclude(html, 'Cannot decode server data')
			assert.notInclude(html, 'aria-label="MCP servers"')
		})
	)

	test.effect(
		'keeps usable servers after a read defect',
		Effect.fnUntraced(function* () {
			const html = yield* render(
				AsyncResult.failureWithPrevious(Cause.die('Cannot decode the latest update'), {
					previous: Option.some(AsyncResult.success([sample]))
				})
			)
			assert.include(html, sample.name)
			assert.notInclude(html, 'Cannot decode the latest update')
			assert.include(html, 'aria-label="Out of date"')
		})
	)
})
