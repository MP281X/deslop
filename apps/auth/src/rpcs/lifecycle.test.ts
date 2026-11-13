import {NodeCrypto} from '@effect/platform-node'
import {assert, it} from '@effect/vitest'

import {ConfigProvider, Context, Deferred, Effect, Fiber, Layer, Option, Ref, Schema, Stream, pipe} from 'effect'

import {Digest} from 'effect/crypto'
import {Base64Url} from 'effect/encoding'
import {Headers} from 'effect/http'
import {KeyValueStore} from 'effect/persistence'
import {RpcTest} from 'effect/rpc'

import {Auth} from '@deslop/runtime/server/auth'
import {SESSION_COOKIE} from '@deslop/runtime/shared/auth'

import {RpcContracts} from '#rpcs/contracts.ts'
import {RpcHandlers} from '#rpcs/handlers.ts'
import {Apps} from '#services/apps/service.ts'
import {GitHub} from '#services/github/service.ts'
import {Passkeys} from '#services/passkeys/service.ts'
import {People, layerIssuerAuth} from '#services/people/service.ts'
import {REQUEST_COOKIE, SignIns} from '#services/sign-ins/service.ts'
import type {ClientRequest} from '#services/tokens/schema.ts'
import {Tokens} from '#services/tokens/service.ts'

const ADMIN = {id: 'github:42', name: 'admin'}
const PROFILE = {id: 7, login: 'member'}
const VERIFIER = 'xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx'

const open = Effect.gen(function* () {
	const base = Context.get(yield* Layer.build(Layer.fresh(KeyValueStore.layerMemory)), KeyValueStore.KeyValueStore)
	yield* base.set(
		'members',
		yield* Schema.encodeEffect(Schema.fromJsonString(Schema.Unknown))([
			{...ADMIN, fullName: '', incarnation: 'admin', since: 0, status: 'Allowed'}
		])
	)
	const failing = yield* Ref.make(Option.none<string>())
	const holding = yield* Ref.make(Option.none<string>())
	const reached = yield* Deferred.make<void>()
	const release = yield* Deferred.make<void>()
	const store = KeyValueStore.make({
		...base,
		set: (key, value) =>
			Effect.gen(function* () {
				if (Option.contains(yield* Ref.get(holding), key)) {
					yield* Deferred.succeed(reached, undefined)
					yield* Deferred.await(release)
				}
				if (Option.contains(yield* Ref.get(failing), key)) {
					return yield* new KeyValueStore.KeyValueStoreError({key, message: 'Disk unavailable', method: 'set'})
				}
				yield* base.set(key, value)
			})
	})
	const layer = pipe(
		RpcHandlers,
		Layer.provideMerge(layerIssuerAuth),
		Layer.provideMerge(SignIns.layer),
		Layer.provideMerge(People.layer),
		Layer.provideMerge(
			Layer.mergeAll(
				Tokens.layer,
				Passkeys.layer,
				Layer.succeed(
					GitHub,
					GitHub.of({
						cancel: () => Effect.die('Unused GitHub cancellation'),
						finish: () => Effect.die('Unused GitHub callback'),
						profile: () => Effect.succeed({id: 42, login: 'admin'}),
						start: () => Effect.die('Unused GitHub redirect')
					})
				)
			)
		),
		Layer.provide(Layer.succeed(KeyValueStore.KeyValueStore, store)),
		Layer.provide(
			Layer.succeed(Apps, Apps.of({catalog: Stream.succeed([]), register: () => Effect.die('Unused app registration')}))
		),
		Layer.provide(
			ConfigProvider.layer(
				ConfigProvider.fromUnknown({
					APP_URL: 'https://auth.mp281x.xyz',
					AUTH_URL: 'https://auth.mp281x.xyz',
					GITHUB_ADMINS: '42'
				})
			)
		)
	)
	const reload = Effect.gen(function* () {
		const context = yield* Layer.build(layer)
		return {
			auth: Context.get(context, Auth),
			client: Effect.provideContext(RpcTest.makeClient(RpcContracts), context),
			passkeys: Context.get(context, Passkeys),
			people: Context.get(context, People),
			signIns: Context.get(context, SignIns),
			tokens: Context.get(context, Tokens)
		}
	})
	return {...(yield* reload), failing, holding, reached, release, reload}
})

const request = Effect.gen(function* () {
	return {
		challenge: Base64Url.encode(
			yield* (yield* Digest.Digest).digest(Digest.sha256, new TextEncoder().encode(VERIFIER))
		),
		clientId: 'fixture',
		clientName: 'Fixture',
		redirectUri: 'http://127.0.0.1/callback'
	} satisfies ClientRequest
})

function first<A, E>(stream: Stream.Stream<A, E>) {
	return Effect.flatMap(Stream.runHead(stream), Effect.fromOption)
}

