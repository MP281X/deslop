import {NodeCrypto} from '@effect/platform-node'
import {SqliteClient} from '@effect/sql-sqlite-node'
import {assert, it} from '@effect/vitest'

import {Array, ConfigProvider, Context, Effect, Layer, Stream, pipe} from 'effect'

import {Digest} from 'effect/crypto'
import {Base64Url} from 'effect/encoding'
import {Headers} from 'effect/http'
import {Reactivity} from 'effect/reactivity'
import {RpcTest} from 'effect/rpc'
import {SqlClient} from 'effect/sql'

import {Auth} from '@deslop/runtime/server/auth'
import {SESSION_COOKIE, isDenied} from '@deslop/runtime/shared/auth'

import {RpcContracts} from '#rpcs/contracts.ts'
import {RpcHandlers} from '#rpcs/handlers.ts'
import {Apps} from '#services/apps/service.ts'
import {GitHub} from '#services/github/service.ts'
import {Passkeys} from '#services/passkeys/service.ts'
import {Member} from '#services/people/schema.ts'
import {People, layerIssuerAuth} from '#services/people/service.ts'
import {REQUEST_COOKIE, SignIns} from '#services/sign-ins/service.ts'
import type {ClientRequest} from '#services/tokens/schema.ts'
import {BrowserSession} from '#services/tokens/schema.ts'
import {Tokens} from '#services/tokens/service.ts'

const ADMIN = {id: 'github:42', name: 'admin'}
const PROFILE = {id: 7, login: 'member'}
const VERIFIER = 'xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx'

const open = Effect.gen(function* () {
	const database = yield* Layer.build(Layer.merge(SqliteClient.layer({filename: ':memory:'}), Reactivity.layer))
	const sql = Context.get(database, SqlClient.SqlClient)
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
		Layer.provide(Layer.succeedContext(database)),
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
	return {
		...(yield* reload),
		// The database refuses to delete from a table, as a full disk would, until `recover`.
		fail: (table: string) =>
			sql`CREATE TEMP TRIGGER refuse BEFORE DELETE ON ${sql(table)} BEGIN SELECT RAISE(ABORT, 'Disk unavailable'); END`,
		recover: sql`DROP TRIGGER temp.refuse`,
		reload
	}
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
			assert.strictEqual((yield* first(client['people.account'](undefined, {headers}))).role, 'Waiting')
			assert.strictEqual(
				(yield* Effect.flip(Stream.runCollect(Stream.take(client['tokens.watchApps'](undefined, {headers}), 1)))).error,
				'access_denied'
			)
			yield* fixture.people.admit({allow: true, id: member.user.id}, ADMIN)
			yield* fixture.people.admit({allow: true, id: other.user.id}, ADMIN)
			assert.strictEqual((yield* first(client['tokens.watchApps'](undefined, {headers}))).length, 1)
			assert.strictEqual((yield* first(client['tokens.watchApps'](undefined, {headers: otherHeaders}))).length, 1)
			const pending = yield* fixture.signIns.start({_tag: 'Browser'}, {})
			yield* client['signins.answer']({accept: true, request: pending.code}, {headers})
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
			yield* fixture.fail(BrowserSession.table)
			assert.strictEqual(
				(yield* Effect.flip(fixture.people.remove(owner.user.id, ADMIN))).error,
				'temporarily_unavailable'
			)
			assert.strictEqual(
				(yield* Effect.flip(Stream.runCollect(Stream.take(fixture.people.account(headers), 1)))).error,
				'invalid_grant'
			)
			yield* fixture.recover
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
		'shows an admin by their GitHub profile before their first sign-in, live',
		Effect.fnUntraced(function* () {
			assert.deepStrictEqual(
				Array.map(
					yield* first(
						Stream.filter((yield* open).people.people(ADMIN), listed =>
							Array.some(listed, person => person.name === 'admin')
						)
					),
					person => `${person.name}:${person.role}`
				),
				['admin:Admin']
			)
		})
	)

	test.effect(
		'limits a cleanup that runs after a new registration to the removed incarnation',
		Effect.fnUntraced(function* () {
			const fixture = yield* open
			const owner = yield* fixture.people.register(PROFILE)
			yield* fixture.people.admit({allow: true, id: owner.user.id}, ADMIN)
			const old = yield* fixture.tokens.startSession(owner, {}, 'GitHub', '')
			yield* fixture.people.remove(owner.user.id, ADMIN)
			const fresh = yield* fixture.people.register(PROFILE)
			yield* fixture.people.admit({allow: true, id: fresh.user.id}, ADMIN)
			assert.isTrue(
				isDenied(yield* Effect.flip(fixture.auth.user(Headers.fromInput({cookie: `${SESSION_COOKIE}=${old.token}`}))))
			)
			const started = yield* fixture.tokens.startSession(fresh, {}, 'GitHub', '')
			// The removed registration's cleanup, run again late, leaves every credential of the new one alone.
			yield* fixture.tokens.forget(owner)
			yield* fixture.passkeys.forget(owner)
			assert.deepStrictEqual(
				yield* fixture.auth.user(Headers.fromInput({cookie: `${SESSION_COOKIE}=${started.token}`})),
				fresh.user
			)
			assert.strictEqual((yield* first(fixture.tokens.apps(fresh))).length, 1)
		})
	)

	test.effect(
		'keeps a failed membership removal valid and a committed one revoked across re-registration',
		Effect.fnUntraced(function* () {
			const fixture = yield* open
			const owner = yield* fixture.people.register(PROFILE)
			yield* fixture.people.admit({allow: true, id: owner.user.id}, ADMIN)
			const headers = Headers.fromInput({
				cookie: `${SESSION_COOKIE}=${(yield* fixture.tokens.startSession(owner, {}, 'GitHub', '')).token}`
			})
			yield* fixture.fail(Member.table)
			assert.strictEqual(
				(yield* Effect.flip(fixture.people.remove(owner.user.id, ADMIN))).error,
				'temporarily_unavailable'
			)
			assert.deepStrictEqual(yield* fixture.auth.user(headers), owner.user)
			yield* fixture.recover
			yield* fixture.people.remove(owner.user.id, ADMIN)
			const fresh = yield* fixture.people.register(PROFILE)
			yield* fixture.people.admit({allow: true, id: fresh.user.id}, ADMIN)
			assert.isTrue(isDenied(yield* Effect.flip(fixture.auth.user(headers))))
			assert.notStrictEqual(fresh.incarnation, owner.incarnation)
		})
	)
})
