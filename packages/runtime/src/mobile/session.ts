import type {Scope} from 'effect'
import {Clock, Effect, Fiber, Option, Schedule, Schema, Semaphore, Stream, String, pipe} from 'effect'

import {Machine} from '@typeonce/effect-machine'
import {AtomMachine} from '@typeonce/effect-machine/reactivity'
import {FetchHttpClient, HttpClient, HttpClientRequest, HttpClientResponse} from 'effect/http'
import {AsyncResult, Atom} from 'effect/reactivity'
import {RpcClientError} from 'effect/rpc'
import {AuthRequest, makeRedirectUri} from 'expo-auth-session'
import {Alert} from 'react-native'

import {Account} from '#schema.ts'

import {ISSUER, needsSignIn, rejected} from '#auth/lib/utils.ts'
import {AuthError, ClientRegistration, Credentials, TokenResponse} from '#auth/schema.ts'
import {activationsAtom, extra} from '#mobile/client.ts'

const DISCOVERY = {authorizationEndpoint: `${ISSUER}/oauth2/authorize`, tokenEndpoint: `${ISSUER}/oauth2/token`}
type CredentialsJson = typeof CredentialsJson.Type
const CredentialsJson = Schema.fromJsonString(Credentials)

// Where an app keeps its credentials as JSON; an empty text means signed out.
export type Storage = {
	clear: Effect.Effect<void, AuthError>
	// Held across a refresh by every process that shares the credentials, such as a share extension.
	lock?: Effect.Effect<void, AuthError, Scope.Scope>
	read: Effect.Effect<string, AuthError>
	write: (text: string) => Effect.Effect<void, AuthError>
}

