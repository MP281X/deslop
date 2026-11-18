import {Array, Context, Duration, Effect, Option, Predicate, Schedule, Schema, String, pipe} from 'effect'
import type {Brand} from 'effect'

import {HttpClient} from 'effect/http'
import {RpcMiddleware} from 'effect/rpc'

export class AuthError extends Schema.TaggedError<AuthError>()('AuthError', {
	cause: Schema.optional(Schema.Defect()),
	error: Schema.optionalKey(Schema.Literals(['access_denied', 'temporarily_unavailable'])),
	message: Schema.String
}) {
	// Scope reads a failure's exception type: an outage must not look like a refusal.
	override get name() {
		if (this.error === 'temporarily_unavailable') return 'AuthUnavailable'
		return 'AuthError'
	}
}

// `github:<id>` for a GitHub account, `tailnet:<login>` for a tailnet login from another identity provider.
export type UserId = typeof UserId.Type
export const UserId = pipe(Schema.NonEmptyString, Schema.brand('UserId'))

export function avatarUrlOf(id: UserId) {
	return Option.map(
		String.match(/^github:([1-9]\d*)$/u)(id),
		() => `https://avatars.githubusercontent.com/u/${String.slice('github:'.length)(id)}?s=96`
	)
}

export type GitHubId = typeof GitHubId.Type
export const GitHubId = pipe(Schema.Int, Schema.brand('GitHubId'))

export type GitHubIdFromString = typeof GitHubIdFromString.Type
export const GitHubIdFromString = pipe(Schema.FiniteFromString, Schema.decodeTo(GitHubId))

export type User = typeof User.Type
export const User = Schema.Struct({admin: Schema.Boolean, id: UserId, name: Schema.NonEmptyString})

export type Admin = User & Brand.Brand<'Admin'>

export class CurrentAdmin extends Context.Service<CurrentAdmin, Admin>()('@deslop/runtime/shared/auth/CurrentAdmin') {}

export class RpcAdmin extends RpcMiddleware.Service<RpcAdmin, {provides: CurrentAdmin}>()(
	'@deslop/runtime/shared/auth/RpcAdmin',
	{error: AuthError}
) {}

// The browser sign-in every `*.<domain>` app reads; tailnet callers need none.
export const SESSION_COOKIE = '__Secure-deslop-session'

// The client address the runtime derived from its proxy, replacing any value a caller sent.
export const CLIENT_HEADER = 'x-deslop-client'

// A Deslop app on Auth's machine acting for a person, as Gateway does for an agent and an app does for its AI calls.
export const ON_BEHALF_HEADER = 'x-deslop-user'

// Effect appends each frame's headers to the upgrade request's; this entry marks where a client's own begin.
export const FRAME_HEADERS = 'x-deslop-frame'

// The derived address and an app's on-behalf claim come only from the upgrade request the proxy and `clientAddress` checked.
export function upgradeOnlyHeaders(headers: readonly [string, string][]) {
	const start = Array.findFirstIndex(headers, entry => entry[0] === FRAME_HEADERS)
	return Array.filter(
		headers,
		(entry, index) =>
			Option.exists(start, boundary => index < boundary) ||
			!Array.contains([FRAME_HEADERS, CLIENT_HEADER, ON_BEHALF_HEADER], String.toLowerCase(entry[0]))
	)
}

export const IDENTIFY_PATH = '/api/identify'

// What an app forwards for Auth to name the caller.
export type IdentifyRequest = typeof IdentifyRequest.Type
export const IdentifyRequest = Schema.Struct({
	address: Schema.OptionFromOptionalKey(Schema.NonEmptyString),
	onBehalfOf: Schema.OptionFromOptionalKey(UserId),
	session: Schema.OptionFromOptionalKey(Schema.NonEmptyString)
})

export const DEVELOPER = {admin: true, id: UserId.make('github:0'), name: 'dev'} satisfies User

// The app's own route, which hands the browser to Auth and back.
export function signInUrl(next: string) {
	return `${new URL(next).origin}/auth/sign-in?${new URLSearchParams({next})}`
}

// Auth hands an iOS app the new session's secret, or tells it why the sign-in failed.
export const signedInSecret = Effect.fnUntraced(function* (url: string) {
	const params = new URL(url).searchParams
	const error = params.get('error')
	if (error !== null) return yield* AuthError.make({message: error})
	return yield* Schema.decodeUnknownEffect(Schema.NonEmptyString)(params.get('session'))
})

export function needsSignIn(error: unknown) {
	return Schema.is(AuthError)(error) && error.error === undefined
}

export function isDenied(error: unknown) {
	return Schema.is(AuthError)(error) && error.error !== 'temporarily_unavailable'
}

export function asAuthError(message: string) {
	return Effect.mapError(cause => {
		if (Schema.is(AuthError)(cause)) return cause
		if (Predicate.isTagged(cause, 'SqlError') || HttpClient.isTransientError(cause)) {
			return AuthError.make({cause, error: 'temporarily_unavailable', message})
		}
		return AuthError.make({cause, message})
	})
}

// Only an AuthError refuses a caller; a slow, failing or unreadable answer is an outage, which clients keep retrying.
export function outageUnlessRefused(message: string) {
	return <A, E, R>(answer: Effect.Effect<A, E, R>) =>
		pipe(
			answer,
			Effect.timeout('10 seconds'),
			Effect.mapError(cause => {
				if (Schema.is(AuthError)(cause)) return cause
				return AuthError.make({cause, error: 'temporarily_unavailable', message})
			})
		)
}

// An outage keeps clients retrying instead of looking like a permanent refusal.
export function failureOptions(error: unknown, status: number) {
	if (Schema.is(AuthError)(error) && error.error === 'temporarily_unavailable') {
		return {headers: {'retry-after': '5'}, status: 503}
	}
	if (Schema.is(AuthError)(error) && error.error === 'access_denied') return {status: 403}
	return {status}
}

const IDENTITY_RECHECK = Duration.minutes(5)
const IDENTITY_LEASE = Duration.minutes(15)

// Fails once Auth refuses the caller or names someone else, or stays unreachable until its last answer is fifteen minutes old.
export function recheckUser(current: Effect.Effect<User, AuthError>, found: User) {
	return pipe(
		current,
		Effect.retry({
			// The recheck delay already spent part of the lease, which runs from the last answer.
			schedule: Schedule.upTo(Schedule.spaced('5 seconds'), {
				duration: Duration.subtract(IDENTITY_LEASE, IDENTITY_RECHECK)
			}),
			while: error => error.error === 'temporarily_unavailable'
		}),
		Effect.delay(IDENTITY_RECHECK),
		Effect.filterOrFail(
			next => next.id === found.id && next.admin === found.admin && next.name === found.name,
			() => AuthError.make({error: 'access_denied', message: 'The account changed; reconnect the socket'})
		),
		Effect.forever
	)
}

export class CurrentUser extends Context.Service<CurrentUser, User>()('@deslop/runtime/shared/auth/CurrentUser') {}

export class RpcAuth extends RpcMiddleware.Service<RpcAuth, {provides: CurrentUser}>()(
	'@deslop/runtime/shared/auth/RpcAuth',
	{error: AuthError}
) {}
