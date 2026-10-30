import {Array, Boolean, Cache, Clock, Effect, Option, Ref, Schema, Semaphore, String, pipe} from 'effect'

import {Digest, SecureRandom} from 'effect/crypto'
import {Base64Url} from 'effect/encoding'
import {
	Cookies,
	Headers,
	HttpClientError,
	HttpClientRequest,
	HttpClientResponse,
	HttpRouter,
	HttpServerRequest,
	HttpServerResponse,
	Url
} from 'effect/http'
import type {HttpClient} from 'effect/http'

import {AUTH_URL, previewOrigin} from '#auth/lib/utils.ts'
import {AuthError, ClientRegistration, PreviewCallback, PreviewLogin, TokenResponse} from '#auth/schema.ts'
import type {Credentials} from '#auth/schema.ts'

const COOKIE = {httpOnly: true, path: '/', sameSite: 'lax', secure: true} as const

type Flow = {clientId: string; next: string; origin: string; verifier: string}
type Session = {credentials: Ref.Ref<Credentials>; gate: Semaphore.Semaphore; origin: string}

function expired(cause?: unknown) {
	return AuthError.make({cause, message: 'This preview sign-in expired. Start sign-in again in the app.'})
}

function required<A>(value: Option.Option<A>) {
	return pipe(Effect.fromOption(value), Effect.mapError(expired))
}

function address(headers: Headers.Headers) {
	return previewOrigin(`https://${headers['host'] ?? ''}`)
}

// Cookies are host-scoped, not port-scoped; neighbouring worktrees must not overwrite one another.
function cookieName(origin: string, kind: 'login' | 'session') {
	return `__Host-deslop-${kind}-${new URL(origin).port}`
}

function route<E, R>(effect: Effect.Effect<HttpServerResponse.HttpServerResponse, E, R>) {
	return pipe(
		effect,
		Effect.catch(cause =>
			Effect.succeed(
				HttpServerResponse.text('Preview sign-in could not complete. Return to the app and try again.', {
					status: Boolean.match(Schema.is(AuthError)(cause) || Schema.isSchemaError(cause), {
						onFalse: () => 503,
						onTrue: () => 400
					})
				})
			)
		),
		Effect.map(HttpServerResponse.setHeaders({'cache-control': 'no-store', 'referrer-policy': 'no-referrer'}))
	)
}

