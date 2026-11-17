import {Effect, Exit, Function, Layer, Option, Predicate, Schema, String, pipe} from 'effect'

import {FetchHttpClient, HttpClient, HttpClientResponse} from 'effect/http'
import {AsyncResult, Atom} from 'effect/reactivity'
import {Socket} from 'effect/socket'
import {openAuthSessionAsync} from 'expo-web-browser'
import {Alert} from 'react-native'

import {layerSocketProtocol} from '#client/protocol.ts'
import {activationsAtom} from '#mobile/activations.ts'
import {appConfig} from '#mobile/app.ts'
import {keychain} from '#mobile/keychain.ts'
import {AuthError} from '#shared/auth.ts'
import {Account, RPC_PATH} from '#shared/schema.ts'
import {layerOtlp} from '#shared/telemetry.ts'

const DOMAIN = appConfig.extra.domain

// A Keychain that cannot be read now, as while the phone is locked, is read again later.
const headersEffect = Effect.try({
	catch: cause =>
		AuthError.make({cause, error: 'temporarily_unavailable', message: 'The Keychain could not read the session'}),
	try: keychain.headers
})

// Scope's public receiver takes traces and logs from anywhere; the version is the release running, a build's or an over-the-air update's.
Atom.runtime.addGlobalLayer(
	layerOtlp(`@deslop/${appConfig.slug}-ios`, `https://scope.${DOMAIN}`, 'mobile', appConfig.version)
)

// React Native's constructor declares a third parameter for handshake headers, which a browser's lacks and its typings omit.
function sendsHandshakeHeaders(
	constructor: unknown
): constructor is typeof WebSocket &
	(new (url: string, protocols?: string, options?: {headers: Record<string, string>}) => Socket.WebSocketLike) {
	return Predicate.isFunction(constructor) && constructor.length === 3
}

// Auth reads the session from the cookie in the handshake.
const layerSessionWebSocket = Layer.succeed(Socket.WebSocketConstructor, url => {
	if (!sendsHandshakeHeaders(WebSocket)) throw new TypeError('This WebSocket cannot send the session cookie')
	return new WebSocket(url, undefined, {headers: keychain.headers()})
})

