import {Effect, Option, Schedule, Schema, Stream, String, pipe} from 'effect'

import {Machine} from '@typeonce/effect-machine'
import {AtomMachine} from '@typeonce/effect-machine/reactivity'
import {FetchHttpClient, HttpClient, HttpClientRequest, HttpClientResponse} from 'effect/http'
import {AsyncResult, Atom} from 'effect/reactivity'
import {RpcClientError} from 'effect/rpc'
import {AuthRequest, makeRedirectUri} from 'expo-auth-session'
import {Alert} from 'react-native'

import {Account} from '#schema.ts'

import {AUTHORIZE_PATH, AUTH_URL, ISSUER, clientIdOf, needsSignIn, rejected} from '#auth/lib/utils.ts'
import {AuthError, SessionHandle} from '#auth/schema.ts'
import {activationsAtom, extra} from '#mobile/client.ts'

type SessionJson = typeof SessionJson.Type
const SessionJson = Schema.fromJsonString(SessionHandle)

// Where an app keeps its session as JSON; an empty text means signed out.
export type Storage = {
	clear: Effect.Effect<void, AuthError>
	read: Effect.Effect<string, AuthError>
	write: (text: string) => Effect.Effect<void, AuthError>
}

// One iOS app's session on its own server, which holds the sign-in Auth issued and acts with it.
export function make(name: string, server: string, storage: Storage) {
	const runtime = Atom.runtime(FetchHttpClient.layer)

	// Unreadable JSON signs out rather than failing every launch.
	const read = Effect.map(storage.read, text =>
		Option.flatMap(Option.liftPredicate(text, String.isNonEmpty), Schema.decodeUnknownOption(SessionJson))
	)

	// The session id is the bearer of every request to the server; a missing one asks to sign in, while a Keychain that cannot be read yet is read again later.
	const bearer = pipe(
		read,
		Effect.mapError(cause => AuthError.make({cause, error: 'temporarily_unavailable', message: cause.message})),
		Effect.flatMap(Effect.fromOption),
		Effect.map(saved => saved.session),
		rejected(`Sign in to ${name}`)
	)

	const signIn = pipe(
		Effect.gen(function* () {
			const redirectUri = makeRedirectUri({path: 'auth/callback', scheme: extra.scheme})
			const request = new AuthRequest({
				clientId: clientIdOf({name, redirects: [redirectUri]}),
				redirectUri,
				scopes: ['deslop', 'offline_access']
			})
			const result = yield* Effect.tryPromise({
				catch: cause => AuthError.make({cause, message: 'The sign-in sheet could not open'}),
				try: () => request.promptAsync({authorizationEndpoint: `${AUTH_URL}${AUTHORIZE_PATH}`})
			})
			if (result.type !== 'success') return yield* AuthError.make({message: 'Sign-in was not completed'})
			if (result.params['iss'] !== ISSUER) {
				return yield* AuthError.make({message: 'The sign-in issuer did not match'})
			}
			// The server exchanges the code and keeps the tokens; the phone keeps only the session's id.
			const response = yield* pipe(
				HttpClientRequest.post(new URL('/auth/session', server).href),
				HttpClientRequest.bodyJson({
					client_id: request.clientId,
					code: result.params['code'] ?? '',
					code_verifier: request.codeVerifier ?? '',
					redirect_uri: redirectUri
				}),
				Effect.flatMap(body => Effect.flatMap(HttpClient.HttpClient, client => client.execute(body))),
				Effect.flatMap(HttpClientResponse.filterStatusOk),
				Effect.flatMap(HttpClientResponse.schemaBodyJson(SessionHandle)),
				Effect.timeout('10 seconds')
			)
			yield* storage.write(yield* Schema.encodeEffect(SessionJson)(response))
		}),
		Effect.mapError(cause => AuthError.make({cause, message: `Cannot sign in to ${name}`})),
		Effect.tapError(error => Effect.sync(() => Alert.alert('Not Signed In', error.message)))
	)

	// Ends the session on the server, which revokes its sign-in at Auth; an unreachable server still signs the app out.
	const signOut = Effect.gen(function* () {
		for (const saved of Option.toArray(yield* read)) {
			yield* pipe(
				HttpClientRequest.post(new URL('/auth/sign-out', server).href, {
					headers: {authorization: `Bearer ${saved.session}`}
				}),
				request => Effect.flatMap(HttpClient.HttpClient, client => client.execute(request)),
				Effect.timeout('10 seconds'),
				Effect.ignore({log: 'Warn', message: 'The server did not end the session'})
			)
		}
		yield* storage.clear
	})

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

	// Who is signed in, as the web app bar shows it: the app's server answers for its own session.
	const account = runtime.atom(get => {
		get(signedIn)
		get(activationsAtom)
		return pipe(
			bearer,
			Effect.flatMap(id =>
				HttpClient.get(new URL('/auth/user', server).href, {headers: {authorization: `Bearer ${id}`}})
			),
			Effect.flatMap(HttpClientResponse.schemaBodyJson(Account)),
			Effect.timeout('10 seconds')
		)
	})

	return {
		account,
		bearer,
		machine,
		// An outage reopens a live stream; a session the server refused signs the app out.
		reopening: <A, E, R>(live: Stream.Stream<A, E, R>) =>
			pipe(
				live,
				Stream.tapError(error =>
					Effect.ignore(
						Effect.gen(function* () {
							if (!needsSignIn(error)) return
							yield* storage.clear
							yield* Atom.set(machine.send, {_tag: 'Changed'})
						}),
						{log: 'Warn', message: 'The refused session could not be cleared'}
					)
				),
				Stream.retry($ =>
					pipe(
						$(Schedule.spaced('2 seconds')),
						Schedule.while(metadata => {
							if (Schema.is(AuthError)(metadata.input)) return metadata.input.error === 'temporarily_unavailable'
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
