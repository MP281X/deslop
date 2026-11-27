import type {Context} from 'effect'
import {Array, Effect, Equal, Layer, MutableHashSet, Record, Schema, Semaphore, String, pipe} from 'effect'

import {FetchHttpClient} from 'effect/http'
import {Socket} from 'effect/socket'

import {readAccount} from '#client/account.ts'
import {AuthError, SESSION_COOKIE} from '#shared/auth.ts'
import {RPC_PATH} from '#shared/schema.ts'

type Session = typeof Session.Type
const Session = Schema.String.check(Schema.isPattern(/^[\w-]{43}$/u))

export type IPhoneSessionStore = {
	clear: Effect.Effect<void, AuthError>
	read: Effect.Effect<string | null, AuthError>
	write: (secret: string) => Effect.Effect<void, AuthError>
}

export type IPhoneOrigins = {appOrigin: string; authOrigin: string; scheme: string}

export type AuthSessionResult = typeof AuthSessionResult.Type
const AuthSessionResult = Schema.Union([
	Schema.Struct({type: Schema.Literal('success'), url: Schema.String}),
	Schema.Struct({type: Schema.Literals(['cancel', 'dismiss', 'opened', 'locked'])})
])

export type OpenAuthSession = (
	start: string,
	callback: string,
	options: {preferUniversalLinks: boolean}
) => PromiseLike<AuthSessionResult>

export type IPhoneWebSocket = new (
	url: string,
	protocols: readonly string[],
	options: {headers: Record.ReadonlyRecord<string, string>}
) => Socket.WebSocketLike

function clearFailure(cause: unknown) {
	return AuthError.make({cause, error: 'temporarily_unavailable', message: 'Could not clear the session'})
}

export type SecureSessionIdentity = {accessGroup?: string; keychainService?: string}
export type SecureSessionOptions = SecureSessionIdentity & {keychainAccessible: number}

function readFailure(cause: unknown) {
	return AuthError.make({cause, error: 'temporarily_unavailable', message: 'Could not read the session'})
}

function signInFailure(cause: unknown) {
	return AuthError.make({cause, error: 'temporarily_unavailable', message: 'GitHub sign-in could not finish'})
}

export function secureSession(
	store: {
		getItemAsync: (key: string, options: SecureSessionOptions) => PromiseLike<string | null>
		setItemAsync: (key: string, secret: string, options: SecureSessionOptions) => PromiseLike<void>
		deleteItemAsync: (key: string, options: SecureSessionOptions) => PromiseLike<void>
	},
	keychainAccessible: number,
	key = 'auth.session',
	identity?: SecureSessionIdentity
) {
	const options = {...identity, keychainAccessible}
	return {
		clear: Effect.tryPromise({catch: clearFailure, try: () => store.deleteItemAsync(key, options)}),
		read: Effect.tryPromise({catch: readFailure, try: () => store.getItemAsync(key, options)}),
		write: Effect.fnUntraced(function* (secret: string) {
			yield* Effect.tryPromise({catch: signInFailure, try: () => store.setItemAsync(key, secret, options)})
		})
	}
}

export function nativeSession(store: {readSession: () => string | null; writeSession: (secret?: string) => void}) {
	return {
		clear: Effect.try({catch: clearFailure, try: () => store.writeSession()}),
		read: Effect.try({catch: readFailure, try: store.readSession}),
		write: Effect.fnUntraced(function* (secret: string) {
			yield* Effect.try({catch: signInFailure, try: () => store.writeSession(secret)})
		})
	}
}

function socketOpenError(cause: unknown) {
	return Socket.SocketError.make({reason: Socket.SocketOpenError.make({cause, kind: 'Unknown'})})
}

export function isSignOutConfirmed(status: number) {
	return status >= 200 && status < 400
}

