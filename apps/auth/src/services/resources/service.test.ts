import {NodeCrypto} from '@effect/platform-node'
import {assert, it} from '@effect/vitest'

import {Array, Effect, Layer} from 'effect'

import {KeyValueStore} from 'effect/persistence'
import {TestClock} from 'effect/testing'

import {Resources} from '#services/resources/service.ts'

it.layer(Layer.mergeAll(KeyValueStore.layerMemory, NodeCrypto.layer))('Resource enrollment', test => {
	test.effect(
		'requires approval, is idempotent, persists the decision and revokes both audiences',
		Effect.fnUntraced(function* () {
			const resources = yield* Resources.make
			const row = yield* resources.request({name: 'Deploy', resource: 'https://deploy.example.com'})
			assert.strictEqual(row.status, 'pending')
			assert.strictEqual((yield* resources.request({name: 'Another label', resource: row.resource})).id, row.id)
			assert.isTrue((yield* Effect.result(resources.accepted(row.resource)))._tag === 'Failure')
			yield* resources.decide(row.id, true, 'github:42')
			yield* resources.accepted(row.resource)
			yield* resources.accepted(`${row.resource}/mcp`)
			const reopened = yield* Resources.make
			assert.strictEqual((yield* reopened.lookup(row.id)).approvedBy, 'github:42')
			yield* reopened.decide(row.id, false, 'github:42')
			assert.isTrue((yield* Effect.result(reopened.accepted(row.resource)))._tag === 'Failure')
			assert.isTrue((yield* Effect.result(reopened.accepted(`${row.resource}/mcp`)))._tag === 'Failure')
		})
	)
	test.effect(
		'bounds pending spam separately, expires abandoned requests and keeps admin denials durable',
		Effect.fnUntraced(function* () {
			const resources = yield* Resources.make
			const denied = yield* resources.request({name: 'Blocked', resource: 'https://blocked.example.com'})
			yield* resources.decide(denied.id, false, 'github:42')
			yield* Effect.forEach(
				Array.range(0, 256),
				i => resources.request({name: 'Unsolicited', resource: `https://spam-${i}.example.com`}),
				{concurrency: 1, discard: true}
			)
			const legitimate = yield* resources.request({name: 'Deploy', resource: 'https://deploy.example.com'})
			yield* resources.decide(legitimate.id, true, 'github:42')
			yield* resources.accepted(legitimate.resource)
			yield* resources.request({name: 'Portfolio', resource: 'https://portfolio.mp281x.xyz'})
			const abandoned = yield* resources.request({name: 'Abandoned', resource: 'https://abandoned.example.com'})
			yield* TestClock.adjust('11 minutes')
			const reopened = yield* Resources.make
			assert.strictEqual((yield* reopened.request({name: 'Blocked again', resource: denied.resource})).status, 'denied')
			assert.isTrue((yield* Effect.result(reopened.lookup(denied.id)))._tag === 'Success')
			assert.strictEqual(
				(yield* reopened.request({name: 'Fresh', resource: 'https://fresh.example.com'})).status,
				'pending'
			)
			assert.isTrue((yield* Effect.result(reopened.lookup(legitimate.id)))._tag === 'Success')
			assert.isTrue((yield* Effect.result(reopened.lookup(abandoned.id)))._tag === 'Failure')
		})
	)
	test.effect(
		'preserves previous resources until an admin disables their root',
		Effect.fnUntraced(function* () {
			const resources = yield* Resources.make
			yield* resources.accepted('https://stash.mp281x.xyz/mcp')
			const row = yield* resources.request({name: 'Stash', resource: 'https://stash.mp281x.xyz'})
			assert.strictEqual(row.status, 'approved')
			yield* resources.decide(row.id, false, 'github:42')
			assert.isTrue((yield* Effect.result(resources.accepted('https://stash.mp281x.xyz/mcp')))._tag === 'Failure')
		})
	)
})
