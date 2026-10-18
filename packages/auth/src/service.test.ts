import {NodeServices} from '@effect/platform-node'
import {assert, it} from '@effect/vitest'

import {Array, Boolean, ConfigProvider, Effect, Layer, Option, Schema, String, pipe} from 'effect'

import {Base64Url} from 'effect/encoding'
import {HttpClient, HttpClientResponse, HttpRouter, HttpServerResponse} from 'effect/http'

import {Session, User} from '#schema'
import {Auth, HttpAuth, Issuer} from '#service'

import {CurrentUser} from '#lib/utils'

const AUTH = 'auth.example.test'
const APP = 'app.example.test'

// A code is `<login>.<challenge>` and, as on GitHub, redeems only with the verifier hashing to that challenge.
const github = HttpClient.make(request =>
	Effect.gen(function* () {
		if (request.url === 'https://github.com/login/oauth/access_token' && request.body._tag === 'Uint8Array') {
			const form = new URLSearchParams(new TextDecoder().decode(request.body.body))
			const [login, challenge] = String.split(form.get('code') ?? '', '.')
			if (
				Base64Url.encode(
					new Uint8Array(
						yield* Effect.promise(() =>
							crypto.subtle.digest('SHA-256', new TextEncoder().encode(form.get('code_verifier') ?? ''))
						)
					)
				) !== challenge
			) {
				return HttpClientResponse.fromWeb(request, Response.json({error: 'bad_verification_code'}))
			}
			return HttpClientResponse.fromWeb(request, Response.json({access_token: login}))
		}
		const login = pipe(request.headers['authorization'] ?? '', String.replace('Bearer ', ''))
		return HttpClientResponse.fromWeb(
			request,
			Response.json({id: Boolean.match(login === 'octocat', {onFalse: () => 7, onTrue: () => 42_154_987}), login})
		)
	})
)

const me = pipe(
	HttpRouter.add(
		'GET',
		'/me',
		Effect.gen(function* () {
			return yield* HttpServerResponse.schemaJson(User)(yield* CurrentUser)
		})
	),
	Layer.provide(HttpAuth.layer)
)

// The auth app at auth.example.test, and an app at app.example.test that reads its key over HTTP.
const servers = Effect.gen(function* () {
	const issuer = yield* Effect.acquireRelease(
		Effect.sync(() =>
			HttpRouter.toWebHandler(
				pipe(
					me,
					Layer.provide(Issuer.layer({redirects: ['app://auth']})),
					Layer.provide(
						Layer.mergeAll(
							Layer.succeed(HttpClient.HttpClient, github),
							NodeServices.layer,
							ConfigProvider.layer(
								ConfigProvider.fromUnknown({
									GITHUB_CLIENT_ID: 'client',
									GITHUB_CLIENT_SECRET: 'secret',
									GITHUB_USERS: '42154987'
								})
							)
						)
					)
				),
				{disableLogger: true}
			)
		),
		web => Effect.promise(() => web.dispose())
	)
	const app = yield* Effect.acquireRelease(
		Effect.sync(() =>
			HttpRouter.toWebHandler(
				pipe(
					me,
					Layer.provide(Auth.layer),
					Layer.provide(
						Layer.mergeAll(
							Layer.succeed(
								HttpClient.HttpClient,
								HttpClient.make(request =>
									Effect.map(
										Effect.promise(() => issuer.handler(new Request(request.url))),
										response => HttpClientResponse.fromWeb(request, response)
									)
								)
							),
							ConfigProvider.layer(ConfigProvider.fromUnknown({AUTH_URL: `https://${AUTH}`}))
						)
					)
				),
				{disableLogger: true}
			)
		),
		web => Effect.promise(() => web.dispose())
	)
	return {app, issuer}
})

function send(
	web: Effect.Success<typeof servers>['app'],
	url: string,
	init: {authorization?: string; cookie?: string; method?: 'POST'; origin?: string} = {}
) {
	const target = new URL(url)
	return Effect.promise(() =>
		web.handler(
			new Request(target, {
				// An empty value leaves the header out, as a command line sends no Origin.
				headers: Array.filter(
					[
						['authorization', init.authorization ?? ''],
						['cookie', init.cookie ?? ''],
						['host', target.host],
						['origin', init.origin ?? target.origin],
						['x-forwarded-proto', 'https']
					],
					header => header[1] !== ''
				),
				method: init.method ?? 'GET',
				redirect: 'manual'
			})
		)
	)
}

function cookie(response: Response, name: string) {
	return pipe(
		response.headers.getSetCookie(),
		Array.findFirst(String.startsWith(`${name}=`)),
		Option.getOrElse(() => '')
	)
}

const signedInAs = Effect.fnUntraced(function* (
	web: Effect.Success<typeof servers>['app'],
	init: {authorization?: string; cookie?: string; origin?: string}
) {
	const response = yield* send(web, `https://${APP}/me`, init)
	if (response.status !== 200) return response.status
	return (yield* Schema.decodeEffect(Schema.fromJsonString(User))(yield* Effect.promise(() => response.text()))).name
})

