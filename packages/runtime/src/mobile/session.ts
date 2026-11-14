import {Effect, Function, Layer, Option, Schedule, Schema, Stream, String, pipe} from 'effect'

import {Machine} from '@typeonce/effect-machine'
import {AtomMachine} from '@typeonce/effect-machine/reactivity'
import {FetchHttpClient, HttpClient, HttpClientRequest, HttpClientResponse} from 'effect/http'
import {AsyncResult, Atom} from 'effect/reactivity'
import {AuthRequest, makeRedirectUri} from 'expo-auth-session'
import {Alert} from 'react-native'

import {reconnectOnDrop} from '#client/live-stream.ts'
import {layerSocketProtocol} from '#client/protocol.ts'
import {activationsAtom} from '#mobile/activations.ts'
import {appConfig} from '#mobile/app.ts'
import {
	AUTHORIZE_PATH,
	AUTH_URL,
	AuthError,
	ISSUER,
	SessionHandle,
	clientIdOf,
	layerRpcAuthClient,
	needsSignIn,
	asAuthError
} from '#shared/auth.ts'
import {Account, RPC_PATH} from '#shared/schema.ts'
import {layerOtlp} from '#shared/telemetry.ts'

type SessionJson = typeof SessionJson.Type
const SessionJson = Schema.fromJsonString(SessionHandle)

const applicationName = `@deslop/${appConfig.slug}`
const name = String.capitalize(appConfig.slug)

// Scope's public receiver takes traces and logs from anywhere; the version is the release running, a build's or an over-the-air update's.
Atom.runtime.addGlobalLayer(
	layerOtlp(`${applicationName}-ios`, 'https://scope.mp281x.xyz', 'mobile', appConfig.version)
)

// An empty text means signed out.
export type SessionStorage = {
	clear: Effect.Effect<void, AuthError>
	read: Effect.Effect<string, AuthError>
	write: (text: string) => Effect.Effect<void, AuthError>
}

export function makeSession(server: string, storage: SessionStorage) {
	const sessionRuntime = Atom.runtime(FetchHttpClient.layer)

	// Unreadable JSON signs out rather than failing every launch.
	const read = Effect.map(storage.read, text =>
		pipe(text, Option.liftPredicate(String.isNonEmpty), Option.flatMap(Schema.decodeUnknownOption(SessionJson)))
	)

	// The session id is the bearer of every request to the server; a missing one asks to sign in, while a Keychain that cannot be read yet is read again later.
	const bearer = pipe(
		read,
		Effect.mapError(cause => AuthError.make({cause, error: 'temporarily_unavailable', message: cause.message})),
		Effect.flatMap(Effect.fromOption),
		Effect.map(saved => saved.session),
		asAuthError(`Sign in to ${name}`)
	)

	const signIn = pipe(
		Effect.gen(function* () {
			const redirectUri = makeRedirectUri({path: 'auth/callback', scheme: appConfig.extra.scheme})
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
	const machine = AtomMachine.bind(sessionRuntime).make(
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
				// fallow-ignore-next-line code-duplication -- Boot and resumed session states repeat the machine transition shape, not a second workflow.
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

	const accountAtom = sessionRuntime.atom(get => {
		get(signedIn)
		get(activationsAtom)
		return pipe(
			bearer,
			Effect.flatMap(id =>
				HttpClient.get(new URL('/api/account', server).href, {headers: {authorization: `Bearer ${id}`}})
			),
			Effect.flatMap(HttpClientResponse.schemaBodyJson(Account)),
			Effect.timeout('10 seconds')
		)
	})

	return {
		account: accountAtom,
		bearer,
		machine,
		protocol: pipe(
			layerSocketProtocol(String.replace(/^http/u, 'ws')(new URL(RPC_PATH, server).href)),
			Layer.provideMerge(layerRpcAuthClient(bearer)),
			Layer.provide(FetchHttpClient.layer)
		),
		// An outage reopens a live stream; a session the server refused signs the app out.
		reconnectOrSignOut: <A, E, R>(live: Stream.Stream<A, E, R>) =>
			reconnectOnDrop(
				Stream.tapError(live, error =>
					Effect.ignore(
						Effect.gen(function* () {
							if (!needsSignIn(error)) return
							yield* storage.clear
							yield* Atom.set(machine.send, {_tag: 'Changed'})
						}),
						{log: 'Warn', message: 'The refused session could not be cleared'}
					)
				)
			),
		runtime: sessionRuntime,
		// Reading it also starts the caller over on each return from the background, when iOS has closed its sockets.
		signedIn: (get: Atom.AtomContext) => {
			get(activationsAtom)
			return AsyncResult.getOrElse(get(signedIn), Function.constFalse)
		}
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
