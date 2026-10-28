import type {Cause, Scope} from 'effect'
import {Clock, Effect, Fiber, Option, Schedule, Schema, Semaphore, Stream, String, pipe} from 'effect'

import {FetchHttpClient, HttpClient, HttpClientRequest, HttpClientResponse} from 'effect/http'
import {AsyncResult, Atom} from 'effect/reactivity'
import {AuthRequest, makeRedirectUri} from 'expo-auth-session'

import {AUTH_URL} from '#auth/lib/utils.ts'
import {AuthError, ClientRegistration, Credentials, TokenResponse} from '#auth/schema.ts'
import {TELEMETRY, activationsAtom, extra} from '#mobile/client.ts'

const DISCOVERY = {
	authorizationEndpoint: `${AUTH_URL}/api/auth/oauth2/authorize`,
	tokenEndpoint: `${AUTH_URL}/api/auth/oauth2/token`
}
type CredentialsJson = typeof CredentialsJson.Type
const CredentialsJson = Schema.fromJsonString(Credentials)

// Where an app keeps its credentials as JSON; an empty text means signed out.
export type Storage = {
	clear: Effect.Effect<void, Cause.UnknownError>
	// Held across a refresh by every process that shares the credentials, such as a share extension.
	lock?: Effect.Effect<void, Cause.UnknownError, Scope.Scope>
	read: Effect.Effect<string, Cause.UnknownError>
	write: (text: string) => Effect.Effect<void, Cause.UnknownError>
}

