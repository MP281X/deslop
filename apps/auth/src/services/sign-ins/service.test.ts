import {assert, it} from '@effect/vitest'

import {ConfigProvider, Effect, Layer, Option, Result, Schema, pipe} from 'effect'

import {Headers} from 'effect/http'

import {GitHubId, SESSION_COOKIE, UserId} from '@deslop/runtime/shared/auth'

import {SignIns, loginCookie} from './service.ts'

import {CookieSessions} from '#services/cookie-sessions/service.ts'
import {AppSignIn, OAuthState} from '#services/github/schema.ts'
import {GitHub} from '#services/github/service.ts'
import {Identity} from '#services/identity/service.ts'
import {Member} from '#services/people/schema.ts'
import {People} from '#services/people/service.ts'

const ID = UserId.make('github:2')
const member = {fullName: Option.none(), id: ID, name: 'person', since: Option.none(), status: 'Allowed' as const}
const layer = pipe(
	SignIns.layer,
	Layer.provide(
		Layer.mock(GitHub, {
			finish: (_code, state) =>
				Effect.succeed({
					flow: {app: Schema.decodeUnknownOption(AppSignIn)({app: state}), next: 'https://stash.example.test'},
					profile: {id: GitHubId.make(2), login: 'person', name: Option.none()}
				}),
			start: () => Effect.succeed({state: OAuthState.make('state'), url: 'https://github.com/login'})
		})
	),
	Layer.provide(Layer.mock(People, {register: () => Effect.succeed(Member.make(member))})),
	Layer.provide(Layer.mock(CookieSessions, {create: () => Effect.succeed('secret'), forget: () => Effect.void})),
	Layer.provide(
		Layer.mock(Identity, {
			resolve: () => Effect.succeed({...member, admin: false, role: 'Member' as const, signOut: true})
		})
	),
	Layer.provide(
		ConfigProvider.layer(
			ConfigProvider.fromUnknown({APP_URL: 'https://auth.example.test', AUTH_URL: 'https://auth.example.test'})
		)
	)
)

it.layer(layer)(test => {
	test.effect.each(['opm', 'stash', 'trips'] as const)(
		'hands %s only to Auth HTTPS, never a browser cookie',
		Effect.fnUntraced(function* (app) {
			const signIns = yield* SignIns
			const result = yield* signIns.finish(
				new URLSearchParams({code: 'code', state: app}),
				Headers.fromInput({cookie: `${loginCookie(app)}=${app}; ${loginCookie('second')}=second`})
			)
			assert.equal(result.target, `https://auth.example.test/signed-in/${app}?session=secret`)
			assert.isTrue(Option.isNone(result.session))
		})
	)
	test.effect(
		'browser sign-in sets a session; cancels, malformed callbacks, unknown apps and cross-site sign-out refuse',
		Effect.fnUntraced(function* () {
			const signIns = yield* SignIns
			const signed = yield* signIns.finish(
				new URLSearchParams({code: 'code', state: 'state'}),
				Headers.fromInput({cookie: `${loginCookie('state')}=state`})
			)
			assert.deepStrictEqual([signed.target, signed.session], ['https://stash.example.test', Option.some('secret')])
			for (const query of ['error=access_denied', 'state=state', 'code=code&state=other']) {
				const result = yield* Effect.result(signIns.finish(new URLSearchParams(query), Headers.empty))
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
				'https://auth.example.test'
			)
		})
	)
})
