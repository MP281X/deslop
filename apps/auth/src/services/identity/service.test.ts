import {assert, it} from '@effect/vitest'

import {ConfigProvider, DateTime, Effect, Layer, Option, Result, pipe} from 'effect'

import {GitHubId, IdentifyRequest, UserId} from '@deslop/runtime/shared/auth'

import {Identity} from './service.ts'

import {GitHub} from '#services/github/service.ts'
import {Member} from '#services/people/schema.ts'
import {People} from '#services/people/service.ts'
import {CookieSession} from '#services/sessions/schema.ts'
import {Sessions} from '#services/sessions/service.ts'
import {Tailnet} from '#services/tailnet/service.ts'

const ID = UserId.make('github:2')
const member = {fullName: Option.none(), id: ID, name: 'person', since: Option.none(), status: 'Allowed' as const}
const configuration = ConfigProvider.layer(
	ConfigProvider.fromUnknown({AUTH_URL: 'https://auth.example.test', GITHUB_ADMINS: '1'})
)

function layer(tags: string[], status: Member['status']) {
	return pipe(
		Identity.layer,
		Layer.provide(
			Layer.mock(People, {
				find: id => Effect.succeedSome(Member.make({...member, id, status})),
				register: user => Effect.succeed(Member.make({...member, ...user}))
			})
		),
		Layer.provide(
			Layer.mock(Sessions, {
				current: secret => {
					if (secret !== 'valid') return Effect.succeedNone
					return Effect.succeedSome(
						CookieSession.make({
							address: Option.none(),
							browser: 'Safari',
							createdAt: DateTime.makeUnsafe(1),
							id: 'hash',
							lastSeenAt: DateTime.makeUnsafe(1),
							userId: ID
						})
					)
				}
			})
		),
		Layer.provide(
			Layer.mock(GitHub, {login: () => Effect.succeed({id: GitHubId.make(3), login: 'person', name: Option.none()})})
		),
		Layer.provide(
			Layer.succeed(Tailnet, {
				status: Effect.succeed({
					Self: {Tags: tags, UserID: 1},
					User: {'1': {DisplayName: 'Person', ID: 1, LoginName: 'person@github'}}
				}),
				whois: () =>
					Effect.succeed({Node: {Tags: tags}, UserProfile: {DisplayName: 'Person', ID: 1, LoginName: 'person@github'}})
			})
		),
		Layer.provide(configuration)
	)
}

it.layer(layer([], 'Allowed'))(test =>
	test.effect(
		'sessions win; only this machine may act on behalf; GitHub logins resolve to current ids',
		Effect.fnUntraced(function* () {
			const identity = yield* Identity
			const request = IdentifyRequest.make({
				address: Option.some('100.64.0.1'),
				onBehalfOf: Option.some(UserId.make('github:4')),
				session: Option.some('valid')
			})
			assert.deepStrictEqual(
				[(yield* identity.resolve(request)).id, (yield* identity.resolve(request)).signOut],
				[ID, true]
			)
			assert.equal((yield* identity.resolve({...request, session: Option.none()})).id, 'github:3')
			assert.equal(
				(yield* identity.resolve({...request, address: Option.some('127.0.0.1'), session: Option.none()})).id,
				'github:4'
			)
			assert.equal(
				(yield* identity.resolve({
					...request,
					address: Option.some('127.0.0.1'),
					onBehalfOf: Option.none(),
					session: Option.none()
				})).id,
				'github:3'
			)
			assert.isTrue(
				Result.isFailure(
					yield* Effect.result(identity.resolve({...request, address: Option.some('8.8.8.8'), session: Option.none()}))
				)
			)
		})
	)
)

it.layer(layer(['tag:server'], 'Allowed'))(test =>
	test.effect(
		'tagged nodes cannot name an owner',
		Effect.fnUntraced(function* () {
			const identity = yield* Identity
			for (const address of ['100.64.0.1', '127.0.0.1']) {
				assert.isTrue(
					Result.isFailure(
						yield* Effect.result(
							identity.resolve(
								IdentifyRequest.make({address: Option.some(address), onBehalfOf: Option.none(), session: Option.none()})
							)
						)
					)
				)
			}
		})
	)
)

it.layer(layer([], 'Waiting'))(test =>
	test.effect(
		'waiting sessions can see Auth but cannot enter apps',
		Effect.fnUntraced(function* () {
			const identity = yield* Identity
			const request = IdentifyRequest.make({
				address: Option.none(),
				onBehalfOf: Option.none(),
				session: Option.some('valid')
			})
			assert.isTrue(Result.isFailure(yield* Effect.result(identity.resolve(request))))
			assert.equal((yield* identity.resolve(request, true)).role, 'Waiting')
		})
	)
)
