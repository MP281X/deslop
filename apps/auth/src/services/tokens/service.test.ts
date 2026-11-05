import {NodeCrypto, NodeServices} from '@effect/platform-node'
import {assert, it} from '@effect/vitest'

import {Array, Context, Effect, Layer, Option, Stream, String, pipe} from 'effect'

import {Headers} from 'effect/http'
import {KeyValueStore} from 'effect/persistence'
import {TestClock} from 'effect/testing'

import {Tokens} from '#services/tokens/service.ts'

const USER = {id: 'github:42', name: 'octocat'}
const RESOURCE = 'https://gateway.mp281x.xyz/mcp'

const layer = pipe(
	Tokens.layer,
	Layer.provide(Layer.mergeAll(KeyValueStore.layerMemory, NodeCrypto.layer, NodeServices.layer))
)

it.effect(
	'an agent token reaches only its own MCP resource, and leaves the list when it expires',
	Effect.fnUntraced(function* () {
		const tokens = Context.get(yield* Layer.build(layer), Tokens)
		const created = yield* tokens.createAgent(USER, {days: 90, name: 'desktop', resource: RESOURCE})
		assert.deepStrictEqual(
			yield* tokens.access(Headers.fromInput({authorization: `Bearer ${created.token}`}), RESOURCE),
			USER
		)
		assert.isTrue(
			(yield* Effect.result(
				tokens.access(Headers.fromInput({authorization: `Bearer ${created.token}`}), 'https://scope.mp281x.xyz')
			))._tag === 'Failure'
		)
		assert.deepStrictEqual(Option.getOrThrow(yield* Stream.runHead(tokens.apps(USER))), [
			{
				agent: 'desktop',
				client: 'Agent token',
				createdAt: 0,
				device: 'desktop',
				expiresAt: 90 * 86_400_000,
				family: Option.getOrThrow(Array.head(String.split(created.token, '.'))),
				kind: 'App',
				lastActive: 0,
				resources: [RESOURCE]
			}
		])
		yield* TestClock.adjust('90 days')
		assert.deepStrictEqual(Option.getOrThrow(yield* Stream.runHead(tokens.apps(USER))), [])
	})
)

it.effect(
	'records an agent token’s last use at most once a minute',
	Effect.fnUntraced(function* () {
		const tokens = Context.get(yield* Layer.build(layer), Tokens)
		const created = yield* tokens.createAgent(USER, {days: 365, name: 'desktop', resource: RESOURCE})
		yield* TestClock.adjust('2 minutes')
		yield* tokens.access(Headers.fromInput({authorization: `Bearer ${created.token}`}), RESOURCE)
		assert.strictEqual(
			Option.getOrThrow(Option.flatMap(yield* Stream.runHead(tokens.apps(USER)), Array.head)).lastActive,
			120_000
		)
		yield* TestClock.adjust('30 seconds')
		yield* tokens.access(Headers.fromInput({authorization: `Bearer ${created.token}`}), RESOURCE)
		assert.strictEqual(
			Option.getOrThrow(Option.flatMap(yield* Stream.runHead(tokens.apps(USER)), Array.head)).lastActive,
			120_000
		)
		yield* TestClock.adjust('31 seconds')
		yield* tokens.access(Headers.fromInput({authorization: `Bearer ${created.token}`}), RESOURCE)
		assert.strictEqual(
			Option.getOrThrow(Option.flatMap(yield* Stream.runHead(tokens.apps(USER)), Array.head)).lastActive,
			181_000
		)
	})
)

it.effect(
	'revokes an agent token only for the account that made it',
	Effect.fnUntraced(function* () {
		const tokens = Context.get(yield* Layer.build(layer), Tokens)
		const created = yield* tokens.createAgent(USER, {days: 30, name: 'desktop', resource: RESOURCE})
		const family = Option.getOrThrow(Array.head(String.split(created.token, '.')))
		assert.isTrue(
			(yield* Effect.result(tokens.disconnect(family, {id: 'github:7', name: 'stranger'})))._tag === 'Failure'
		)
		yield* tokens.disconnect(family, USER)
		assert.isTrue(
			(yield* Effect.result(tokens.access(Headers.fromInput({authorization: `Bearer ${created.token}`}), RESOURCE)))
				._tag === 'Failure'
		)
		assert.deepStrictEqual(Option.getOrThrow(yield* Stream.runHead(tokens.apps(USER))), [])
	})
)
