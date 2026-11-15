import {Effect, Layer, Option, Predicate, Schema, String, pipe} from 'effect'

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

	const accountAtom = sessionRuntime.atom(get => {
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
			)
		)
	})

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
				get.refresh(accountAtom)
			}),
			Effect.mapError(cause => AuthError.make({cause, message: `Cannot sign in to ${name}`})),
			Effect.tapError(error => Effect.sync(() => Alert.alert('Not Signed In', error.message)))
		)
	)

	// Ends the session at Auth, which every app shares; an unreachable Auth still signs this app out.
	const signOutAtom = sessionRuntime.fn((_: void, get) =>
		Effect.gen(function* () {
			yield* pipe(
				headersEffect,
				Effect.flatMap(headers => HttpClient.get(`${auth}/sign-out`, {headers})),
				Effect.timeout('10 seconds'),
				Effect.ignore({log: 'Warn', message: 'Auth did not end the session'})
			)
			yield* keychain.clear
			get.refresh(accountAtom)
		})
	)

	return {
		account: accountAtom,
		// Reading the account restarts live work on each return from the background, when iOS has closed its sockets.
		available: (get: Atom.AtomContext) => AsyncResult.isSuccess(get(accountAtom)),
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
