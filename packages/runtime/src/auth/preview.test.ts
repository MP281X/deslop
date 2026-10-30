import {assert, it} from '@effect/vitest'

import {Array, Clock, Effect, Layer, MutableList, Option, Ref, String, pipe} from 'effect'

import {HttpClient, HttpClientResponse, HttpRouter, HttpServerResponse} from 'effect/http'
import {TestClock} from 'effect/testing'

import {AUTH_URL, CurrentUser, signInUrl} from './lib/utils.ts'
import {Auth, HttpAuth} from './service.ts'

const ORIGIN = 'https://dev.tailnet-8c4c.ts.net:26493'

it.effect(
	'returns an approved browser to its preview, renews once across concurrent calls and fails closed',
	Effect.fnUntraced(function* () {
		const calls = MutableList.make<{url: string; authorization: string; form: URLSearchParams}>()
		const refreshes = yield* Ref.make(0)
		const issuerDown = yield* Ref.make(false)
		const client = HttpClient.make(request =>
			Effect.gen(function* () {
				const form = new URLSearchParams()
				if (request.body._tag === 'Uint8Array') {
					for (const pair of new URLSearchParams(new TextDecoder().decode(request.body.body))) {
						form.append(pair[0], pair[1])
					}
				}
				MutableList.append(calls, {authorization: request.headers['authorization'] ?? '', form, url: request.url})
				if (yield* Ref.get(issuerDown)) return HttpClientResponse.fromWeb(request, Response.json({}, {status: 503}))
				if (String.endsWith('/oauth2/register')(request.url)) {
					return HttpClientResponse.fromWeb(request, Response.json({client_id: 'preview-client'}))
				}
				if (String.endsWith('/oauth2/token')(request.url)) {
					assert.strictEqual(form.get('resource'), 'https://signal.mp281x.xyz')
					if (form.get('grant_type') === 'authorization_code') {
						assert.strictEqual(form.get('redirect_uri'), `${ORIGIN}/auth/callback`)
						assert.isAtLeast(form.get('code_verifier')?.length ?? 0, 43)
						return HttpClientResponse.fromWeb(
							request,
							Response.json({access_token: 'initial-access', expires_in: 120, refresh_token: 'first-refresh'})
						)
					}
					assert.strictEqual(form.get('refresh_token'), 'first-refresh')
					yield* Ref.update(refreshes, count => count + 1)
					return HttpClientResponse.fromWeb(
						request,
						Response.json({access_token: 'renewed-access', expires_in: 600, refresh_token: 'rotated-refresh'})
					)
				}
				if (String.endsWith('/oauth2/revoke')(request.url)) {
					assert.strictEqual(form.get('token'), 'rotated-refresh')
					return HttpClientResponse.fromWeb(request, new Response())
				}
				if (String.endsWith('/auth/verify')(request.url)) {
					return HttpClientResponse.fromWeb(request, Response.json({id: 'github:42', name: 'signed-in'}))
				}
				return HttpClientResponse.fromWeb(request, Response.json({}, {status: 401}))
			})
		)
		const clock = yield* Clock.Clock
		const web = yield* Effect.acquireRelease(
			Effect.sync(() =>
				HttpRouter.toWebHandler(
					pipe(
						HttpRouter.add(
							'GET',
							'/private',
							Effect.map(CurrentUser, user => HttpServerResponse.text(user.name))
						),
						Layer.provide(HttpAuth.layer),
						Layer.provide(Auth.layer('https://signal.mp281x.xyz')),
						Layer.provide(Layer.succeed(HttpClient.HttpClient, client)),
						Layer.provideMerge(Layer.succeed(Clock.Clock, clock))
					),
					{disableLogger: true}
				)
			),
			value => Effect.promise(() => value.dispose())
		)
		function send(path: string, cookie = '', origin = ORIGIN, method = 'GET', suppliedOrigin = origin) {
			return Effect.tryPromise(() =>
				web.handler(
					new Request(`${origin}${path}`, {
						headers: {cookie, host: new URL(origin).host, origin: suppliedOrigin},
						method
					})
				)
			)
		}
		assert.strictEqual((yield* send('/private')).status, 401)
		assert.strictEqual((yield* send('/auth/callback')).status, 400)
		assert.strictEqual((yield* send(signInUrl('https://evil.test/'))).status, 400)
		const next = `${ORIGIN}/?inspect=2#history`
		const start = yield* send(signInUrl(next))
		assert.strictEqual(start.status, 302)
		const authorize = new URL(start.headers.get('location') ?? '')
		assert.strictEqual(authorize.origin, AUTH_URL)
		assert.strictEqual(authorize.searchParams.get('redirect_uri'), `${ORIGIN}/auth/callback`)
		assert.strictEqual(authorize.searchParams.get('code_challenge_method'), 'S256')
		assert.strictEqual(authorize.searchParams.get('resource'), 'https://signal.mp281x.xyz')
		const loginCookie = start.headers.getSetCookie()[0] ?? ''
		assert.include(loginCookie, '__Host-deslop-login-26493=')
		assert.include(loginCookie, 'HttpOnly')
		assert.include(loginCookie, 'Secure')
		assert.notInclude(loginCookie, 'Domain=')
		const callback = `/auth/callback?${new URLSearchParams({code: 'approved-code', iss: `${AUTH_URL}/api/auth`, state: authorize.searchParams.get('state') ?? ''})}`
		assert.strictEqual((yield* send(callback)).status, 400)
		assert.strictEqual(
			(yield* send(
				String.replace(encodeURIComponent(`${AUTH_URL}/api/auth`), encodeURIComponent('https://evil.test'))(callback),
				loginCookie
			)).status,
			400
		)
		const completed = yield* send(callback, loginCookie)
		assert.strictEqual(completed.status, 302)
		assert.strictEqual(completed.headers.get('location'), next)
		const cookie = Option.getOrThrow(
			Array.findFirst(completed.headers.getSetCookie(), String.startsWith('__Host-deslop-session-26493='))
		)
		assert.notInclude(cookie, 'initial-access')
		assert.notInclude(cookie, 'first-refresh')
		assert.strictEqual((yield* send(callback, loginCookie)).status, 400)
		assert.strictEqual((yield* send('/private', cookie)).status, 200)
		assert.strictEqual((yield* send('/private', cookie, 'https://dev.tailnet-8c4c.ts.net:26494')).status, 401)
		assert.strictEqual((yield* send('/private', cookie, ORIGIN, 'GET', 'https://evil.test')).status, 401)
		yield* TestClock.adjust('61 seconds')
		assert.deepStrictEqual(
			Array.map(
				yield* Effect.all([send('/private', cookie), send('/private', cookie)], {concurrency: 'unbounded'}),
				response => response.status
			),
			[200, 200]
		)
		assert.strictEqual(yield* Ref.get(refreshes), 1)
		assert.strictEqual(
			Option.getOrThrow(
				Array.last(Array.filter(MutableList.toArray(calls), call => String.endsWith('/auth/verify')(call.url)))
			).authorization,
			'Bearer renewed-access'
		)
		yield* Ref.set(issuerDown, true)
		assert.strictEqual((yield* send('/private', cookie)).status, 503)
		yield* Ref.set(issuerDown, false)
		assert.strictEqual((yield* send('/private', cookie)).status, 200)
		assert.strictEqual((yield* send('/auth/sign-out', cookie, ORIGIN, 'POST', 'https://evil.test')).status, 400)
		assert.strictEqual((yield* send('/auth/sign-out', cookie, ORIGIN, 'POST')).status, 204)
		assert.strictEqual((yield* send('/private', cookie)).status, 401)
		assert.strictEqual(
			new URL(
				(yield* send(signInUrl('https://signal.mp281x.xyz/?inspect=2'), '', 'https://signal.mp281x.xyz')).headers.get(
					'location'
				) ?? ''
			).pathname,
			'/auth/github'
		)
		assert.strictEqual((yield* send(signInUrl('/'), '', 'https://evil.test')).status, 400)
	})
)
