import {Clock, Config, Effect, FileSystem, Option, Path, Redacted, Schedule, Schema, String, pipe} from 'effect'

import {HttpClient, HttpClientRequest, HttpClientResponse, UrlParams} from 'effect/http'

export const CLIENT = 'coding-standards'

export class JudgeError extends Schema.TaggedError<JudgeError>()('JudgeError', {message: Schema.String}) {}

export const origins = {auth: 'https://auth.mp281x.xyz', gateway: 'https://gateway.mp281x.xyz'}

type Session = typeof Session.Type
const Session = Schema.Struct({
	accessToken: Schema.RedactedFromValue(Schema.String),
	clientId: Schema.String,
	expiresAt: Schema.Finite,
	refreshToken: Schema.RedactedFromValue(Schema.String)
})
type Tokens = typeof Tokens.Type
const Tokens = Schema.Struct({access_token: Schema.String, expires_in: Schema.Finite, refresh_token: Schema.String})

type DeviceCode = typeof DeviceCode.Type
const DeviceCode = Schema.Struct({
	device_code: Schema.String,
	expires_in: Schema.Finite,
	interval: Schema.Finite,
	user_code: Schema.String,
	verification_uri_complete: Schema.String
})

// Why the token endpoint has no tokens yet (RFC 8628 §3.5).
type Refusal = typeof Refusal.Type
const Refusal = Schema.Struct({error: Schema.String})

class AuthorizationPendingError extends Schema.TaggedError<AuthorizationPendingError>()(
	'AuthorizationPendingError',
	{}
) {}

const sessionOf = Effect.fnUntraced(function* (tokens: Tokens, clientId: string) {
	return {
		accessToken: Redacted.make(tokens.access_token),
		clientId,
		expiresAt: (yield* Clock.currentTimeMillis) + tokens.expires_in * 1000,
		refreshToken: Redacted.make(tokens.refresh_token)
	}
})

export function failed(message: string) {
	return Effect.mapError(() => JudgeError.make({message}))
}

const sessionPaths = Effect.gen(function* () {
	const path = yield* Path.Path
	const directory = path.join(yield* Config.String('HOME'), '.deslop', 'coding-standards')
	return {directory, lock: path.join(directory, 'session.lock'), session: path.join(directory, 'session.json')}
})

// Every worktree's judge shares one session, and Auth revokes a sign-in whose refresh token is spent twice, so one process refreshes at a time.
const withSessionLock = Effect.fnUntraced(function* <A, E, R>(effect: Effect.Effect<A, E, R>) {
	const fs = yield* FileSystem.FileSystem
	const paths = yield* sessionPaths
	yield* fs.makeDirectory(paths.directory, {recursive: true})
	// A lock older than any refresh was left by a process that died holding it.
	const acquire = Effect.gen(function* () {
		const now = yield* Clock.currentTimeMillis
		if (
			Option.exists(yield* Effect.option(fs.stat(paths.lock)), metadata =>
				Option.exists(metadata.mtime, time => now - time.getTime() > 30_000)
			)
		) {
			yield* Effect.ignore(fs.remove(paths.lock, {recursive: true}), {
				log: 'Warn',
				message: 'A stale sign-in lock could not be removed'
			})
		}
		yield* fs.makeDirectory(paths.lock)
	})
	return yield* Effect.acquireUseRelease(
		failed('Another judge holds the sign-in; retry')(
			Effect.retry(acquire, {schedule: Schedule.spaced('100 millis'), times: 150})
		),
		() => effect,
		() =>
			Effect.ignore(fs.remove(paths.lock, {recursive: true}), {
				log: 'Warn',
				message: 'The sign-in lock could not be released'
			})
	)
})

const saveSession = Effect.fnUntraced(function* (session: Session) {
	const fs = yield* FileSystem.FileSystem
	const paths = yield* sessionPaths
	yield* fs.makeDirectory(paths.directory, {recursive: true})
	yield* fs.writeFileString(paths.session, yield* Schema.encodeEffect(Schema.fromJsonString(Session))(session), {
		mode: 0o600
	})
})

