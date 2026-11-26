import {NodeCrypto, NodeServices} from '@effect/platform-node'
import {assert, it} from '@effect/vitest'

import {Array, ConfigProvider, DateTime, Duration, Effect, FileSystem, Function, Layer, Option, pipe} from 'effect'

import {Headers} from 'effect/http'
import {TestClock} from 'effect/testing'

import {Auth, requireAdmin} from '@deslop/runtime/server/auth'
import {layerDataStore} from '@deslop/runtime/server/store'
import {UserId} from '@deslop/runtime/shared/auth'

import {Usage} from './service.ts'

import {AiMetering} from '#server/ai-metering/service.ts'
import {Connections} from '#server/connections/service.ts'
import {layerUpstream} from '#server/network/service.ts'
import {Upstreams} from '#server/upstreams/service.ts'

// More old calls than one delete statement removes, so the sweep has to go round again.
const SWEEP_BATCH = 5000
const ADMIN = {admin: true, id: UserId.make('github:1'), name: 'admin'}

// The test clock starts at zero and stands for the present: a far jump forward wakes every sleeping fiber at each of its steps, which takes minutes.
function daysAgo(days: number) {
	return -Duration.toMillis(Duration.days(days))
}

// Both servers sit under the gateway's own domain, so adding them asks only Auth and Upstreams, never the network.
const layer = pipe(
	Layer.mergeAll(Usage.layer, AiMetering.layer, Connections.layer),
	Layer.provideMerge(
		Layer.unwrap(
			Effect.gen(function* () {
				return layerDataStore(yield* (yield* FileSystem.FileSystem).makeTempDirectoryScoped())
			})
		)
	),
	Layer.provide(Layer.mock(Auth, {user: () => Effect.succeed(ADMIN)})),
	Layer.provide(
		Layer.mock(Upstreams, {
			use: (_authorize, run) =>
				run({
					callTool: () => Effect.die('no tool is called'),
					expired: Function.constFalse,
					instructions: Option.none(),
					listTools: () => Effect.succeed([]),
					serverInfo: Option.none()
				})
		})
	),
	Layer.provide(layerUpstream),
	Layer.provide(NodeCrypto.layer),
	Layer.provide(NodeServices.layer),
	Layer.provide(ConfigProvider.layer(ConfigProvider.fromUnknown({APP_URL: 'https://gateway.example.test'})))
)

it.layer(layer)(test =>
	test.effect(
		'the sweep deletes every call older than thirty days, whoever made it, and keeps the rest',
		Effect.fnUntraced(function* () {
			const connections = yield* Connections
			const metering = yield* AiMetering
			const added = yield* connections.add(
				'https://dormant.example.test/mcp',
				yield* requireAdmin(ADMIN, 'Admin required'),
				Headers.empty
			)
			const generation = (yield* connections.get(added.id)).generation
			// Neither owner nor server calls again after its last row: a counted call no longer deletes anything itself.
			for (const age of [90, 31, 30, 29, 0]) {
				yield* TestClock.setTime(daysAgo(age))
				yield* connections.called(added.id, generation)
				yield* (yield* metering.observe(UserId.make('github:2'), 'anthropic', Option.none(), yield* DateTime.now, {
					accepted: true,
					sse: false
				})).save
			}
			// More old calls than one batch, so the sweep goes on until none is left.
			yield* TestClock.setTime(daysAgo(60))
			yield* Effect.forEach(Array.range(1, SWEEP_BATCH), () => connections.called(added.id, generation), {
				concurrency: 1,
				discard: true
			})
			yield* TestClock.setTime(daysAgo(0))
			assert.deepStrictEqual(yield* (yield* Usage).sweep, {aiCalls: 2, mcpCalls: 2 + SWEEP_BATCH})
			assert.deepStrictEqual(yield* (yield* Usage).sweep, {aiCalls: 0, mcpCalls: 0})
		})
	)
)
