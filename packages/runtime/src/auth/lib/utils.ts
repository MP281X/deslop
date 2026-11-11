import {
	Array,
	Cause,
	Config,
	Context,
	Effect,
	Function,
	MutableRef,
	Option,
	Order,
	Predicate,
	Schema,
	Stream,
	String,
	pipe
} from 'effect'

import {Base64Url} from 'effect/encoding'
import {Headers, HttpClient} from 'effect/http'
import {AsyncResult} from 'effect/reactivity'
import type {Atom, AtomRegistry} from 'effect/reactivity'
import {RpcMiddleware} from 'effect/rpc'

import type {User} from '#auth/schema.ts'
import {AuthError, ClientInfo} from '#auth/schema.ts'

export const AUTH_URL = 'https://auth.mp281x.xyz'

export const ISSUER_PATH = '/api/auth'
export const ISSUER = `${AUTH_URL}${ISSUER_PATH}`

export const APPS_PATH = '/api/apps'

export const COOKIE = {httpOnly: true, path: '/', sameSite: 'lax', secure: true} as const

export const SESSION_COOKIE = '__Host-session'

export function matchingSessions<A extends {key: string; value: {user: User; expiresAt: number}}>(
	saved: Option.Option<A>[],
	userId: string
) {
	return Array.sort(
		Array.filter(Array.getSomes(saved), session => session.value.user.id === userId),
		Order.mapInput(Order.flip(Order.Number), (session: A) => session.value.expiresAt)
	)
}

// RFC 9110 auth schemes are case-insensitive and may be followed by more than one space.
export function bearerOf(headers: Headers.Headers) {
	return Option.flatMapNullishOr(
		String.match(/^bearer +(?<token>\S+) *$/iu)(headers['authorization'] ?? ''),
		found => found.groups?.['token']
	)
}

// An access token Auth signed, as opposed to a phone's session id, which it also sends as the bearer.
export function isJwt(token: string) {
	return Option.isSome(String.match(/^[\w-]+\.[\w-]+\.[\w-]+$/u)(token))
}

export const AUTHORIZE_PATH = `${ISSUER_PATH}/oauth2/authorize`
export const TOKEN_PATH = `${ISSUER_PATH}/oauth2/token`
export const REVOKE_PATH = `${ISSUER_PATH}/oauth2/revoke`
export const DEVICE_PATH = `${ISSUER_PATH}/oauth2/device_authorization`
export const JWKS_PATH = '/.well-known/jwks.json'

export const CALLBACK_PATH = '/auth/callback'

// An access token lives ten minutes, so a removed account or signed-out session stops working everywhere within that time.
export const ACCESS_SECONDS = 600

// A client id is its registration, encoded: anyone may register, and Auth checks the callbacks again at authorize.
export function clientIdOf(client: ClientInfo) {
	return Base64Url.encode(Schema.encodeSync(Schema.fromJsonString(ClientInfo))(client))
}

export const DEVELOPER = {id: 'github:0', name: 'dev'} satisfies User

// Without an issuer (`--auth`) there is no sign-in: every request is this trusted developer, and Auth's GitHub step signs it in at once.
export const localAuth = Config.map(Config.option(Config.String('AUTH_URL')), Option.isNone)

// Admins come from GITHUB_ADMINS; a local install with no issuer falls back to the developer account when none are named.
export const adminIds = Effect.gen(function* () {
	const listed = Config.Array(Schema.String, 'GITHUB_ADMINS')
	if (yield* localAuth) return yield* Config.withDefault(listed, ['0'])
	return yield* listed
})

// GITHUB_ADMINS lists bare GitHub ids; a user's id carries its provider as a prefix.
export function isAdmin(admins: readonly string[], id: string) {
	return Array.contains(admins, String.replace('github:', '')(id))
}

export function requireAdmin(admins: readonly string[], user: User, message: string) {
	if (isAdmin(admins, user.id)) return Effect.void
	return Effect.fail(AuthError.make({error: 'access_denied', message}))
}

export function signInUrl(next: string) {
	return `${new URL(next).origin}/auth/sign-in?${new URLSearchParams({next})}`
}

