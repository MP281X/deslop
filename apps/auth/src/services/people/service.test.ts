import {NodeServices} from '@effect/platform-node'
import {assert, it} from '@effect/vitest'

import {Array, ConfigProvider, Effect, FileSystem, Layer, MutableRef, Option, pipe} from 'effect'

import {Reactivity} from 'effect/reactivity'

import {requireAdmin} from '@deslop/runtime/server/auth'
import {layerDataStore} from '@deslop/runtime/server/store'
import {UserId} from '@deslop/runtime/shared/auth'

import {People} from './service.ts'

import {Sessions} from '#services/sessions/service.ts'

// Each test gets its own scratch database; `forgotten` hears whose sessions were deleted.
function layer(forgotten = MutableRef.make(Array.empty<UserId>())) {
	return pipe(
		People.layer,
		Layer.provideMerge(
			Layer.unwrap(
				Effect.gen(function* () {
					return layerDataStore(yield* (yield* FileSystem.FileSystem).makeTempDirectoryScoped())
				})
			)
		),
		Layer.provide(
			Layer.mock(Sessions, {forgetPerson: id => Effect.sync(() => MutableRef.update(forgotten, Array.append(id)))})
		),
		Layer.provide(NodeServices.layer),
		Layer.provide(
			ConfigProvider.layer(ConfigProvider.fromUnknown({AUTH_URL: 'https://auth.example.test', GITHUB_ADMINS: '1'}))
		)
	)
}

it.layer(layer())(test =>
	test.effect(
		'browser accounts wait; admission persists across sign-in; admins are admitted; a declined browser account goes',
		Effect.fnUntraced(function* () {
			const people = yield* People
			const user = {id: UserId.make('github:2'), name: 'person'}
			const admin = yield* requireAdmin({admin: true, id: UserId.make('github:1'), name: 'admin'}, 'Admin required')
			assert.deepStrictEqual((yield* people.register(user, Option.none(), false)).status, Option.some('Waiting'))
			assert.equal((yield* people.admit({allow: true, id: user.id}, admin)).role, 'Member')
			assert.deepStrictEqual(
				(yield* people.register({...user, name: 'renamed'}, Option.none(), false)).status,
				Option.some('Allowed')
			)
			assert.deepStrictEqual((yield* people.register(admin, Option.none(), false)).status, Option.some('Allowed'))
			const declined = {id: UserId.make('github:4'), name: 'declined'}
			yield* people.register(declined, Option.none(), false)
			yield* people.admit({allow: false, id: declined.id}, admin)
			assert.isTrue(Option.isNone(yield* people.find(declined.id)))
		})
	)
)

const forgotten = MutableRef.make(Array.empty<UserId>())
it.layer(layer(forgotten))(test =>
	test.effect(
		'a tailnet sighting is a member there but asks nothing for the browser, and leaves its answer alone',
		Effect.fnUntraced(function* () {
			const people = yield* People
			const admin = yield* requireAdmin({admin: true, id: UserId.make('github:1'), name: 'admin'}, 'Admin required')
			const user = {id: UserId.make('github:3'), name: 'tailnet'}
			const seen = yield* people.register(user, Option.none(), true)
			assert.deepStrictEqual([seen.status, seen.tailnet], [Option.none(), true])
			assert.deepStrictEqual(
				Array.map(yield* people.list(admin), person => [person.name, person.role]),
				[
					['GitHub 1', 'Admin'],
					['tailnet', 'Member']
				]
			)
			// Signing in from a browser asks; seeing them on the tailnet again neither answers nor withdraws the request.
			assert.deepStrictEqual((yield* people.register(user, Option.none(), false)).status, Option.some('Waiting'))
			assert.deepStrictEqual((yield* people.register(user, Option.none(), true)).status, Option.some('Waiting'))
			assert.equal((yield* people.admit({allow: false, id: user.id}, admin)).role, 'Member')
			assert.deepStrictEqual(MutableRef.get(forgotten), [user.id])
			const declined = yield* Effect.fromOption(yield* people.find(user.id))
			assert.deepStrictEqual([declined.status, declined.tailnet], [Option.none(), true])
			assert.deepStrictEqual((yield* people.register(user, Option.none(), true)).status, Option.none())
			assert.deepStrictEqual((yield* people.register(admin, Option.none(), true)).status, Option.some('Allowed'))
		})
	)
)

it.layer(layer())(test =>
	test.effect(
		'an empty profile name is no change, so an unchanged person costs no write',
		Effect.fnUntraced(function* () {
			const people = yield* People
			const reactivity = yield* Reactivity.Reactivity
			const writes = MutableRef.make(0)
			reactivity.registerUnsafe(['people'], () => {
				MutableRef.increment(writes)
			})
			const user = {id: UserId.make('github:5'), name: 'person'}
			yield* people.register(user, Option.some(''), true)
			yield* people.register(user, Option.some(''), true)
			assert.isTrue(Option.isNone((yield* people.register(user, Option.some(''), true)).fullName))
			assert.equal(MutableRef.get(writes), 1)
		})
	)
)
