import {NodeServices} from '@effect/platform-node'
import {assert, it} from '@effect/vitest'

import {ConfigProvider, Effect, FileSystem, Layer, Option, pipe} from 'effect'

import {requireAdmin} from '@deslop/runtime/server/auth'
import {layerDataStore} from '@deslop/runtime/server/store'
import {UserId} from '@deslop/runtime/shared/auth'

import {People} from './service.ts'

import {CookieSessions} from '#services/cookie-sessions/service.ts'

const layer = pipe(
	People.layer,
	Layer.provide(
		Layer.unwrap(
			Effect.gen(function* () {
				return layerDataStore(yield* (yield* FileSystem.FileSystem).makeTempDirectoryScoped())
			})
		)
	),
	Layer.provide(Layer.mock(CookieSessions, {forgetPerson: () => Effect.void})),
	Layer.provide(NodeServices.layer),
	Layer.provide(
		ConfigProvider.layer(ConfigProvider.fromUnknown({AUTH_URL: 'https://auth.example.test', GITHUB_ADMINS: '1'}))
	)
)

it.layer(layer)(test =>
	test.effect(
		'browser accounts wait; admission persists across sign-in; tailnet and admins are admitted',
		Effect.fnUntraced(function* () {
			const people = yield* People
			const user = {id: UserId.make('github:2'), name: 'person'}
			const admin = yield* requireAdmin({admin: true, id: UserId.make('github:1'), name: 'admin'}, 'Admin required')
			assert.equal((yield* people.register(user, Option.none(), false)).status, 'Waiting')
			assert.equal((yield* people.admit({allow: true, id: user.id}, admin)).role, 'Member')
			assert.equal((yield* people.register({...user, name: 'renamed'}, Option.none(), false)).status, 'Allowed')
			assert.equal(
				(yield* people.register({id: UserId.make('github:3'), name: 'tailnet'}, Option.none(), true)).status,
				'Allowed'
			)
			assert.equal((yield* people.register(admin, Option.none(), false)).status, 'Allowed')
			const declined = {id: UserId.make('github:4'), name: 'declined'}
			yield* people.register(declined, Option.none(), false)
			yield* people.admit({allow: false, id: declined.id}, admin)
			assert.isTrue(Option.isNone(yield* people.find(declined.id)))
		})
	)
)
