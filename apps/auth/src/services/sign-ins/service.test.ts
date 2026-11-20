import {NodeServices} from '@effect/platform-node'
import {assert, it} from '@effect/vitest'

import {ConfigProvider, DateTime, Effect, FileSystem, Layer, Option, Result, Schema, pipe} from 'effect'

import {Headers} from 'effect/http'

import {layerDataStore} from '@deslop/runtime/server/store'
import {AuthError, GitHubId, SESSION_COOKIE, UserId} from '@deslop/runtime/shared/auth'

import {SignIns, loginCookie} from './service.ts'

import {AppSignIn, GitHubOAuthState} from '#services/github/schema.ts'
import {GitHub} from '#services/github/service.ts'
import {Identity} from '#services/identity/service.ts'
import {Member} from '#services/people/schema.ts'
import {People} from '#services/people/service.ts'
import {Sessions} from '#services/sessions/service.ts'

const ID = UserId.make('github:2')
const member = {
	fullName: Option.none(),
	id: ID,
	name: 'person',
	since: Option.none(),
	status: Option.some('Allowed' as const),
	tailnet: false
}
// A sealed login cookie stands in as its own state; the code `refused` is one GitHub turns down.
const layer = pipe(
	SignIns.layer,
	Layer.provide(
		Layer.mock(GitHub, {
			finish: code => {
				if (code === 'refused') return Effect.fail(AuthError.make({message: 'The sign-in expired; sign in again'}))
				return Effect.succeed({id: GitHubId.make(2), login: 'person', name: Option.none()})
			},
			resume: (state, sealed) => {
				if (sealed !== state) return Effect.fail(AuthError.make({message: 'The sign-in expired'}))
				return Effect.succeed({
					app: Schema.decodeUnknownOption(AppSignIn)({app: state}),
					expires: DateTime.makeUnsafe(Date.UTC(2100, 0)),
					next: 'https://stash.example.test/',
					verifier: 'verifier'
				})
			},
			start: () =>
				Effect.succeed({sealed: 'sealed', state: GitHubOAuthState.make('state'), url: 'https://github.com/login'})
		})
	),
	Layer.provide(Layer.mock(People, {register: () => Effect.succeed(Member.make(member))})),
	Layer.provide(Layer.mock(Sessions, {create: () => Effect.succeed('secret'), forget: () => Effect.void})),
	Layer.provide(
		Layer.mock(Identity, {
			resolve: () => Effect.succeed({...member, admin: false, role: 'Member' as const, signOut: true})
		})
	),
	Layer.provide(
		Layer.unwrap(
			Effect.gen(function* () {
				return layerDataStore(yield* (yield* FileSystem.FileSystem).makeTempDirectoryScoped())
			})
		)
	),
	Layer.provide(NodeServices.layer),
	Layer.provide(
		ConfigProvider.layer(
			ConfigProvider.fromUnknown({APP_URL: 'https://auth.example.test', AUTH_URL: 'https://auth.example.test'})
		)
	)
)

it.layer(layer)(test => {
	test.effect.each(['opm', 'stash', 'trips'] as const)(
		'hands %s only to Auth HTTPS, never a browser cookie, and a refusal or cancel there too',
		Effect.fnUntraced(function* (app) {
			const signIns = yield* SignIns
			const cookie = Headers.fromInput({cookie: `${loginCookie(app)}=${app}; ${loginCookie('second')}=second`})
			const result = yield* signIns.finish(new URLSearchParams({code: 'code', state: app}), cookie)
			assert.equal(result.target, `https://auth.example.test/signed-in/${app}?session=secret`)
			assert.isTrue(Option.isNone(result.session))
			assert.equal(
				(yield* signIns.finish(new URLSearchParams({code: 'refused', state: app}), cookie)).target,
				`https://auth.example.test/signed-in/${app}?${new URLSearchParams({error: 'The sign-in expired; sign in again'})}`
			)
			assert.equal(
				(yield* signIns.finish(new URLSearchParams({error: 'access_denied', state: app}), cookie)).target,
				`https://auth.example.test/signed-in/${app}?${new URLSearchParams({error: 'GitHub sign-in was cancelled'})}`
			)
		})
	)
	test.effect(
		'browser sign-in sets a session; cancels, malformed callbacks, unknown apps and cross-site sign-out refuse',
		Effect.fnUntraced(function* () {
			const signIns = yield* SignIns
			const cookie = Headers.fromInput({cookie: `${loginCookie('state')}=state`})
			const signed = yield* signIns.finish(new URLSearchParams({code: 'code', state: 'state'}), cookie)
			assert.deepStrictEqual([signed.target, signed.session], ['https://stash.example.test/', Option.some('secret')])
			const refused = yield* signIns.finish(new URLSearchParams({code: 'refused', state: 'state'}), cookie)
			assert.deepStrictEqual(
				[refused.target, refused.session],
				[
					`/?${new URLSearchParams({error: 'The sign-in expired; sign in again', next: 'https://stash.example.test/'})}`,
					Option.none()
				]
			)
			const cancelled = yield* signIns.finish(new URLSearchParams({error: 'access_denied', state: 'state'}), cookie)
			assert.deepStrictEqual(
				[cancelled.target, cancelled.session],
				[
					`/?${new URLSearchParams({error: 'GitHub sign-in was cancelled', next: 'https://stash.example.test/'})}`,
					Option.none()
				]
			)
			for (const query of ['error=access_denied', 'error=access_denied&state=other', 'code=code&state=other']) {
				const result = yield* Effect.result(signIns.finish(new URLSearchParams(query), cookie))
				assert.isTrue(Result.isFailure(result))
				if (Result.isFailure(result)) assert.equal(result.failure._tag, 'AuthError')
			}
			assert.isTrue(Result.isFailure(yield* Effect.result(signIns.start(new URLSearchParams({app: 'evil'})))))
			for (const origin of ['https://evil.test', 'null', '']) {
				assert.isTrue(
					Result.isFailure(
						yield* Effect.result(
							signIns.signOut(new URLSearchParams(), Headers.fromInput({cookie: `${SESSION_COOKIE}=secret`, origin}))
						)
					)
				)
			}
			assert.equal(
				yield* signIns.signOut(new URLSearchParams(), Headers.fromInput({origin: 'https://auth.example.test'})),
				'https://auth.example.test/'
			)
		})
	)
})