it.layer(NodeCrypto.layer)(test => {
	test.effect(
		'binds actual RPC handlers to each browser owner while keeping Waiting account reads public',
		Effect.fnUntraced(function* () {
			const fixture = yield* open
			const member = yield* fixture.people.register(PROFILE)
			const other = yield* fixture.people.register({id: 9, login: 'another'})
			const headers = Headers.fromInput({
				cookie: `${SESSION_COOKIE}=${(yield* fixture.tokens.startSession(member, {}, 'GitHub', '')).token}`
			})
			const otherHeaders = Headers.fromInput({
				cookie: `${SESSION_COOKIE}=${(yield* fixture.tokens.startSession(other, {}, 'GitHub', '')).token}`
			})
			const client = yield* fixture.client
			assert.strictEqual((yield* first(client['auth.account'](undefined, {headers}))).role, 'Waiting')
			assert.strictEqual(
				(yield* Effect.flip(Stream.runCollect(Stream.take(client['auth.apps'](undefined, {headers}), 1)))).error,
				'access_denied'
			)
			yield* fixture.people.admit({allow: true, id: member.user.id}, ADMIN)
			yield* fixture.people.admit({allow: true, id: other.user.id}, ADMIN)
			assert.strictEqual((yield* first(client['auth.apps'](undefined, {headers}))).length, 1)
			assert.strictEqual((yield* first(client['auth.apps'](undefined, {headers: otherHeaders}))).length, 1)
			const pending = yield* fixture.signIns.start({_tag: 'Browser'}, {})
			yield* client['auth.answer']({accept: true, request: pending.code}, {headers})
			yield* fixture.people.remove(member.user.id, ADMIN)
			yield* fixture.people.admit({allow: true, id: (yield* fixture.people.register(PROFILE)).user.id}, ADMIN)
			assert.deepStrictEqual(
				yield* fixture.signIns.collect(
					pending.code,
					Headers.fromInput({cookie: `${REQUEST_COOKIE}${pending.code}=${pending.receiver}`})
				),
				{_tag: 'Redirect', url: '/'}
			)
		})
	)

	test.effect(
		'never revives old sessions, grants or codes after failed cleanup and re-registration',
		Effect.fnUntraced(function* () {
			const fixture = yield* open
			const owner = yield* fixture.people.register(PROFILE)
			const headers = Headers.fromInput({
				cookie: `${SESSION_COOKIE}=${(yield* fixture.tokens.startSession(owner, {}, 'GitHub', '')).token}`
			})
			assert.strictEqual((yield* first(fixture.people.account(headers))).role, 'Waiting')
			yield* fixture.people.admit({allow: true, id: owner.user.id}, ADMIN)
			// Admission preserves a Waiting browser's identity and cookie.
			assert.deepStrictEqual(yield* fixture.auth.user(headers), owner.user)
			const asked = yield* request
			const granted = yield* fixture.tokens.exchange(
				{
					client_id: asked.clientId,
					code: yield* fixture.tokens.issue(asked, owner),
					code_verifier: VERIFIER,
					grant_type: 'authorization_code'
				},
				{},
				fixture.people.allowed
			)
			if (granted._tag !== 'Granted') return assert.fail('Expected a grant')
			const unspent = yield* fixture.tokens.issue(asked, owner)
			yield* Ref.set(fixture.failing, Option.some('sign-ins'))
			assert.strictEqual(
				(yield* Effect.flip(fixture.people.remove(owner.user.id, ADMIN))).error,
				'temporarily_unavailable'
			)
			assert.strictEqual(
				(yield* Effect.flip(Stream.runCollect(Stream.take(fixture.people.account(headers), 1)))).error,
				'invalid_grant'
			)
			yield* Ref.set(fixture.failing, Option.none())
			const renewed = yield* fixture.people.register(PROFILE)
			assert.notStrictEqual(renewed.incarnation, owner.incarnation)
			yield* fixture.people.admit({allow: true, id: owner.user.id}, ADMIN)
			assert.strictEqual(
				(yield* Effect.flip(
					fixture.tokens.exchange(
						{client_id: asked.clientId, code: unspent, code_verifier: VERIFIER, grant_type: 'authorization_code'},
						{},
						fixture.people.allowed
					)
				)).error,
				'invalid_grant'
			)
			const restarted = yield* fixture.reload
			assert.strictEqual((yield* Effect.flip(restarted.auth.user(headers))).error, 'invalid_grant')
			assert.strictEqual(
				(yield* Effect.flip(
					restarted.auth.user(Headers.fromInput({authorization: `Bearer ${granted.tokens.access_token}`}))
				)).error,
				'invalid_grant'
			)
			assert.strictEqual(
				(yield* Effect.flip(
					restarted.tokens.exchange(
						{grant_type: 'refresh_token', refresh_token: granted.tokens.refresh_token},
						{},
						restarted.people.allowed
					)
				)).error,
				'invalid_grant'
			)
			assert.deepStrictEqual(yield* first(restarted.tokens.apps(renewed)), [])
			assert.deepStrictEqual(
				yield* restarted.auth.user(
					Headers.fromInput({
						cookie: `${SESSION_COOKIE}=${(yield* restarted.tokens.startSession(renewed, {}, 'GitHub', '')).token}`
					})
				),
				renewed.user
			)
		})
	)

	test.effect(
		'retains the captured approver through removal, re-admission and delayed collection',
		Effect.fnUntraced(function* () {
			const fixture = yield* open
			const owner = yield* fixture.people.register(PROFILE)
			yield* fixture.people.admit({allow: true, id: owner.user.id}, ADMIN)
			const pending = yield* fixture.signIns.start({_tag: 'Browser'}, {})
			yield* fixture.signIns.answer({accept: true, request: pending.code}, owner, 'Session')
			yield* fixture.people.remove(owner.user.id, ADMIN)
			const fresh = yield* fixture.people.register(PROFILE)
			yield* fixture.people.admit({allow: true, id: fresh.user.id}, ADMIN)
			assert.deepStrictEqual(
				yield* fixture.signIns.collect(
					pending.code,
					Headers.fromInput({cookie: `${REQUEST_COOKIE}${pending.code}=${pending.receiver}`})
				),
				{_tag: 'Redirect', url: '/'}
			)
			assert.deepStrictEqual(yield* first(fixture.tokens.apps(fresh)), [])
		})
	)

	test.effect(
		'limits delayed cleanup to the removed incarnation during concurrent registration',
		Effect.fnUntraced(function* () {
			const fixture = yield* open
			const owner = yield* fixture.people.register(PROFILE)
			yield* fixture.people.admit({allow: true, id: owner.user.id}, ADMIN)
			const old = yield* fixture.tokens.startSession(owner, {}, 'GitHub', '')
			yield* Ref.set(fixture.holding, Option.some('sign-ins'))
			const removing = yield* Effect.forkScoped(fixture.people.remove(owner.user.id, ADMIN))
			yield* Effect.addFinalizer(() => Deferred.succeed(fixture.release, undefined))
			yield* Deferred.await(fixture.reached)
			const fresh = yield* fixture.people.register(PROFILE)
			yield* fixture.people.admit({allow: true, id: fresh.user.id}, ADMIN)
			assert.strictEqual(
				(yield* Effect.flip(fixture.auth.user(Headers.fromInput({cookie: `${SESSION_COOKIE}=${old.token}`})))).error,
				'invalid_grant'
			)
			const starting = yield* Effect.forkScoped(fixture.tokens.startSession(fresh, {}, 'GitHub', ''))
			yield* Deferred.succeed(fixture.release, undefined)
			yield* Fiber.join(removing)
			assert.deepStrictEqual(
				yield* fixture.auth.user(
					Headers.fromInput({cookie: `${SESSION_COOKIE}=${(yield* Fiber.join(starting)).token}`})
				),
				fresh.user
			)
			// A retried obsolete cleanup also leaves all credentials of the new lifetime alone.
			yield* fixture.tokens.forget(owner)
			yield* fixture.passkeys.forget(owner)
			assert.strictEqual((yield* first(fixture.tokens.apps(fresh))).length, 1)
		})
	)

	test.effect(
		'keeps a failed membership removal valid and an interrupted committed removal revoked',
		Effect.fnUntraced(function* () {
			const fixture = yield* open
			const owner = yield* fixture.people.register(PROFILE)
			yield* fixture.people.admit({allow: true, id: owner.user.id}, ADMIN)
			const headers = Headers.fromInput({
				cookie: `${SESSION_COOKIE}=${(yield* fixture.tokens.startSession(owner, {}, 'GitHub', '')).token}`
			})
			yield* Ref.set(fixture.failing, Option.some('members'))
			assert.strictEqual(
				(yield* Effect.flip(fixture.people.remove(owner.user.id, ADMIN))).error,
				'temporarily_unavailable'
			)
			assert.deepStrictEqual(yield* fixture.auth.user(headers), owner.user)
			yield* Ref.set(fixture.failing, Option.none())
			yield* Ref.set(fixture.holding, Option.some('members'))
			const removing = yield* Effect.forkScoped(fixture.people.remove(owner.user.id, ADMIN))
			yield* Effect.addFinalizer(() => Deferred.succeed(fixture.release, undefined))
			yield* Deferred.await(fixture.reached)
			const interrupting = yield* Effect.forkScoped(Fiber.interrupt(removing))
			yield* Effect.yieldNow
			yield* Deferred.succeed(fixture.release, undefined)
			yield* Fiber.join(interrupting)
			const fresh = yield* fixture.people.register(PROFILE)
			yield* fixture.people.admit({allow: true, id: fresh.user.id}, ADMIN)
			assert.strictEqual((yield* Effect.flip(fixture.auth.user(headers))).error, 'invalid_grant')
			assert.notStrictEqual(fresh.incarnation, owner.incarnation)
		})
	)
})