const exchange = Effect.fnUntraced(function* (params: Record<string, string>) {
	const client = yield* HttpClient.HttpClient
	return yield* sessionOf(
		yield* pipe(
			client.execute(
				HttpClientRequest.bodyUrlParams(
					HttpClientRequest.post(`${origins.auth}/api/auth/oauth2/token`),
					UrlParams.fromInput(params)
				)
			),
			Effect.flatMap(HttpClientResponse.filterStatusOk),
			Effect.flatMap(HttpClientResponse.schemaBodyJson(Tokens)),
			// Well inside the 30 seconds after which another run takes the lock, so two runs never spend one refresh token.
			Effect.timeout('10 seconds'),
			failed('Auth refused the sign-in; run `coding-standards sign-in` again')
		),
		params['client_id'] ?? ''
	)
})

// RFC 8628: Auth shows a code, a signed-in browser, phone or agent (Auth's `answer_request`) approves it, and the judge polls for its tokens.
export const signIn = Effect.gen(function* () {
	const client = yield* HttpClient.HttpClient
	const registered = yield* pipe(
		client.execute(
			yield* HttpClientRequest.bodyJson(HttpClientRequest.post(`${origins.auth}/api/auth/oauth2/register`), {
				client_name: CLIENT,
				// Auth registers clients by their callbacks; a device-code client never receives one.
				redirect_uris: ['http://127.0.0.1/callback']
			})
		),
		Effect.flatMap(HttpClientResponse.filterStatusOk),
		Effect.flatMap(HttpClientResponse.schemaBodyJson(Schema.Struct({client_id: Schema.String}))),
		failed('Auth refused to register the judge')
	)
	const device = yield* pipe(
		client.execute(
			HttpClientRequest.bodyUrlParams(
				HttpClientRequest.post(`${origins.auth}/api/auth/oauth2/device_authorization`),
				UrlParams.fromInput({client_id: registered.client_id})
			)
		),
		Effect.flatMap(HttpClientResponse.filterStatusOk),
		Effect.flatMap(HttpClientResponse.schemaBodyJson(DeviceCode)),
		failed('Auth did not start a sign-in')
	)
	yield* Effect.logInfo(
		`Approve sign-in ${String.slice(0, 4)(device.user_code)}-${String.slice(4)(device.user_code)} at ${device.verification_uri_complete}, or have the agent answer it with answer_request.`
	)
	const tokens = yield* pipe(
		client.execute(
			HttpClientRequest.bodyUrlParams(
				HttpClientRequest.post(`${origins.auth}/api/auth/oauth2/token`),
				UrlParams.fromInput({
					client_id: registered.client_id,
					device_code: device.device_code,
					grant_type: 'urn:ietf:params:oauth:grant-type:device_code'
				})
			)
		),
		Effect.flatMap(
			Effect.fnUntraced(function* (response: HttpClientResponse.HttpClientResponse) {
				if (response.status === 200) return yield* HttpClientResponse.schemaBodyJson(Tokens)(response)
				if ((yield* HttpClientResponse.schemaBodyJson(Refusal)(response)).error === 'authorization_pending') {
					return yield* AuthorizationPendingError.make({})
				}
				return yield* JudgeError.make({message: 'The sign-in was denied or expired'})
			})
		),
		Effect.retry({
			schedule: Schedule.spaced(`${device.interval} seconds`),
			while: Schema.is(AuthorizationPendingError)
		}),
		Effect.timeout(`${device.expires_in} seconds`),
		failed('The sign-in was denied or not approved in time; run `coding-standards sign-in` again')
	)
	yield* saveSession(yield* sessionOf(tokens, registered.client_id))
	yield* Effect.logInfo('Signed in to Gateway. The judge is parked; run it only when the user explicitly asks.')
})

// A fresh access token for Gateway, refreshed shortly before it expires.
export const accessToken = Effect.gen(function* () {
	const fs = yield* FileSystem.FileSystem
	const paths = yield* sessionPaths
	return yield* withSessionLock(
		Effect.gen(function* () {
			const session = yield* pipe(
				fs.readFileString(paths.session),
				Effect.flatMap(Schema.decodeEffect(Schema.fromJsonString(Session))),
				failed('Sign in once with `coding-standards sign-in`; the agent approves its code with answer_request')
			)
			if (session.expiresAt - 60_000 > (yield* Clock.currentTimeMillis)) return session.accessToken
			const next = yield* exchange({
				client_id: session.clientId,
				grant_type: 'refresh_token',
				refresh_token: Redacted.value(session.refreshToken)
			})
			yield* saveSession(next)
			return next.accessToken
		})
	)
})
