import {ChatRequest} from '@effect/ai-openrouter/Generated'
import type {ChatResult} from '@effect/ai-openrouter/Generated'
import {assert, it} from '@effect/vitest'

import {Array, Context, Effect, Exit, Layer, MutableList, Option, Schema, String, pipe} from 'effect'

import {HttpClient, HttpClientResponse} from 'effect/http'
import {KeyValueStore} from 'effect/persistence'

import {Conversation, Turn} from '#services/core/schema.ts'
import {Core} from '#services/core/service.ts'

function completion(content: string, finish: ChatResult['choices'][number]['finish_reason'] = 'stop') {
	return {
		choices: [{finish_reason: finish, index: 0, message: {content, role: 'assistant' as const}}],
		created: 0,
		id: 'offline-fixture',
		model: 'fixture',
		object: 'chat.completion' as const,
		system_fingerprint: 'fixture',
		usage: {
			completion_tokens: 50,
			cost: 0.001,
			prompt_tokens: 1000,
			prompt_tokens_details: {cached_tokens: 800},
			total_tokens: 1050
		}
	} satisfies ChatResult
}

const ORIGINAL: Conversation = {
	measured: 20_000,
	sequence: 12,
	summary: 'A report is not a verified observation.',
	turns: Array.map(Array.range(1, 12), sequence => ({
		content: `${sequence}: report #9 remains unverified. ${String.repeat(7000)('a')} END-${sequence}`,
		role: 'user' as const,
		sequence
	}))
}

it.layer(KeyValueStore.layerMemory)(test => {
	test.effect(
		'compacts a continuing conversation, preserves originals and appends to a stable cacheable prefix',
		Effect.fnUntraced(function* () {
			const kv = yield* KeyValueStore.KeyValueStore
			const conversations = KeyValueStore.toSchemaStore(kv, Conversation)
			const turns = KeyValueStore.toSchemaStore(kv, Turn)
			yield* conversations.set('conversation/11/0/active', ORIGINAL)
			for (const turn of ORIGINAL.turns) {
				yield* turns.set(`conversation/11/0/turn/${String.padStart(9, '0')(`${turn.sequence}`)}`, turn)
			}
			const calls = MutableList.make<ChatRequest>()
			const client = HttpClient.make(request =>
				Effect.sync(() => {
					if (request.body._tag !== 'Uint8Array') return assert.fail('Expected the owned JSON chat request.')
					MutableList.append(
						calls,
						Option.getOrThrow(
							Schema.decodeOption(Schema.fromJsonString(ChatRequest))(new TextDecoder().decode(request.body.body))
						)
					)
					return HttpClientResponse.fromWeb(
						request,
						Response.json(
							completion(
								'Goals: investigate. Evidence: received claim #9 at tick 10, still unverified. Pending: request a first-hand report.'
							)
						)
					)
				})
			)
			const core = Context.get(
				yield* Layer.build(pipe(Core.layer, Layer.provide(Layer.succeed(HttpClient.HttpClient, client)))),
				Core
			)
			const answer = yield* core.decide(11, 0, 'Nothing new observed.', false)
			assert.strictEqual(answer.tokens?.cost, 0.001)
			assert.strictEqual(answer.tokens?.compaction?.cost, 0.001)
			assert.strictEqual(answer.tokens?.cached, 800)
			const checkpoint = Option.getOrThrow(yield* conversations.get('conversation/11/0/active'))
			assert.include(checkpoint.summary, 'still unverified')
			assert.strictEqual(checkpoint.turns.length, 6)
			assert.deepStrictEqual(
				Option.getOrThrow(yield* turns.get('conversation/11/0/turn/000000001')),
				Option.getOrThrow(Array.head(ORIGINAL.turns))
			)
			assert.notInclude(yield* core.recall(11, 0, 2), 'END-1')
			assert.include(yield* core.recall(11, 0, 2, 6000), 'END-1')
			yield* core.decide(11, 0, 'A later observation.', false)
			const requests = MutableList.toArray(calls)
			const previous = Option.getOrThrow(Array.get(requests, 1))
			const next = Option.getOrThrow(Array.get(requests, 2))
			assert.strictEqual(previous.session_id, next.session_id)
			assert.deepStrictEqual(Array.take(next.messages, previous.messages.length), previous.messages)
			assert.notInclude(yield* Schema.encodeEffect(Schema.fromJsonString(ChatRequest))(previous), '"name":"Message"')
		})
	)

	test.effect(
		'refuses a truncated compaction without overwriting the continuation or attempting a strategy call',
		Effect.fnUntraced(function* () {
			const conversations = KeyValueStore.toSchemaStore(yield* KeyValueStore.KeyValueStore, Conversation)
			yield* conversations.set('conversation/12/0/active', ORIGINAL)
			const calls = MutableList.make<string>()

			assert.isTrue(
				Exit.hasFails(
					yield* Effect.exit(
						Context.get(
							yield* Layer.build(
								pipe(
									Core.layer,
									Layer.provide(
										Layer.succeed(
											HttpClient.HttpClient,
											HttpClient.make(request =>
												Effect.sync(() => {
													MutableList.append(calls, request.url)
													return HttpClientResponse.fromWeb(
														request,
														Response.json(completion('Incomplete checkpoint', 'length'))
													)
												})
											)
										)
									)
								)
							),
							Core
						).decide(12, 0, 'A new observation.', false)
					)
				)
			)
			assert.strictEqual(calls.length, 1)
			assert.deepStrictEqual(Option.getOrThrow(yield* conversations.get('conversation/12/0/active')), ORIGINAL)
		})
	)
})