export function iphoneSession(
	origins: IPhoneOrigins,
	store: IPhoneSessionStore,
	openAuthSession: OpenAuthSession,
	WebSocket: IPhoneWebSocket
) {
	const sockets = MutableHashSet.empty<Socket.WebSocketLike>()
	const credentials = Semaphore.makeUnsafe(1)

	function closeSocket(socket: Socket.WebSocketLike, code: number) {
		return Effect.ignoreCause(
			Effect.sync(() => {
				if (!MutableHashSet.has(sockets, socket)) return
				MutableHashSet.remove(sockets, socket)
				socket.close(code)
			}),
			{log: 'Warn', message: 'Could not close the iPhone RPC socket'}
		)
	}

	function headersFor(origin: string) {
		return Effect.map(store.read, value => {
			if (!String.startsWith('https://')(origin) || !Schema.is(Session)(value)) {
				return Record.empty<string, string>()
			}
			return {cookie: `${SESSION_COOKIE}=${value}`}
		})
	}

	const sessionHeaders = headersFor(origins.appOrigin)

	function readIPhoneAccount(fetch: Context.Service.Shape<typeof FetchHttpClient.Fetch>) {
		return pipe(
			sessionHeaders,
			Effect.flatMap(headers => readAccount(origins.appOrigin, headers)),
			Effect.provideService(FetchHttpClient.Fetch, fetch),
			Effect.provideService(FetchHttpClient.RequestInit, {credentials: 'omit', redirect: 'error'})
		)
	}

	const signOut = Effect.fnUntraced(function* (fetch: Context.Service.Shape<typeof FetchHttpClient.Fetch>) {
		const status = yield* pipe(
			Effect.gen(function* () {
				if (!String.startsWith('https://')(origins.authOrigin)) return 0
				const headers = yield* headersFor(origins.authOrigin)
				const response = yield* Effect.tryPromise({
					catch: cause => AuthError.make({cause, message: 'Auth did not confirm sign-out'}),
					try: signal =>
						fetch(`${origins.authOrigin}/sign-out`, {
							credentials: 'omit',
							headers: {...headers, origin: origins.authOrigin},
							method: 'POST',
							redirect: 'manual',
							signal
						})
				})
				return response.status
			}),
			Effect.timeout('10 seconds'),
			// An unreachable Auth must not leave this device signed in.
			Effect.catch(cause => Effect.as(Effect.logWarning('Auth did not confirm sign-out', cause), 0))
		)
		yield* credentials.withPermit(
			Effect.uninterruptible(
				Effect.flatMap(store.clear, () =>
					Effect.forEach(Array.fromIterable(sockets), socket => closeSocket(socket, 1001), {
						concurrency: 'unbounded',
						discard: true
					})
				)
			)
		)
		return status
	})

	const socketUrl = `${String.replace(/^http/u, 'ws')(origins.appOrigin)}${RPC_PATH}`
	const layerIPhoneSocket = Layer.effect(
		Socket.Socket,
		Socket.fromWebSocket(
			Effect.acquireRelease(
				credentials.withPermit(
					Effect.mapBoth(sessionHeaders, {
						// oxlint-disable-next-line @deslop/coding-standards/recover-named-failures -- SocketError carries the original cause inside its typed reason.
						onFailure: socketOpenError,
						onSuccess: headers => {
							const socket = Equal.byReferenceUnsafe(new WebSocket(socketUrl, [], {headers}))
							MutableHashSet.add(sockets, socket)
							return socket
						}
					})
				),
				socket => closeSocket(socket, 1000)
			)
		)
	)

	const callback = `${origins.authOrigin}/signed-in/${origins.scheme}`
	const start = `${origins.authOrigin}/sign-in?${new URLSearchParams({app: origins.scheme})}`
	// Accept the session only from Auth's own HTTPS result, never from an app deep link.
	const signIn = Effect.gen(function* () {
		if (!String.startsWith('https://')(origins.authOrigin)) return yield* signInFailure('Auth requires HTTPS')
		const result = yield* Effect.tryPromise({
			catch: signInFailure,
			try: () => openAuthSession(start, callback, {preferUniversalLinks: true})
		})
		if (result.type !== 'success') return false
		if (!String.startsWith(`${callback}?`)(result.url)) return yield* signInFailure('Unexpected Auth callback')
		const query = new URLSearchParams(String.slice(callback.length + 1)(result.url))
		const refusal = query.get('error')
		if (refusal !== null) return yield* AuthError.make({message: refusal})
		const secret = query.get('session')
		if (!Schema.is(Session)(secret)) return yield* signInFailure('Auth did not return a session')
		yield* store.write(secret)
		return true
	})

	return {layerIPhoneSocket, readIPhoneAccount, signIn, signOut}
}
