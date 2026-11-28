import {assert, it} from '@effect/vitest'

import {
	Boolean,
	ConfigProvider,
	DateTime,
	Effect,
	Layer,
	MutableHashMap,
	MutableRef,
	Option,
	Result,
	Schema,
	pipe
} from 'effect'

import {GitHubId, IdentifyRequest, UserId, asAuthError} from '@deslop/runtime/shared/auth'

import {Identity} from './server.ts'

import {GitHub} from '#github/server.ts'
import {Member} from '#people/contract.ts'
import {People} from '#people/server.ts'
import {CookieSession} from '#sessions/contract.ts'
import {Sessions} from '#sessions/server.ts'
import {StatusJson, WhoisJson} from '#tailnet/contract.ts'
import {Tailnet} from '#tailnet/server.ts'

// Two tailnet users whose ids differ only past 2^53, as `tailscale` writes them; the other user comes first.
const OWNER = '{"DisplayName": "Person", "ID": 9007199254740993, "LoginName": "person@github"}'
const OTHER = '{"DisplayName": "Other", "ID": 9007199254740992, "LoginName": "other@example.com"}'
const ID = UserId.make('github:2')
const member = {
	fullName: Option.none(),
	id: ID,
	name: 'person',
	since: Option.none(),
	status: Option.some('Allowed' as const),
	tailnet: false
}
const configuration = ConfigProvider.layer(
	ConfigProvider.fromUnknown({AUTH_URL: 'https://auth.example.test', GITHUB_ADMINS: '1'})
)

// The account GitHub names for the person's login now, and how many times it was asked.
function lookupsOf() {
	return {account: MutableRef.make(GitHubId.make(3)), asked: MutableRef.make(0)}
}

function layer(tags: string[], status: Member['status'] = member.status, tailnet = false, lookups = lookupsOf()) {
	const bindings = MutableHashMap.empty<string, UserId>()
	return pipe(
		Identity.layer,
		Layer.provide(
			Layer.mock(People, {
				bind: (tailnetId, id) => Effect.sync(() => MutableHashMap.set(bindings, tailnetId, id)),
				bound: tailnetId =>
					Effect.succeed(
						pipe(
							bindings,
							MutableHashMap.get(tailnetId),
							Option.map(id => Member.make({...member, id, status, tailnet}))
						)
					),
				find: id => Effect.succeedSome(Member.make({...member, id, status, tailnet})),
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
			Layer.mock(GitHub, {
				login: () =>
					Effect.sync(() => {
						MutableRef.increment(lookups.asked)
						return {id: MutableRef.get(lookups.account), login: 'person', name: Option.none()}
					})
			})
		),
		Layer.provide(
			Layer.succeed(Tailnet, {
				status: pipe(
					Schema.decodeEffect(StatusJson)(
						`{"Self": {"UserID": 9007199254740993}, "User": {"9007199254740992": ${OTHER}, "9007199254740993": ${OWNER}}}`
					),
					Effect.map(found => ({...found, Self: {...found.Self, Tags: tags}})),
					asAuthError('Cannot read the tailnet owner')
				),
				whois: Effect.fnUntraced(function* (address) {
					const found = yield* pipe(
						Schema.decodeEffect(WhoisJson)(
							`{"Node": {}, "UserProfile": ${Boolean.match(address === '100.64.0.2', {onFalse: () => OWNER, onTrue: () => OTHER})}}`
						),
						asAuthError('Cannot identify the tailnet caller')
					)
					return {...found, Node: {Tags: tags}}
				})
			})
		),
		Layer.provide(configuration)
	)
}

it.layer(layer([]))(test =>
	test.effect(
		'sessions win; only this machine may act on behalf; a GitHub login resolves to its account',
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

it.layer(layer([]))(test =>
	test.effect(
		'tailnet users whose ids differ only past 2^53 stay two people',
		Effect.fnUntraced(function* () {
			const identity = yield* Identity
			const request = IdentifyRequest.make({
				address: Option.some('127.0.0.1'),
				onBehalfOf: Option.none(),
				session: Option.none()
			})
			assert.deepStrictEqual(
				[
					(yield* identity.resolve(request)).id,
					(yield* identity.resolve({...request, address: Option.some('100.64.0.1')})).id,
					(yield* identity.resolve({...request, address: Option.some('100.64.0.2')})).id
				],
				['github:3', 'github:3', 'tailnet:other@example.com']
			)
		})
	)
)

it.layer(layer(['tag:server']))(test =>
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

it.layer(layer([], Option.some('Waiting')))(test =>
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

it.layer(layer([], Option.some('Waiting'), true))(test =>
	test.effect(
		'someone the tailnet has seen enters from it and through apps acting for them while their browser waits',
		Effect.fnUntraced(function* () {
			const identity = yield* Identity
			const request = IdentifyRequest.make({
				address: Option.some('100.64.0.1'),
				onBehalfOf: Option.none(),
				session: Option.none()
			})
			assert.equal((yield* identity.resolve(request)).role, 'Member')
			assert.equal(
				(yield* identity.resolve({
					...request,
					address: Option.some('127.0.0.1'),
					onBehalfOf: Option.some(UserId.make('github:4'))
				})).role,
				'Member'
			)
			const browser = {...request, address: Option.none(), session: Option.some('valid')}
			assert.isTrue(Result.isFailure(yield* Effect.result(identity.resolve(browser))))
			assert.equal((yield* identity.resolve(browser, true)).role, 'Waiting')
		})
	)
)

const lookups = lookupsOf()
it.layer(layer([], member.status, false, lookups))(test =>
	test.effect(
		'a tailnet user stays the GitHub account it was first resolved to, without asking GitHub again',
		Effect.fnUntraced(function* () {
			const identity = yield* Identity
			const request = IdentifyRequest.make({
				address: Option.some('100.64.0.1'),
				onBehalfOf: Option.none(),
				session: Option.none()
			})
			assert.equal((yield* identity.resolve(request)).id, 'github:3')
			assert.equal((yield* identity.resolve(request)).id, 'github:3')
			assert.equal(MutableRef.get(lookups.asked), 1)
			// The login changed hands: the tailnet user is still the account it was bound to.
			MutableRef.set(lookups.account, GitHubId.make(5))
			assert.equal((yield* identity.resolve({...request, address: Option.some('127.0.0.1')})).id, 'github:3')
			assert.equal(MutableRef.get(lookups.asked), 1)
		})
	)
)
