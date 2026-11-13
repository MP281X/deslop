import {NodeCrypto} from '@effect/platform-node'
import {SqliteClient} from '@effect/sql-sqlite-node'
import {assert, it} from '@effect/vitest'

import {Array, ConfigProvider, Context, Effect, Layer, Option, Schema, Stream, pipe} from 'effect'

import {Digest} from 'effect/crypto'
import {Base64Url} from 'effect/encoding'
import {Headers} from 'effect/http'
import {Reactivity} from 'effect/reactivity'
import {RpcTest} from 'effect/rpc'
import {SqlClient} from 'effect/sql'

import {Auth} from '@deslop/runtime/server/auth'
import {ClientId, GitHubId, SESSION_COOKIE, UserId, isDenied} from '@deslop/runtime/shared/auth'

import {RpcContracts} from '#rpcs/contracts.ts'
import {RpcHandlers} from '#rpcs/handlers.ts'
import {Passkeys} from '#services/passkeys/service.ts'
import {Member} from '#services/people/schema.ts'
import {People, layerIssuerAuth} from '#services/people/service.ts'
import {REQUEST_COOKIE, SignIns} from '#services/sign-ins/service.ts'
import type {ClientRequest} from '#services/tokens/schema.ts'
import {BrowserSession, Origin} from '#services/tokens/schema.ts'
import {Tokens} from '#services/tokens/service.ts'

const VERIFIER = 'xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx'
const ADMIN = {id: UserId.make('github:42'), name: 'admin'}
const PROFILE = {id: GitHubId.make(7), login: 'member', name: Option.none<string>()}
const ORIGIN = Schema.decodeSync(Origin)({})

const open = Effect.gen(function* () {
	const database = yield* Layer.build(Layer.merge(SqliteClient.layer({filename: ':memory:'}), Reactivity.layer))
	const sql = Context.get(database, SqlClient.SqlClient)
	const layer = pipe(
		RpcHandlers,
		Layer.provideMerge(layerIssuerAuth),
		Layer.provideMerge(SignIns.layer),
		Layer.provideMerge(People.layer),
		Layer.provideMerge(Layer.merge(Tokens.layer, Passkeys.layer)),
		Layer.provide(Layer.succeedContext(database)),
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
		clientId: ClientId.make('fixture'),
		clientName: 'Fixture',
		parent: Option.none(),
		redirectUri: 'http://127.0.0.1/callback',
		state: Option.none()
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
			const other = yield* fixture.people.register({id: GitHubId.make(9), login: 'another', name: Option.none()})
			const headers = Headers.fromInput({
				cookie: `${SESSION_COOKIE}=${(yield* fixture.tokens.startSession(member, ORIGIN, 'GitHub', Option.none())).token}`
			})
			const otherHeaders = Headers.fromInput({
				cookie: `${SESSION_COOKIE}=${(yield* fixture.tokens.startSession(other, ORIGIN, 'GitHub', Option.none())).token}`
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
			const pending = yield* fixture.signIns.start({_tag: 'Browser', next: Option.none()}, ORIGIN)
			yield* client['sign-ins.answer']({accept: true, request: pending.code}, {headers})
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
				cookie: `${SESSION_COOKIE}=${(yield* fixture.tokens.startSession(owner, ORIGIN, 'GitHub', Option.none())).token}`
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
					grant_type: 'authorization_code',
					redirect_uri: Option.none()
				},
				ORIGIN,
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
						{
							client_id: asked.clientId,
							code: unspent,
							code_verifier: VERIFIER,
							grant_type: 'authorization_code',
							redirect_uri: Option.none()
						},
						ORIGIN,
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
						{client_id: Option.none(), grant_type: 'refresh_token', refresh_token: granted.tokens.refresh_token},
						ORIGIN,
						restarted.people.allowed
					)
				)).error,
				'invalid_grant'
			)
			assert.deepStrictEqual(yield* first(restarted.tokens.watchApps(renewed)), [])
			assert.deepStrictEqual(
				yield* restarted.auth.user(
					Headers.fromInput({
						cookie: `${SESSION_COOKIE}=${(yield* restarted.tokens.startSession(renewed, ORIGIN, 'GitHub', Option.none())).token}`
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
			const pending = yield* fixture.signIns.start({_tag: 'Browser', next: Option.none()}, ORIGIN)
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
			assert.deepStrictEqual(yield* first(fixture.tokens.watchApps(fresh)), [])
		})
	)

	test.effect(
		'shows an admin by GitHub id until their first sign-in supplies a profile',
		Effect.fnUntraced(function* () {
			const fixture = yield* open
			assert.deepStrictEqual(
				Array.map(yield* first(fixture.people.watch(ADMIN)), person => `${person.name}:${person.role}`),
				['GitHub 42:Admin']
			)
			yield* fixture.people.register({id: GitHubId.make(42), login: 'admin', name: Option.none()})
			assert.deepStrictEqual(
				Array.map(yield* first(fixture.people.watch(ADMIN)), person => `${person.name}:${person.role}`),
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
			const old = yield* fixture.tokens.startSession(owner, ORIGIN, 'GitHub', Option.none())
			yield* fixture.people.remove(owner.user.id, ADMIN)
			const fresh = yield* fixture.people.register(PROFILE)
			yield* fixture.people.admit({allow: true, id: fresh.user.id}, ADMIN)
			assert.isTrue(
				isDenied(yield* Effect.flip(fixture.auth.user(Headers.fromInput({cookie: `${SESSION_COOKIE}=${old.token}`}))))
			)
			const started = yield* fixture.tokens.startSession(fresh, ORIGIN, 'GitHub', Option.none())
			// The removed registration's cleanup, run again late, leaves every credential of the new one alone.
			yield* fixture.tokens.forget(owner)
			yield* fixture.passkeys.forget(owner)
			assert.deepStrictEqual(
				yield* fixture.auth.user(Headers.fromInput({cookie: `${SESSION_COOKIE}=${started.token}`})),
				fresh.user
			)
			assert.strictEqual((yield* first(fixture.tokens.watchApps(fresh))).length, 1)
		})
	)

	test.effect(
		'keeps a failed membership removal valid and a committed one revoked across re-registration',
		Effect.fnUntraced(function* () {
			const fixture = yield* open
			const owner = yield* fixture.people.register(PROFILE)
			yield* fixture.people.admit({allow: true, id: owner.user.id}, ADMIN)
			const headers = Headers.fromInput({
				cookie: `${SESSION_COOKIE}=${(yield* fixture.tokens.startSession(owner, ORIGIN, 'GitHub', Option.none())).token}`
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
