import {Effect, Exit, Function, Layer, MutableRef, Option, Predicate, String, pipe} from 'effect'

import {FetchHttpClient, HttpClient, HttpClientResponse} from 'effect/http'
import {AsyncResult, Atom, AtomRegistry} from 'effect/reactivity'
import {Socket} from 'effect/socket'
import {openAuthSessionAsync} from 'expo-web-browser'
import {Alert} from 'react-native'

import {readAccount} from '#client/account.ts'
import {layerSocketProtocol, writeOutcome} from '#client/protocol.ts'
import {activationsAtom} from '#mobile/activations.ts'
import {appConfig} from '#mobile/app.ts'
import {keychain} from '#mobile/keychain.ts'
import {AuthError, signedInSecret} from '#shared/auth.ts'
import type {Account} from '#shared/schema.ts'
import {RPC_PATH} from '#shared/schema.ts'
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

// Every reconnect reads the Keychain through the same guarded effect as HTTP.
function sessionSocket(url: string) {
	return Layer.effect(
		Socket.Socket,
		Socket.fromWebSocket(
			Effect.acquireRelease(
				pipe(
					headersEffect,
					Effect.flatMap(headers =>
						Effect.try({
							catch: cause =>
								AuthError.make({cause, error: 'temporarily_unavailable', message: 'The session socket could not open'}),
							try: () => {
								if (!sendsHandshakeHeaders(WebSocket)) {
									throw new TypeError('This WebSocket cannot send the session cookie')
								}
								return new WebSocket(url, undefined, {headers})
							}
						})
					),
					Effect.mapError(
						// oxlint-disable-next-line @deslop/coding-standards/recover-named-failures -- SocketError requires a reason; SocketOpenError preserves the original cause inside it.
						cause => Socket.SocketError.make({reason: Socket.SocketOpenError.make({cause, kind: 'Unknown'})})
					)
				),
				ws => Effect.sync(() => ws.close(1000))
			)
		)
	)
}

// HTTPS callbacks require Auth's association with this app, not a scheme another app can register.
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
			Effect.flatMap(headers => readAccount(server, headers)),
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

	// A cached account opens the app while the foreground check runs.
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

	// One sign-in at a time: iOS shows a single sheet, and a second press must not interrupt the first before its callback reaches the Keychain.
	const signingIn = MutableRef.make(false)
	function cannotSignIn(cause: unknown) {
		return AuthError.make({cause, message: `Cannot sign in to ${name}`})
	}
	const signInAtom = sessionRuntime.fn(
		(_: void) =>
			Effect.gen(function* () {
				if (MutableRef.getAndSet(signingIn, true)) return
				// The registry outlives the press: an ignored second press rebuilds this atom's context, and a refresh through that one does nothing.
				const registry = yield* AtomRegistry.AtomRegistry
				yield* pipe(
					Effect.gen(function* () {
						const result = yield* Effect.tryPromise({
							catch: cannotSignIn,
							try: () =>
								openAuthSessionAsync(
									`${auth}/sign-in?${new URLSearchParams({app: appConfig.slug})}`,
									`${auth}/signed-in/${appConfig.slug}`,
									{preferUniversalLinks: true}
								)
						})
						// Closing the sheet is a choice, not a failure.
						if (result.type !== 'success') return
						// Auth's reason for a failed sign-in is the alert's text.
						const secret = yield* Effect.catchTag(signedInSecret(result.url), 'SchemaError', cause =>
							Effect.fail(cannotSignIn(cause))
						)
						yield* Effect.mapError(keychain.write(secret), cannotSignIn)
						registry.refresh(revalidationAtom)
					}),
					Effect.tapError(error => Effect.sync(() => Alert.alert('Not Signed In', error.message))),
					Effect.uninterruptible,
					Effect.ensuring(Effect.sync(() => MutableRef.set(signingIn, false)))
				)
			}),
		{concurrent: true}
	)

	// Ends the session at Auth, which every app shares; an unreachable Auth still signs this app out, and the alert says what stayed: Auth's session or this app's saved copy.
	const signOutAtom = sessionRuntime.fn((_: void, get) =>
		Effect.tapError(
			Effect.gen(function* () {
				const remote = yield* pipe(
					headersEffect,
					Effect.flatMap(headers => HttpClient.post(`${auth}/sign-out`, {headers: {...headers, origin: auth}})),
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
				if (Exit.isFailure(remote)) {
					Alert.alert(
						'Signed Out on This iPhone',
						'Auth did not confirm ending the shared session, so other apps and browsers may still be signed in.'
					)
				}
			}),
			error => Effect.sync(() => Alert.alert('Sign Out Incomplete', error.message))
		)
	)

	return {
		account: accountAtom,
		// The admitted account's id; even an unchanged one restarts sockets that iOS closed in the background, and data the app keeps belongs to it alone.
		admitted: (get: Atom.AtomContext) => {
			get(activationsAtom)
			return Option.fromUndefinedOr(get(availableAccountAtom))
		},
		// What a request outside the RPC socket sends for Auth to name the caller.
		headers: headersEffect,
		protocol: layerSocketProtocol(sessionSocket(String.replace(/^http/u, 'ws')(new URL(RPC_PATH, server).href))),
		runtime: sessionRuntime,
		server,
		signIn: signInAtom,
		signOut: signOutAtom
	}
}

// An action reads its client once, so a reconnect never runs its last write again, and a write the transport lost says whether it may have taken effect.
export function provideRuntimeOnce<A, E, R, ER>(
	get: {result: <B, X>(atom: Atom.Atom<AsyncResult.AsyncResult<B, X>>) => Effect.Effect<B, X>},
	runtime: Atom.AtomRuntime<R, ER>,
	effect: Effect.Effect<A, E, R>
) {
	return Effect.flatMap(get.result(runtime), context => writeOutcome(Effect.provideContext(effect, context)))
}

export type Session = ReturnType<typeof makeSession>
