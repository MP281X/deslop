import {NodeCrypto, NodeServices} from '@effect/platform-node'
import {assert, it} from '@effect/vitest'

import {Duration, Effect, FileSystem, Layer, Option, pipe} from 'effect'

import {TestClock} from 'effect/testing'

import {layerDataStore} from '@deslop/runtime/server/store'
import {UserId} from '@deslop/runtime/shared/auth'

import {Sessions} from './server.ts'

function daysAgo(days: number) {
	return -Duration.toMillis(Duration.days(days))
}

const layer = pipe(
	Sessions.layer,
	Layer.provideMerge(
		Layer.unwrap(
			Effect.gen(function* () {
				return layerDataStore(yield* (yield* FileSystem.FileSystem).makeTempDirectoryScoped())
			})
		)
	),
	Layer.provide(NodeCrypto.layer),
	Layer.provide(NodeServices.layer)
)

it.layer(layer)(test =>
	test.effect(
		'the hourly sweep deletes sessions idle past the expiry and keeps the rest',
		Effect.fnUntraced(function* () {
			const sessions = yield* Sessions
			// The test clock starts at zero and stands for the present; going back sleeps no fiber.
			yield* TestClock.setTime(daysAgo(31))
			const expired = yield* sessions.create(UserId.make('github:2'), Option.none(), 'Safari')
			yield* TestClock.setTime(daysAgo(29))
			const live = yield* sessions.create(UserId.make('github:3'), Option.none(), 'Safari')
			yield* TestClock.setTime(0)
			yield* TestClock.adjust('1 hour')
			// Back on the day the live one was made, both would still be in time: only a deleted session is refused.
			yield* TestClock.setTime(daysAgo(29))
			assert.isTrue(Option.isNone(yield* sessions.current(expired)))
			assert.isTrue(Option.isSome(yield* sessions.current(live)))
		})
	)
)