// Follows the redirect to GitHub as a browser would and returns the callback's response.
const signInWithGitHub = Effect.fnUntraced(function* (
	issuer: Effect.Success<typeof servers>['issuer'],
	login: string,
	options: {redirect?: string; state?: string} = {}
) {
	const start = yield* send(
		issuer,
		`https://${AUTH}/auth/github${Option.match(Option.fromUndefinedOr(options.redirect), {
			onNone: () => '',
			onSome: redirect => `?redirect=${encodeURIComponent(redirect)}`
		})}`
	)
	const authorize = new URL(start.headers.get('location') ?? '')
	return yield* send(
		issuer,
		`https://${AUTH}/auth/github/callback?code=${login}.${authorize.searchParams.get('code_challenge') ?? ''}&state=${options.state ?? authorize.searchParams.get('state') ?? ''}`,
		{cookie: pipe(cookie(start, '__Host-oauth'), String.split(';'), Array.headNonEmpty)}
	)
})

it.live('signs in on the auth app and sends the browser back to an app on the same domain with the cookie', () =>
	Effect.gen(function* () {
		const web = yield* servers

		const authorize = new URL((yield* send(web.issuer, `https://${AUTH}/auth/github`)).headers.get('location') ?? '')
		assert.strictEqual(`${authorize.origin}${authorize.pathname}`, 'https://github.com/login/oauth/authorize')
		assert.strictEqual(authorize.searchParams.get('redirect_uri'), `https://${AUTH}/auth/github/callback`)
		assert.strictEqual(authorize.searchParams.get('code_challenge_method'), 'S256')

		const callback = yield* signInWithGitHub(web.issuer, 'octocat', {redirect: `https://${APP}/notes`})
		assert.strictEqual(callback.headers.get('location'), `https://${APP}/notes`)
		assert.include(cookie(callback, '__Secure-session'), 'Domain=example.test')
		const session = pipe(cookie(callback, '__Secure-session'), String.split(';'), Array.headNonEmpty)
		assert.strictEqual(yield* signedInAs(web.app, {cookie: session}), 'octocat')

		assert.strictEqual((yield* signInWithGitHub(web.issuer, 'octocat', {state: 'forged'})).status, 401)
		const stranger = yield* signInWithGitHub(web.issuer, 'stranger')
		assert.deepStrictEqual([stranger.status, cookie(stranger, '__Secure-session')], [401, ''])
		assert.strictEqual(
			(yield* send(web.issuer, `https://${AUTH}/auth/github?redirect=${encodeURIComponent('https://evil.test/')}`))
				.status,
			401
		)

		// An allowed id under a reused signature: only the signature check rejects it.
		assert.strictEqual(
			yield* signedInAs(web.app, {
				cookie: `__Secure-session=${yield* Schema.encodeEffect(Session)({expiresAt: 9e15, user: {id: 'github:42154987', name: 'mallory'}})}.${Array.lastNonEmpty(String.split(session, '.'))}`
			}),
			401
		)
	})
)

it.live('hands a native app its token only on a registered redirect', () =>
	Effect.gen(function* () {
		const web = yield* servers

		const location = new URL(
			(yield* signInWithGitHub(web.issuer, 'octocat', {redirect: 'app://auth'})).headers.get('location') ?? ''
		)
		assert.strictEqual(`${location.protocol}//${location.host}`, 'app://auth')
		assert.strictEqual(
			yield* signedInAs(web.app, {authorization: `Bearer ${location.searchParams.get('token') ?? ''}`, origin: ''}),
			'octocat'
		)
		assert.strictEqual((yield* send(web.issuer, `https://${AUTH}/auth/github?redirect=evil://auth`)).status, 401)
	})
)

it.live('answers a request from another origin with 403 and signs out from the auth app', () =>
	Effect.gen(function* () {
		const web = yield* servers
		const session = pipe(
			cookie(yield* signInWithGitHub(web.issuer, 'octocat'), '__Secure-session'),
			String.split(';'),
			Array.headNonEmpty
		)

		assert.strictEqual(yield* signedInAs(web.app, {cookie: session, origin: `https://${AUTH}`}), 403)
		assert.strictEqual(yield* signedInAs(web.app, {cookie: session, origin: `http://${APP}`}), 403)
		assert.strictEqual(
			(yield* send(web.issuer, `https://${AUTH}/auth/sign-out`, {method: 'POST', origin: `https://${APP}`})).status,
			403
		)
		const signOut = yield* send(web.issuer, `https://${AUTH}/auth/sign-out`, {cookie: session, method: 'POST'})
		assert.strictEqual(signOut.status, 303)
		assert.include(cookie(signOut, '__Secure-session'), 'Domain=example.test')
	})
)
