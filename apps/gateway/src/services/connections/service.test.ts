import {NodeCrypto, NodeServices} from '@effect/platform-node'
import {assert, it} from '@effect/vitest'

import {
	Array,
	ConfigProvider,
	Duration,
	Effect,
	FileSystem,
	Function,
	Layer,
	Number,
	Option,
	Stream,
	pipe
} from 'effect'

import {Headers} from 'effect/http'
import {TestClock} from 'effect/testing'

import {Auth, requireAdmin} from '@deslop/runtime/server/auth'
import {layerDataStore} from '@deslop/runtime/server/store'
import {UserId} from '@deslop/runtime/shared/auth'

import {Connections} from './service.ts'

import type {ServerId} from '#services/connections/schema.ts'
import {layerUpstream} from '#services/network/service.ts'
import {Upstreams} from '#services/upstreams/service.ts'

const ADMIN = {admin: true, id: UserId.make('github:1'), name: 'admin'}

// The test clock starts at zero and stands for the present: a far jump forward wakes every sleeping fiber at each of its steps, which takes minutes.
function daysAgo(days: number) {
	return -Duration.toMillis(Duration.days(days))
}

// Both servers sit under the gateway's own domain, so adding them asks only Auth and Upstreams, never the network.
const layer = pipe(
	Connections.layer,
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

const addServer = Effect.fnUntraced(function* (name: string) {
	const connections = yield* Connections
	const added = yield* connections.add(
		`https://${name}.example.test/mcp`,
		yield* requireAdmin(ADMIN, 'Admin required'),
		Headers.empty
	)
	return {generation: (yield* connections.get(added.id)).generation, id: added.id}
})

// The calls the thirty-day report shows for a server with the clock at `epoch`.
const callsAt = Effect.fnUntraced(function* (id: ServerId, epoch: number) {
	yield* TestClock.setTime(epoch)
	return Option.match(
		yield* Stream.runHead((yield* Connections).usage('30d', yield* requireAdmin(ADMIN, 'Admin required'))),
		{
			onNone: Function.constant(0),
			onSome: value =>
				pipe(
					value.report,
					Array.filter(server => server.id === id),
					Array.flatMap(server => server.series),
					Array.map(bucket => bucket.calls),
					Number.sumAll
				)
		}
	)
})

it.layer(layer)(test =>
	test.effect(
		'a counted call deletes only its own server’s calls older than thirty days',
		Effect.fnUntraced(function* () {
			const connections = yield* Connections
			const active = yield* addServer('active')
			const dormant = yield* addServer('dormant')
			// A call counted at day 90 would be deleted by the server's own later call at day 45, so the day-90 call comes second.
			for (const age of [45, 90]) {
				yield* TestClock.setTime(daysAgo(age))
				yield* connections.called(active.id, active.generation)
				yield* connections.called(dormant.id, dormant.generation)
			}
			yield* TestClock.setTime(daysAgo(0))
			yield* connections.called(active.id, active.generation)
			// The report shows thirty days back from the clock, so each row is read with the clock set to when it was counted.
			assert.deepStrictEqual(
				[
					yield* callsAt(active.id, daysAgo(90)),
					yield* callsAt(active.id, daysAgo(45)),
					yield* callsAt(active.id, daysAgo(0))
				],
				[0, 0, 1]
			)
			assert.deepStrictEqual(
				[
					yield* callsAt(dormant.id, daysAgo(90)),
					yield* callsAt(dormant.id, daysAgo(45)),
					yield* callsAt(dormant.id, daysAgo(0))
				],
				[1, 1, 0]
			)
		})
	)
)