export const previewAuth = Effect.fnUntraced(function* (
	resource: string,
	issuerUrl: string,
	client: HttpClient.HttpClient
) {
	const random = yield* SecureRandom.SecureRandom
	const digest = yield* Digest.Digest
	const router = yield* HttpRouter.HttpRouter
	const flows = yield* Cache.make<string, Flow, AuthError>({
		capacity: 32,
		lookup: () => Effect.fail(expired()),
		timeToLive: '5 minutes'
	})
	// A preview restart deliberately ends its sessions; no credentials enter app data or browser storage.
	const sessions = yield* Cache.make<string, Session, AuthError>({
		capacity: 32,
		lookup: () => Effect.fail(expired()),
		timeToLive: '8 hours'
	})
	const callbacks = yield* Semaphore.make(1)
	const mint = Effect.map(random.randomBytes(32), Base64Url.encode)
	const token = Effect.fnUntraced(function* (clientId: string, params: Record<string, string>) {
		const request = HttpClientRequest.bodyUrlParams(HttpClientRequest.post(`${issuerUrl}/api/auth/oauth2/token`), {
			...params,
			client_id: clientId,
			resource
		})
		const response = yield* pipe(
			client.execute(request),
			Effect.flatMap(HttpClientResponse.schemaBodyJson(TokenResponse)),
			Effect.timeout('10 seconds')
		)
		return {
			accessToken: response.access_token,
			clientId,
			expiresAt: (yield* Clock.currentTimeMillis) + response.expires_in * 1000,
			refreshToken: response.refresh_token
		} satisfies Credentials
	})

	yield* router.add(
		'GET',
		'/auth/sign-in',
		route(
			Effect.gen(function* () {
				const request = yield* HttpServerRequest.HttpServerRequest
				const params = yield* HttpServerRequest.schemaSearchParams(PreviewLogin)
				const origin = Option.getOrElse(address(request.headers), () => new URL(resource).origin)
				const next = yield* pipe(
					Effect.fromResult(Url.fromString(params.next ?? '/', origin)),
					Effect.mapError(expired)
				)
				if (next.origin !== origin || next.username !== '' || next.password !== '') return yield* expired()
				if (Option.isNone(address(request.headers))) {
					if (request.headers['host'] !== new URL(resource).host) return yield* expired()
					// Auth offers GitHub or a code another device approves, then returns here.
					return HttpServerResponse.redirect(`${AUTH_URL}/?${new URLSearchParams({next: next.href})}`)
				}
				const callback = `${origin}/auth/callback`
				const registration = yield* pipe(
					HttpClientRequest.post(`${issuerUrl}/api/auth/oauth2/register`),
					HttpClientRequest.bodyJson({
						// Auth names the device from the callback's worker and port.
						client_name: `${String.capitalize(Array.headNonEmpty(String.split(new URL(resource).hostname, '.')))} preview`,
						redirect_uris: [callback],
						token_endpoint_auth_method: 'none'
					}),
					Effect.flatMap(value => client.execute(value)),
					Effect.flatMap(HttpClientResponse.schemaBodyJson(ClientRegistration)),
					Effect.timeout('10 seconds')
				)
				const state = yield* mint
				const verifier = yield* mint
				const challenge = Base64Url.encode(yield* digest.digest(Digest.sha256, new TextEncoder().encode(verifier)))
				yield* Cache.set(flows, state, {clientId: registration.client_id, next: next.href, origin, verifier})
				return HttpServerResponse.setCookieUnsafe(
					HttpServerResponse.redirect(
						`${AUTH_URL}/api/auth/oauth2/authorize?${new URLSearchParams({
							client_id: registration.client_id,
							code_challenge: challenge,
							code_challenge_method: 'S256',
							redirect_uri: callback,
							resource,
							response_type: 'code',
							scope: 'deslop offline_access',
							state
						})}`
					),
					cookieName(origin, 'login'),
					state,
					{...COOKIE, maxAge: '5 minutes'}
				)
			})
		)
	)

	yield* router.add(
		'GET',
		'/auth/callback',
		route(
			Effect.gen(function* () {
				const request = yield* HttpServerRequest.HttpServerRequest
				const origin = yield* required(address(request.headers))
				const params = yield* HttpServerRequest.schemaSearchParams(PreviewCallback)
				const flow = yield* callbacks.withPermit(
					Effect.gen(function* () {
						const found = yield* required(yield* Cache.getOption(flows, params.state))
						if (
							found.origin !== origin ||
							request.cookies[cookieName(origin, 'login')] !== params.state ||
							params.iss !== `${AUTH_URL}/api/auth`
						) {
							return yield* expired()
						}
						yield* Cache.invalidate(flows, params.state)
						return found
					})
				)
				const credentials = yield* token(flow.clientId, {
					code: params.code,
					code_verifier: flow.verifier,
					grant_type: 'authorization_code',
					redirect_uri: `${origin}/auth/callback`
				})
				const id = yield* mint
				yield* Cache.set(sessions, id, {
					credentials: yield* Ref.make(credentials),
					gate: yield* Semaphore.make(1),
					origin
				})
				return pipe(
					HttpServerResponse.redirect(flow.next),
					HttpServerResponse.expireCookieUnsafe(cookieName(origin, 'login'), COOKIE),
					HttpServerResponse.setCookieUnsafe(cookieName(origin, 'session'), id, {...COOKIE, maxAge: '8 hours'})
				)
			})
		)
	)

	yield* router.add(
		'POST',
		'/auth/sign-out',
		route(
			Effect.gen(function* () {
				const request = yield* HttpServerRequest.HttpServerRequest
				const origin = yield* required(address(request.headers))
				if (request.headers['origin'] !== origin) return yield* expired()
				const id = request.cookies[cookieName(origin, 'session')] ?? ''
				const session = yield* Cache.getOption(sessions, id)
				yield* Cache.invalidate(sessions, id)
				if (Option.isSome(session)) {
					const stored = Option.getOrThrow(session)
					yield* stored.gate.withPermit(
						Effect.gen(function* () {
							const credentials = yield* Ref.get(stored.credentials)
							yield* pipe(
								client.execute(
									HttpClientRequest.bodyUrlParams(HttpClientRequest.post(`${issuerUrl}/api/auth/oauth2/revoke`), {
										client_id: credentials.clientId,
										token: credentials.refreshToken
									})
								),
								Effect.timeout('10 seconds')
							)
						})
					)
				}
				return HttpServerResponse.expireCookieUnsafe(HttpServerResponse.empty(), cookieName(origin, 'session'), COOKIE)
			})
		)
	)

	return Effect.fnUntraced(function* (headers: Headers.Headers) {
		const preview = address(headers)
		if (Option.isNone(preview)) return Option.none<string>()
		const origin = Option.getOrThrow(preview)
		if (Option.exists(Headers.get(headers, 'origin'), supplied => supplied !== origin)) return yield* expired()
		const id = Cookies.parseHeader(headers['cookie'] ?? '')[cookieName(origin, 'session')] ?? ''
		const session = yield* required(yield* Cache.getOption(sessions, id))
		if (session.origin !== origin) return yield* expired()
		return yield* session.gate.withPermit(
			Effect.uninterruptible(
				Effect.gen(function* () {
					const previous = yield* Ref.get(session.credentials)
					if (previous.expiresAt > (yield* Clock.currentTimeMillis) + 60_000) return Option.some(previous.accessToken)
					const fresh = yield* pipe(
						token(previous.clientId, {grant_type: 'refresh_token', refresh_token: previous.refreshToken}),
						Effect.catchIf(
							error =>
								HttpClientError.isHttpClientError(error) &&
								error.reason._tag === 'StatusCodeError' &&
								(error.reason.response.status === 400 || error.reason.response.status === 401),
							() => Effect.andThen(Cache.invalidate(sessions, id), Effect.fail(expired()))
						)
					)
					yield* Ref.set(session.credentials, fresh)
					return Option.some(fresh.accessToken)
				})
			)
		)
	})
})
