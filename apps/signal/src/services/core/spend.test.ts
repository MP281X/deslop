import {assert, it} from '@effect/vitest'

import {Array, Boolean, Context, Effect, Exit, Layer, MutableList, Option, Record, Schema, String, pipe} from 'effect'

import {HttpClient, HttpClientResponse} from 'effect/http'
import {KeyValueStore} from 'effect/persistence'

import {Conversation, Turn} from '#services/core/schema.ts'
import {Core} from '#services/core/service.ts'
import {LocalDecision} from '#services/game/schema.ts'

function request(tick: number, ids: number[]) {
	return {
		actor: 2,
		choices: {continue: 'Continue.', rest: 'Rest.'},
		experience: Array.map(ids, id => ({
			actor: 2,
			id,
			kind: 'observe' as const,
			text: `Private claim ${id} remains uncertain.`,
			tick: id,
			x: 1,
			z: 2
		})),
		state: 'Current private perception.',
		tick
	} satisfies LocalDecision
}

function answer() {
	return {
		answers: {action: {choice: 'continue', probabilities: {continue: 1, rest: 0}, type: 'choice'}},
		model: 'typesafe/jev-1.14',
		usage: {cost: 0.001, input_tokens: 100, output_tokens: 1}
	}
}

it.layer(KeyValueStore.layerMemory)(test => {
	test.effect(
		'initializes deduplication from the previous release’s archived individual requests',
		Effect.fnUntraced(function* () {
			const kv = yield* KeyValueStore.KeyValueStore
			yield* kv.clear
			const key = 'conversation/10/individual-2/active'
			yield* KeyValueStore.toSchemaStore(kv, Conversation).set(key, {
				measured: 0,
				sequence: 1,
				summary: '',
				turns: [{content: 'Private claim 1 remains uncertain.', role: 'user', sequence: 1}]
			})
			yield* KeyValueStore.toSchemaStore(kv, Turn).set('conversation/10/individual-2/turn/000000001', {
				content: yield* Schema.encodeEffect(Schema.fromJsonString(LocalDecision))(request(10, [1])),
				role: 'user',
				sequence: 1
			})
			const core = Context.get(
				yield* Layer.build(
					pipe(
						Core.layer,
						Layer.provide(
							Layer.succeed(
								HttpClient.HttpClient,
								HttpClient.make(req => Effect.succeed(HttpClientResponse.fromWeb(req, Response.json(answer()))))
							)
						)
					)
				),
				Core
			)
			yield* core.choose(10, request(11, [1, 2]))
			const active = Option.getOrThrow(yield* KeyValueStore.toSchemaStore(kv, Conversation).get(key))
			for (const id of [1, 2]) {
				assert.strictEqual(
					String.split(`Private claim ${id} remains uncertain.`)(
						Array.join(
							Array.map(active.turns, turn => turn.content),
							'\n'
						)
					).length - 1,
					1
				)
			}
		})
	)
	test.effect(
		'does not append the same private experiences again after failed requests or a restart',
		Effect.fnUntraced(function* () {
			const kv = yield* KeyValueStore.KeyValueStore
			yield* kv.clear
			const calls = MutableList.make<string>()
			const client = HttpClient.make(req =>
				Effect.sync(() => {
					if (req.body._tag !== 'Uint8Array') return assert.fail('Expected JSON request.')
					MutableList.append(calls, new TextDecoder().decode(req.body.body))
					if (calls.length < 3) {
						return HttpClientResponse.fromWeb(
							req,
							Response.json({error: {code: 503, message: 'Offline fixture failure'}}, {status: 503})
						)
					}
					return HttpClientResponse.fromWeb(req, Response.json(answer()))
				})
			)
			const layer = pipe(Core.layer, Layer.provide(Layer.succeed(HttpClient.HttpClient, client)))
			const first = Context.get(yield* Layer.build(layer), Core)
			assert.isTrue(Exit.hasFails(yield* Effect.exit(first.choose(8, request(10, [1, 2])))))
			assert.isTrue(Exit.hasFails(yield* Effect.exit(first.choose(8, request(11, [1, 2])))))
			const restarted = Context.get(yield* Layer.build(layer), Core)
			yield* restarted.choose(8, request(12, [1, 2, 3]))
			const active = Option.getOrThrow(
				yield* KeyValueStore.toSchemaStore(kv, Conversation).get('conversation/8/individual-2/active')
			)
			const context = Array.join(
				Array.map(active.turns, turn => turn.content),
				'\n'
			)
			for (const id of [1, 2, 3]) {
				assert.strictEqual(String.split(`Private claim ${id} remains uncertain.`)(context).length - 1, 1)
			}
			for (const sequence of [1, 2, 3]) {
				const original = Option.getOrThrow(
					yield* KeyValueStore.toSchemaStore(kv, Turn).get(`conversation/8/individual-2/turn/00000000${sequence}`)
				)
				assert.deepStrictEqual(
					Array.map(
						(yield* Schema.decodeEffect(Schema.fromJsonString(LocalDecision))(original.content)).experience ?? [],
						entry => entry.id
					),
					Boolean.match(sequence === 3, {onFalse: () => [1, 2], onTrue: () => [1, 2, 3]})
				)
			}
			assert.strictEqual(calls.length, 3)
			for (const id of [1, 2, 3]) {
				assert.strictEqual(
					String.split(`Private claim ${id} remains uncertain.`)(
						Option.getOrThrow(Array.last(MutableList.toArray(calls)))
					).length - 1,
					1
				)
			}
			assert.isTrue(
				Option.isNone(yield* KeyValueStore.toSchemaStore(kv, Conversation).get('conversation/8/individual-4/active'))
			)
		})
	)

	test.effect(
		'records reported usage even if saving the completed continuation fails',
		Effect.fnUntraced(function* () {
			const kv = yield* KeyValueStore.KeyValueStore
			yield* kv.clear
			const calls = MutableList.make<string>()
			const client = HttpClient.make(req =>
				Effect.sync(() => {
					MutableList.append(calls, req.url)
					return HttpClientResponse.fromWeb(req, Response.json(answer()))
				})
			)
			const core = Context.get(
				yield* Layer.build(
					pipe(
						Core.layer,
						Layer.provide(Layer.succeed(HttpClient.HttpClient, client)),
						Layer.provide(
							Layer.succeed(
								KeyValueStore.KeyValueStore,
								KeyValueStore.make({
									...kv,
									set: (key, value) => {
										if (key === 'conversation/9/individual-2/turn/000000002') {
											return Effect.fail(
												new KeyValueStore.KeyValueStoreError({
													key,
													message: 'Offline fixture write failure.',
													method: 'set'
												})
											)
										}
										return kv.set(key, value)
									}
								})
							)
						)
					)
				),
				Core
			)
			assert.isTrue(Exit.hasFails(yield* Effect.exit(core.choose(9, request(10, [1])))))
			const group = Option.getOrThrow(
				Array.findFirst(Record.values((yield* core.usage).groups), value => value.kind === 'local')
			)
			assert.strictEqual(group.calls, 1)
			assert.strictEqual(group.values.cost.reported, 1)
			assert.strictEqual(group.values.cost.total, 0.001)
			assert.strictEqual(calls.length, 1)
			assert.isTrue(
				Option.isSome(yield* KeyValueStore.toSchemaStore(kv, Turn).get('conversation/9/individual-2/turn/000000001'))
			)
		})
	)
})