// A device on the tailnet is named without signing in; any other signs in with GitHub at Auth in iOS's authentication sheet, which returns the session's secret on the app's own URL scheme to this app alone.
export function makeSession() {
	const server = `https://${appConfig.slug}.${DOMAIN}`
	const auth = `https://auth.${DOMAIN}`
	const name = String.capitalize(appConfig.slug)
	const sessionRuntime = Atom.runtime(FetchHttpClient.layer)
	const cachedAccountAtom = Atom.keepAlive(Atom.make(keychain.account()))

	const revalidationAtom = sessionRuntime.atom(get => {
		get(activationsAtom)
		return pipe(
			headersEffect,
			Effect.flatMap(headers => HttpClient.get(new URL('/api/account', server).href, {headers})),
			Effect.filterOrFail(
				response => response.status !== 401,
				() => AuthError.make({message: `Sign in to ${name}`})
			),
			Effect.filterOrFail(
				response => response.status !== 403,
				() => AuthError.make({error: 'access_denied', message: `${name} refused this account`})
			),
			Effect.flatMap(HttpClientResponse.filterStatusOk),
			Effect.flatMap(HttpClientResponse.schemaBodyJson(Account)),
			Effect.timeout('10 seconds'),
			// Anything but a refusal is an outage, which keeps the app retrying instead of asking to sign in.
			Effect.mapError(cause =>
				pipe(
					cause,
					Option.liftPredicate(Schema.is(AuthError)),
					Option.getOrElse(() =>
						AuthError.make({cause, error: 'temporarily_unavailable', message: 'The server could not be reached'})
					)
				)
			),
			Effect.tap(account =>
				Effect.gen(function* () {
					get.set(cachedAccountAtom, Option.some(account))
					yield* Effect.ignore(keychain.saveAccount(account), {log: 'Warn'})
				})
			),
			Effect.tapError(error =>
				Effect.gen(function* () {
					if (error.error === 'temporarily_unavailable') return
					get.set(cachedAccountAtom, Option.none())
					yield* Effect.ignore(keychain.clearAccount, {log: 'Warn'})
				})
			)
		)
	})

	// A confirmed account opens the app while the foreground check runs; only a refusal discards it.
	const accountAtom = Atom.make(get => {
		const revalidation = get(revalidationAtom)
		return Option.match(get(cachedAccountAtom), {
			onNone: () => {
				// Sign-out must not expose the previous successful check while its replacement runs.
				if (AsyncResult.isSuccess(revalidation)) return AsyncResult.initial<Account, AuthError>()
				return revalidation
			},
			onSome: account => AsyncResult.success<Account, AuthError>(account)
		})
	})
	// Revalidation preserves subscriptions unless availability or the account's identity changes.
	const availableAccountAtom = Atom.map(accountAtom, account =>
		Option.getOrUndefined(
			pipe(
				account,
				Option.liftPredicate(AsyncResult.isSuccess),
				Option.map(success => success.value.id)
			)
		)
	)

	const signInAtom = sessionRuntime.fn((_: void, get) =>
		pipe(
			Effect.gen(function* () {
				const result = yield* Effect.tryPromise({
					catch: cause => AuthError.make({cause, message: 'The sign-in sheet could not open'}),
					try: () =>
						openAuthSessionAsync(
							`${auth}/sign-in?${new URLSearchParams({app: appConfig.extra.scheme})}`,
							`${appConfig.extra.scheme}://signed-in`
						)
				})
				// Closing the sheet is a choice, not a failure.
				if (result.type !== 'success') return
				yield* keychain.write(
					yield* Schema.decodeUnknownEffect(Schema.NonEmptyString)(new URL(result.url).searchParams.get('session'))
				)
				get.refresh(revalidationAtom)
			}),
			Effect.mapError(cause => AuthError.make({cause, message: `Cannot sign in to ${name}`})),
			Effect.tapError(error => Effect.sync(() => Alert.alert('Not Signed In', error.message)))
		)
	)

	// Ends the session at Auth, which every app shares; an unreachable Auth still signs this app out, and a Keychain that keeps any of it says what stayed.
	const signOutAtom = sessionRuntime.fn((_: void, get) =>
		Effect.tapError(
			Effect.gen(function* () {
				const remote = yield* pipe(
					headersEffect,
					Effect.flatMap(headers => HttpClient.get(`${auth}/sign-out`, {headers})),
					Effect.flatMap(HttpClientResponse.filterStatusOk),
					Effect.timeout('10 seconds'),
					Effect.tapError(cause => Effect.logWarning('Auth did not confirm ending the session', cause)),
					Effect.exit
				)
				const remoteStatus = Exit.match(remote, {
					onFailure: Function.constant('Auth sign-out was not confirmed'),
					onSuccess: Function.constant('Auth ended the shared session')
				})
				yield* Effect.uninterruptible(
					Effect.gen(function* () {
						yield* Effect.mapError(keychain.clearSession, cause =>
							AuthError.make({cause, message: `${remoteStatus}; this app's saved session was not removed`})
						)
						get.set(cachedAccountAtom, Option.none())
						get.refresh(revalidationAtom)
						yield* Effect.mapError(keychain.clearAccount, cause =>
							AuthError.make({
								cause,
								message: `${remoteStatus}; this app signed out, but its saved account could not be removed`
							})
						)
					})
				)
			}),
			error => Effect.sync(() => Alert.alert('Sign Out Incomplete', error.message))
		)
	)

	return {
		account: accountAtom,
		// Even an unchanged cached account must restart sockets that iOS closed in the background.
		available: (get: Atom.AtomContext) => {
			get(activationsAtom)
			return get(availableAccountAtom) !== undefined
		},
		// What a request outside the RPC socket sends for Auth to name the caller.
		headers: headersEffect,
		protocol: layerSocketProtocol(
			String.replace(/^http/u, 'ws')(new URL(RPC_PATH, server).href),
			layerSessionWebSocket
		),
		runtime: sessionRuntime,
		server,
		signIn: signInAtom,
		signOut: signOutAtom
	}
}

// An action reads its client once, so a reconnect never runs its last write again.
export function provideRuntimeOnce<A, E, R, ER>(
	get: {result: <B, X>(atom: Atom.Atom<AsyncResult.AsyncResult<B, X>>) => Effect.Effect<B, X>},
	runtime: Atom.AtomRuntime<R, ER>,
	effect: Effect.Effect<A, E, R>
) {
	return Effect.flatMap(get.result(runtime), context => Effect.provideContext(effect, context))
}

export type Session = ReturnType<typeof makeSession>