// The OAuth session of one iOS app against the auth server, with its access token for `server`.
export function make(name: string, server: string, storage: Storage) {
	const runtime = Atom.runtime(FetchHttpClient.layer)
	const refreshing = Semaphore.makeUnsafe(1)

	// Unreadable JSON signs out rather than failing every launch.
	const read = Effect.map(storage.read, text =>
		Option.flatMap(Option.liftPredicate(text, String.isNonEmpty), Schema.decodeUnknownOption(CredentialsJson))
	)

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
					HttpClientRequest.bodyUrlParams({...params, client_id: clientId, resource: server})
				)
			),
			Effect.timeout('10 seconds')
		)
		if (response.status === 400 || response.status === 401) {
			yield* storage.clear
			return yield* AuthError.make({message: `Sign in to ${name} again`})
		}
		// A proxy still waking after the phone resumes answers 5xx; that is an outage, not a refusal.
		if (HttpClient.isTransientResponse(response)) {
			return yield* AuthError.make({error: 'temporarily_unavailable', message: `Sign in to ${name}`})
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
			// A dead socket or timeout while the phone resumes is an outage; only a missing or refused credential asks to sign in.
			rejected(`Sign in to ${name}`)
		)
	}

	const signIn = pipe(
		Effect.gen(function* () {
			const redirectUri = makeRedirectUri({path: 'auth/callback', scheme: extra.scheme})
			const client = yield* HttpClient.HttpClient
			const registration = yield* pipe(
				HttpClientRequest.post(`${ISSUER}/oauth2/register`),
				HttpClientRequest.bodyJson({
					application_type: 'native',
					client_name: name,
					grant_types: ['authorization_code', 'refresh_token'],
					redirect_uris: [redirectUri],
					response_types: ['code'],
					token_endpoint_auth_method: 'none'
				}),
				Effect.flatMap(request => client.execute(request)),
				Effect.flatMap(HttpClientResponse.schemaBodyJson(ClientRegistration)),
				Effect.timeout('10 seconds')
			)
			const request = new AuthRequest({
				clientId: registration.client_id,
				extraParams: {resource: server},
				redirectUri,
				scopes: ['deslop', 'offline_access']
			})
			const result = yield* Effect.tryPromise({
				catch: cause => AuthError.make({cause, message: 'The sign-in sheet could not open'}),
				try: () => request.promptAsync(DISCOVERY)
			})
			if (result.type !== 'success') return yield* AuthError.make({message: 'Sign-in was not completed'})
			if (result.params['iss'] !== ISSUER) {
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
		}),
		Effect.mapError(cause => AuthError.make({cause, message: `Cannot sign in to ${name}`})),
		Effect.tapError(error => Effect.sync(() => Alert.alert('Not Signed In', error.message)))
	)

	// Ends this app's sign-in at Auth too, so its refresh token stops working; a failed revocation still signs the app out.
	const signOut = exclusive(
		Effect.gen(function* () {
			for (const credentials of Option.toArray(yield* read)) {
				yield* pipe(
					HttpClientRequest.post(`${ISSUER}/oauth2/revoke`),
					HttpClientRequest.bodyUrlParams({client_id: credentials.clientId, token: credentials.refreshToken}),
					request => Effect.flatMap(HttpClient.HttpClient, client => client.execute(request)),
					Effect.timeout('10 seconds'),
					Effect.ignore({log: 'Warn', message: 'Auth did not revoke the sign-in'})
				)
			}
			yield* storage.clear
		})
	)

	// The Keychain stays the truth, shared with a share extension; the machine knows only whether it holds a session.
	const machine = AtomMachine.bind(runtime).make(
		Machine.make({
			branches: {read: {signedIn: {target: 'SignedIn'}, signedOut: {target: 'SignedOut'}}},
			effects: {
				// A locked Keychain is read again each second instead of reaching React as an error.
				read: Effect.retry(read, Schedule.spaced('1 second')),
				signIn,
				signOut
			},
			events: Machine.events({Changed: {}, SignIn: {}, SignOut: {}}),
			root: Machine.state({
				states: {
					Reading: {},
					SignedIn: {states: {Checking: {}, Idle: {}}},
					SignedOut: {},
					SigningIn: {},
					SigningOut: {}
				}
			})
		}).handle({
			initial: {target: 'Reading'},
			states: {
				Reading: {
					invoke: {
						onDone: {
							branches: 'read',
							resolve: transition =>
								Option.match(transition.output, {
									onNone: () => transition.select.signedOut(),
									onSome: () => transition.select.signedIn()
								})
						},
						onFailure: {target: 'SignedOut'},
						src: 'read'
					}
				},
				// A check keeps the app on screen while it reads the Keychain again.
				SignedIn: {
					initial: {target: 'SignedIn.Idle'},
					on: {Changed: {target: 'SignedIn.Checking'}, SignOut: {target: 'SigningOut'}},
					states: {
						Checking: {
							invoke: {
								onDone: {
									branches: 'read',
									resolve: transition =>
										Option.match(transition.output, {
											onNone: () => transition.select.signedOut(),
											onSome: () => transition.select.signedIn()
										})
								},
								onFailure: {target: 'SignedIn.Idle'},
								src: 'read'
							}
						},
						Idle: {}
					}
				},
				SignedOut: {on: {SignIn: {target: 'SigningIn'}}},
				SigningIn: {invoke: {onDone: {target: 'SignedIn'}, onFailure: {target: 'SignedOut'}, src: 'signIn'}},
				SigningOut: {invoke: {onDone: {target: 'SignedOut'}, onFailure: {target: 'SignedIn'}, src: 'signOut'}}
			}
		})
	)
	const signedIn = AtomMachine.matches(machine, 'SignedIn')

	// Who is signed in, as the web app bar shows it: the app's server answers for its own bearer.
	const account = runtime.atom(get => {
		get(signedIn)
		get(activationsAtom)
		return pipe(
			sessionToken(false),
			Effect.flatMap(token =>
				HttpClient.get(new URL('/auth/user', server).href, {headers: {authorization: `Bearer ${token}`}})
			),
			Effect.flatMap(HttpClientResponse.schemaBodyJson(Account)),
			Effect.timeout('10 seconds')
		)
	})

	return {
		accessToken: sessionToken(false),
		account,
		machine,
		// A refused stream renews the session before it opens again; only a refused refresh signs out.
		renewing: <A, E, R>(live: Stream.Stream<A, E, R>) =>
			pipe(
				live,
				Stream.tapError(error =>
					pipe(
						Effect.gen(function* () {
							if (needsSignIn(error)) {
								yield* Effect.ignore(
									// oxlint-disable-next-line effecttsgo/strict-effect-provide -- An app's RPC runtime exposes only its client, so the renewal brings its own fetch.
									Effect.provide(sessionToken(true), FetchHttpClient.layer),
									{log: 'Warn', message: 'The session could not be renewed'}
								)
							}
						}),
						Effect.andThen(read),
						Effect.flatMap(saved =>
							Option.match(saved, {onNone: () => Atom.set(machine.send, {_tag: 'Changed'}), onSome: () => Effect.void})
						),
						Effect.ignore({log: 'Warn', message: 'The session could not be read'})
					)
				),
				Stream.retry($ =>
					pipe(
						$(Schedule.spaced('2 seconds')),
						Schedule.while(metadata => {
							if (Schema.is(AuthError)(metadata.input)) return metadata.input.error !== 'access_denied'
							return (
								Schema.is(RpcClientError.RpcClientError)(metadata.input) &&
								metadata.input.reason._tag !== 'RpcClientDefect'
							)
						})
					)
				)
			),
		runtime,
		// Reading it also starts the caller over on each return from the background, when iOS has closed its sockets.
		signedIn: (get: Atom.AtomContext) => {
			get(activationsAtom)
			return AsyncResult.getOrElse(get(signedIn), () => false)
		}
	}
}

export type Session = ReturnType<typeof make>['machine']
export type AppSession = ReturnType<typeof make>