export function needsSignIn(error: unknown) {
	return Schema.is(AuthError)(error) && error.error !== 'temporarily_unavailable' && error.error !== 'access_denied'
}

export function isDenied(error: unknown) {
	return Schema.is(AuthError)(error) && error.error !== 'temporarily_unavailable'
}

export function rejected(message: string) {
	return Effect.mapError(cause => {
		if (Schema.is(AuthError)(cause)) return cause
		if (Predicate.isTagged(cause, 'KeyValueStoreError') || HttpClient.isTransientError(cause)) {
			return AuthError.make({cause, error: 'temporarily_unavailable', message})
		}
		return AuthError.make({cause, message})
	})
}

// An outage keeps credentials and retries alive instead of looking like a permanent refusal.
export function failureOptions(error: unknown, status: number) {
	if (Schema.is(AuthError)(error) && error.error === 'temporarily_unavailable') {
		return {headers: {'retry-after': '5'}, status: 503}
	}
	return {status}
}

export class CurrentUser extends Context.Service<CurrentUser, User>()('@deslop/runtime/auth/lib/utils/CurrentUser') {}

export class RpcAuth extends RpcMiddleware.Service<RpcAuth, {provides: CurrentUser}>()(
	'@deslop/runtime/auth/lib/utils/RpcAuth',
	{error: AuthError}
) {}

export function layerRpcAuthClient<R>(token: Effect.Effect<string, AuthError, R>) {
	return RpcMiddleware.layerClient(RpcAuth, options =>
		Effect.gen(function* () {
			return yield* options.next({
				...options.request,
				headers: Headers.set(options.request.headers, 'authorization', `Bearer ${yield* token}`)
			})
		})
	)
}

// Observe the read before recovery can swallow its refusal, since only a real emission restores authorization.
export function withoutDeniedData<A, E, R>(
	get: Atom.AtomContext,
	live: Stream.Stream<A, E, R>,
	recover: (stream: Stream.Stream<A, E, R>) => Stream.Stream<A, E, R | AtomRegistry.AtomRegistry> = Function.identity
) {
	function denials(cause: Cause.Cause<E>) {
		const reasons = Array.filter(cause.reasons, reason => Cause.isFailReason(reason) && isDenied(reason.error))
		if (Array.isArrayEmpty(reasons)) return Option.none()
		return Option.some(Cause.fromReasons(reasons))
	}
	const denied = MutableRef.make(
		pipe(
			get.self<AsyncResult.AsyncResult<A, E>>(),
			Option.filter(AsyncResult.isFailure),
			Option.flatMap(result => denials(result.cause))
		)
	)
	function gated(cause: Cause.Cause<E>) {
		return Option.match(MutableRef.get(denied), {
			onNone: () => cause,
			onSome: refusal =>
				Cause.fromReasons([
					...refusal.reasons,
					...Array.filter(cause.reasons, reason => !Cause.isFailReason(reason) || !isDenied(reason.error))
				])
		})
	}
	// A dropped socket, as after a hidden tab or a suspended app, usually heals on the first retry; only a second miss in a row is an outage worth showing.
	const misses = MutableRef.make(0)
	const observed = pipe(
		live,
		Stream.tapCause(cause =>
			Effect.sync(() => {
				MutableRef.update(denied, previous => Option.orElse(denials(cause), () => previous))
				const failure = gated(cause)
				if (Option.isSome(MutableRef.get(denied))) {
					get.setSelf(AsyncResult.failure(failure))
					return
				}
				if (MutableRef.incrementAndGet(misses) < 2) return
				get.setSelf(AsyncResult.failureWithPrevious(failure, {previous: get.self<AsyncResult.AsyncResult<A, E>>()}))
			})
		)
	)
	return pipe(
		recover(observed),
		Stream.tap(() =>
			Effect.sync(() => {
				MutableRef.set(denied, Option.none())
				MutableRef.set(misses, 0)
			})
		),
		Stream.catchCause(cause => Stream.failCause(gated(cause))),
		Stream.concat(
			Stream.suspend(() => Option.match(MutableRef.get(denied), {onNone: () => Stream.empty, onSome: Stream.failCause}))
		)
	)
}