// The OAuth session of one iOS app against the auth server, with its access token for `server` and the telemetry.
export function make(name: string, server: string, storage: Storage) {
	const runtime = Atom.runtime(FetchHttpClient.layer)
	const refreshing = Semaphore.makeUnsafe(1)

	// Unreadable JSON signs out rather than failing every launch.
	const read = Effect.map(storage.read, text =>
		Option.flatMap(Option.liftPredicate(text, String.isNonEmpty), Schema.decodeUnknownOption(CredentialsJson))
	)

	// A locked Keychain is read again each second instead of reaching React as an error.
	const atom = Atom.keepAlive(runtime.atom(Effect.retry(read, Schedule.spaced('1 second'))))

	// The server revokes a family whose rotated refresh token comes back, so a refresh and its write outlive their callers.
	function exclusive<A, E>(effect: Effect.Effect<A, E, HttpClient.HttpClient>) {
		return Effect.flatMap(HttpClient.HttpClient, client =>
			pipe(
				Effect.scoped(Effect.andThen(storage.lock ?? Effect.void, effect)),
				Semaphore.withPermit(refreshing),
				Effect.provideService(HttpClient.HttpClient, client),
				Effect.forkDetach,
				Effect.flatMap(Fiber.join)
			)
		)
	}

	const tokenRequest = Effect.fnUntraced(function* (clientId: string, params: Record<string, string>) {
		const response = yield* pipe(
			(yield* HttpClient.HttpClient).execute(
				pipe(
					HttpClientRequest.post(DISCOVERY.tokenEndpoint),
					HttpClientRequest.bodyUrlParams({...params, client_id: clientId, resource: [server, TELEMETRY]})
				)
			),
			Effect.timeout('10 seconds')
		)
		if (response.status === 400 || response.status === 401) {
			yield* storage.clear
			return yield* AuthError.make({message: `Sign in to ${name} again`})
		}
		// Once the server answers, the refresh token it rotated exists only in this response, so nothing stops it being saved.
		return yield* Effect.uninterruptible(
			Effect.gen(function* () {
				const token = yield* HttpClientResponse.schemaBodyJson(TokenResponse)(response)
				yield* storage.write(
					yield* Schema.encodeEffect(CredentialsJson)({
						accessToken: token.access_token,
						clientId,
						expiresAt: (yield* Clock.currentTimeMillis) + token.expires_in * 1000,
						refreshToken: token.refresh_token
					})
				)
				return token.access_token
			})
		)
	})

	const fresh = Effect.gen(function* () {
		const now = yield* Clock.currentTimeMillis
		return Option.filter(yield* read, credentials => credentials.expiresAt > now + 60_000)
	})

	function sessionToken(refresh: boolean) {
		const renewed = exclusive(
			Effect.gen(function* () {
				const credentials = yield* Effect.fromOption(yield* read)
				if (!refresh && credentials.expiresAt > (yield* Clock.currentTimeMillis) + 60_000) {
					return credentials.accessToken
				}
				return yield* tokenRequest(credentials.clientId, {
					grant_type: 'refresh_token',
					refresh_token: credentials.refreshToken
				})
			})
		)
		return pipe(
			// A valid token needs no lock: the Keychain swaps whole entries, and a replaced access token stays valid until it expires.
			Effect.flatMap(fresh, current =>
				Option.match(
					Option.filter(current, () => !refresh),
					{onNone: () => renewed, onSome: credentials => Effect.succeed(credentials.accessToken)}
				)
			),
			Effect.mapError(cause => AuthError.make({cause, message: `Sign in to ${name}`}))
		)
	}

	const signIn = pipe(
		Effect.gen(function* () {
			const redirectUri = makeRedirectUri({path: 'auth/callback', scheme: extra.scheme})
			const client = yield* HttpClient.HttpClient
			const registration = yield* pipe(
				HttpClientRequest.post(`${AUTH_URL}/api/auth/oauth2/register`),
				HttpClientRequest.bodyJson({
					application_type: 'native',
					client_name: name,
					grant_types: ['authorization_code', 'refresh_token'],
					redirect_uris: [redirectUri],
					response_types: ['code'],
					token_endpoint_auth_method: 'none'
				}),
				Effect.flatMap(request => client.execute(request)),
				Effect.flatMap(HttpClientResponse.schemaBodyJson(ClientRegistration))
			)
			const request = new AuthRequest({
				clientId: registration.client_id,
				extraParams: {resource: server},
				redirectUri,
				scopes: ['deslop', 'offline_access']
			})
			const url = new URL(yield* Effect.tryPromise(() => request.makeAuthUrlAsync(DISCOVERY)))
			url.searchParams.append('resource', TELEMETRY)
			const result = yield* Effect.tryPromise(() => request.promptAsync(DISCOVERY, {url: url.href}))
			if (result.type !== 'success') return yield* AuthError.make({message: 'Sign-in was not completed'})
			if (result.params['iss'] !== `${AUTH_URL}/api/auth`) {
				return yield* AuthError.make({message: 'The sign-in issuer did not match'})
			}
			yield* exclusive(
				tokenRequest(registration.client_id, {
					code: result.params['code'] ?? '',
					code_verifier: request.codeVerifier ?? '',
					grant_type: 'authorization_code',
					redirect_uri: redirectUri
				})
			)
			yield* Atom.refresh(atom)
		}),
		Effect.mapError(cause => AuthError.make({cause, message: `Cannot sign in to ${name}`}))
	)

	return {
		accessToken: sessionToken(false),
		atom,
		// A refused stream renews the session before it opens again; only a refused refresh signs out.
		renewing: <A, E, R>(live: Stream.Stream<A, E, R>) =>
			pipe(
				live,
				Stream.tapError(error =>
					pipe(
						Effect.gen(function* () {
							if (Schema.is(AuthError)(error)) {
								yield* Effect.ignore(
									// @effect-diagnostics-next-line strictEffectProvide:off -- An app's RPC runtime exposes only its client, so the renewal brings its own fetch.
									Effect.provide(sessionToken(true), FetchHttpClient.layer),
									{log: 'Warn', message: 'The session could not be renewed'}
								)
							}
						}),
						Effect.andThen(read),
						Effect.flatMap(saved => Option.match(saved, {onNone: () => Atom.refresh(atom), onSome: () => Effect.void})),
						Effect.ignore({log: 'Warn', message: 'The session could not be read'})
					)
				),
				Stream.retry(Schedule.spaced('2 seconds'))
			),
		runtime,
		signIn,
		// Reading it also starts the caller over on each return from the background, when iOS has closed its sockets.
		signedIn: (get: Atom.AtomContext) => {
			const session = get(atom)
			get(activationsAtom)
			return AsyncResult.isSuccess(session) && Option.isSome(session.value)
		}
	}
}
