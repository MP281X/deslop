import {Clock, Effect, Match, Option, Predicate, Schema, Stream, String, pipe} from 'effect'

import {startAuthentication, startRegistration} from '@simplewebauthn/browser'
import {Machine} from '@typeonce/effect-machine'
import {AtomMachine} from '@typeonce/effect-machine/reactivity'
import {FetchHttpClient, HttpClient, HttpClientRequest, HttpClientResponse} from 'effect/http'
import {Atom, AtomRpc} from 'effect/reactivity'

import {AuthError} from '@deslop/runtime/auth/schema'
import {AUTH_URL} from '@deslop/runtime/auth/utils'
import * as WebRuntime from '@deslop/runtime/web'

import {RpcContracts} from '#rpcs/contracts.ts'
import {PasskeySignIn, Registration, RequestOptions} from '#services/passkeys/schema.ts'
import type {SignedAccount} from '#services/people/schema.ts'
import {CODE_LENGTH, typedCode} from '#services/sign-ins/lib/utils.ts'
import {PendingAuthorization} from '#services/sign-ins/schema.ts'
import {returnable} from '#services/tokens/lib/utils.ts'

const authRuntime = Atom.runtime(FetchHttpClient.layer)

export type Search = typeof Search.Type
export const Search = Schema.Struct({
	code: Schema.optionalKey(Schema.String),
	error: Schema.optionalKey(Schema.String),
	next: Schema.optionalKey(Schema.String),
	request: Schema.optionalKey(Schema.String),
	'sign-out': Schema.optionalKey(Schema.String)
})

class RpcClient extends AtomRpc.Service<RpcClient>()('@deslop/auth/lib/utils/RpcClient', {
	group: RpcContracts,
	protocol: WebRuntime.layer('@deslop/auth')
}) {}

// Live, so an account waiting for an admin moves on once allowed; a declined or removed account is signed out and reads None.
export const accountAtom = Atom.keepAlive(
	RpcClient.runtime.atom(
		pipe(
			RpcClient,
			Effect.map(client => client('auth.account', undefined)),
			Stream.unwrap,
			WebRuntime.reconnecting,
			Stream.map(Option.some),
			Stream.catchTag('AuthError', () => Stream.make(Option.none<SignedAccount>()))
		)
	)
)

const Answered = {accept: Schema.Boolean, request: PendingAuthorization}

// The code the waiting page shows, typed or opened from its link, proves the request is yours: RFC 8628's device flow.
export const codeAtom = AtomMachine.bind(RpcClient.runtime).make(
	Machine.make({
		branches: {looked: {found: {target: 'Code.Found'}, missing: {target: 'Code.Missing'}}},
		events: Machine.events({Answered, Typed: {typed: Schema.String}}),
		root: Machine.state({
			states: {
				// A full code reads its sign-in live, so a request answered elsewhere or expired leaves the list.
				Code: {
					fields: {code: Schema.String},
					states: {
						// The lookup itself failed, which says nothing about the code.
						Failed: {fields: {message: Schema.String}},
						Found: {fields: {request: PendingAuthorization}},
						Looking: {},
						Missing: {}
					}
				},
				Typing: {fields: {answered: Schema.optionalKey(Schema.Struct(Answered)), typed: Schema.String}}
			}
		}),
		streams: {
			lookup: (code: string) =>
				WebRuntime.reconnecting(Stream.unwrap(Effect.map(RpcClient, client => client('auth.lookup', {code}))))
		}
	}).handle({
		initial: {data: {typed: ''}, target: 'Typing'},
		on: {
			Answered: {
				data: transition => ({
					answered: {accept: transition.event.accept, request: transition.event.request},
					typed: ''
				}),
				target: 'Typing'
			},
			Typed: {data: transition => ({typed: transition.event.typed}), target: 'Typing'}
		},
		states: {
			Code: {
				initial: {target: 'Code.Looking'},
				invoke: {
					input: transition => transition.state.code,
					onDone: {none: true},
					onElement: {
						branches: 'looked',
						resolve: transition =>
							Option.match(transition.element, {
								onNone: () => transition.select.missing(),
								onSome: request => transition.select.found({data: {request}})
							})
					},
					onFailure: {data: transition => ({message: transition.error.message}), target: 'Code.Failed'},
					src: 'lookup'
				},
				states: {Failed: {}, Found: {}, Looking: {}, Missing: {}}
			},
			Typing: {
				always: {
					data: transition => ({code: transition.state.typed}),
					guard: transition => String.length(transition.state.typed) >= CODE_LENGTH,
					target: 'Code'
				}
			}
		}
	})
)

// Read each time the approve page opens, so returning to it from People does not bring back an answered code.
export const linkedCodeAtom = Atom.family((code: string) =>
	Atom.make(get => {
		get.set(codeAtom.send, {_tag: 'Typed', typed: typedCode(code)})
	})
)

export const peopleAtom = Atom.keepAlive(
	RpcClient.runtime.atom(get =>
		WebRuntime.live(
			get,
			pipe(
				RpcClient,
				Effect.map(client => client('auth.people', undefined)),
				Stream.unwrap
			)
		)
	)
)

// Live, so a new sign-in, each refresh and a disconnect from another page show here.
export const appsAtom = Atom.keepAlive(
	RpcClient.runtime.atom(get =>
		WebRuntime.live(
			get,
			pipe(
				RpcClient,
				Effect.map(client => client('auth.apps', undefined)),
				Stream.unwrap
			)
		)
	)
)

// One per person, so a failed answer shows beneath that person's row.
export const admitAtom = Atom.family((id: string) =>
	RpcClient.runtime.fn((allow: boolean) => Effect.flatMap(RpcClient, client => client('auth.admit', {allow, id})))
)

export const requestAtom = Atom.family((request: string) =>
	RpcClient.runtime.atom(
		pipe(
			RpcClient,
			Effect.map(client => client('auth.wait', {request})),
			Stream.unwrap,
			WebRuntime.reconnecting,
			Stream.tap(status =>
				pipe(
					Match.value(status),
					Match.tag('Decided', () =>
						Effect.sync(() => location.assign(`/auth/continue?${new URLSearchParams({request})}`))
					),
					Match.orElse(() => Effect.void)
				)
			)
		)
	)
)

// WDJBMJHT reads WDJB-MJHT.
export function requestCode(id: string) {
	return `${String.slice(0, 4)(id)}-${String.slice(4)(id)}`
}

// The link RFC 8628 calls verification_uri_complete: it opens the approve page with the code filled in.
export function approveLink(id: string) {
	return `${location.origin}/?code=${id}`
}

// Live, so an app shows once its server announces itself to Auth.
export const catalogAtom = Atom.keepAlive(
	RpcClient.runtime.atom(get =>
		WebRuntime.live(
			get,
			pipe(
				RpcClient,
				Effect.map(client => client('auth.catalog', undefined)),
				Stream.unwrap
			)
		)
	)
)

// The time once a minute, so "4m" labels keep counting on an idle page.
export const minuteAtom = Atom.make(
	pipe(
		Stream.tick('1 minute'),
		Stream.mapEffect(() => Clock.currentTimeMillis)
	)
)

// The time each second, for a waiting sign-in's countdown.
export const secondAtom = Atom.make(
	pipe(
		Stream.tick('1 second'),
		Stream.mapEffect(() => Clock.currentTimeMillis)
	)
)

// Copies the code; the result waits a moment after, while the code shows it was copied.
export const copyCodeAtom = Atom.fn((code: string) =>
	pipe(
		Effect.tryPromise({
			catch: cause => AuthError.make({cause, message: 'Cannot copy the code; type it in instead'}),
			try: () => navigator.clipboard.writeText(code)
		}),
		Effect.andThen(Effect.sleep('1200 millis'))
	)
)

// A sign-in as the lists name it: the app or browser, then where it runs.
export function signInLabel(client: string, device: string) {
	return `${client} · ${device}`
}

export const consentAtom = RpcClient.runtime.fn((input: {accept: boolean; request: PendingAuthorization}, get) =>
	pipe(
		RpcClient,
		Effect.flatMap(client => client('auth.answer', {accept: input.accept, request: input.request.id})),
		Effect.andThen(Effect.sync(() => get.set(codeAtom.send, {_tag: 'Answered', ...input})))
	)
)

// Closing the browser's passkey dialog is a normal choice, so it ends the attempt quietly instead of as an error.
function cancelled(failure: AuthError) {
	return Predicate.hasProperty(failure.cause, 'name') && failure.cause.name === 'NotAllowedError'
}

// Auth answers a refused passkey with its reason, as its OAuth endpoints do; a rate limit asks to wait.
const refused = Effect.fnUntraced(function* (response: HttpClientResponse.HttpClientResponse) {
	if (response.status === 429) {
		return yield* AuthError.make({message: 'Too many tries; wait a minute and try again'})
	}
	return yield* AuthError.make({
		message: (yield* HttpClientResponse.schemaBodyJson(Schema.Struct({error_description: Schema.String}))(response))
			.error_description
	})
})

export const passkeySignInAtom = authRuntime.fn((next: Search['next']) =>
	pipe(
		Effect.gen(function* () {
			const client = yield* HttpClient.HttpClient
			const offered = yield* client.get('/auth/passkey')
			if (offered.status !== 200) return yield* refused(offered)
			const options = yield* HttpClientResponse.schemaBodyJson(RequestOptions)(offered)
			const response = yield* Effect.catchIf(
				Effect.tryPromise({
					catch: cause => AuthError.make({cause, message: 'No passkey was used'}),
					try: () => startAuthentication({optionsJSON: options})
				}),
				cancelled,
				() => Effect.interrupt
			)
			const answer = yield* pipe(
				HttpClientRequest.post('/auth/passkey'),
				HttpClientRequest.schemaBodyJson(PasskeySignIn)({
					...Option.match(Option.fromUndefinedOr(next), {onNone: () => ({}), onSome: page => ({next: page})}),
					response
				}),
				Effect.flatMap(request => client.execute(request)),
				Effect.flatMap(
					Effect.fnUntraced(function* (signedIn) {
						if (signedIn.status !== 200) return yield* refused(signedIn)
						return yield* HttpClientResponse.schemaBodyJson(Schema.Struct({next: Schema.optionalKey(Schema.String)}))(
							signedIn
						)
					})
				)
			)
			yield* Effect.sync(() =>
				Option.match(Option.fromUndefinedOr(answer.next), {
					onNone: () => location.reload(),
					onSome: page => location.assign(page)
				})
			)
		}),
		Effect.mapError(cause => {
			if (Schema.is(AuthError)(cause)) return cause
			return AuthError.make({cause, message: 'Cannot sign in with a passkey'})
		})
	)
)

export const passkeysAtom = Atom.keepAlive(
	RpcClient.runtime.atom(get =>
		WebRuntime.live(
			get,
			pipe(
				RpcClient,
				Effect.map(client => client('auth.passkeys', undefined)),
				Stream.unwrap
			)
		)
	)
)

// Kept alive, since the browser's passkey prompt outlives the menu that starts it.
export const addPasskeyAtom = Atom.keepAlive(
	RpcClient.runtime.fn(
		Effect.fnUntraced(function* () {
			const client = yield* RpcClient
			const options = yield* client('auth.passkeyOptions', undefined)
			const response = yield* pipe(
				Effect.tryPromise({
					catch: cause => AuthError.make({cause, message: 'No passkey was added'}),
					try: () => startRegistration({optionsJSON: options})
				}),
				Effect.catchIf(cancelled, () => Effect.interrupt),
				Effect.flatMap(Schema.decodeUnknownEffect(Registration))
			)
			yield* client('auth.addPasskey', {response})
		})
	)
)

// The tab remembers the passkey it went to GitHub for, so the page it lands on adds it.
export const ADDING_PASSKEY = 'adding-passkey'

// A code may have been approved for someone else's browser, so a code session signs in with GitHub first.
export const confirmForPasskeyAtom = Atom.fn(() =>
	Effect.try({
		catch: cause => AuthError.make({cause, message: 'Cannot start GitHub sign-in'}),
		try: () => {
			sessionStorage.setItem(ADDING_PASSKEY, 'true')
			location.assign('/auth/github')
		}
	})
)

export const signInAtom = Atom.fn(() =>
	Effect.try({
		catch: cause => AuthError.make({cause, message: 'Cannot start GitHub sign-in'}),
		try: () => location.assign(`/auth/github${location.search}`)
	})
)

export const codeSignInAtom = Atom.fn((next: Search['next']) =>
	Effect.try({
		catch: cause => AuthError.make({cause, message: 'Cannot start the sign-in'}),
		try: () =>
			location.assign(
				Option.match(Option.fromUndefinedOr(next), {
					onNone: () => '/auth/code',
					onSome: page => `/auth/code?${new URLSearchParams({next: page})}`
				})
			)
	})
)

function signOut(next: Search['next']) {
	return pipe(
		HttpClient.HttpClient.use(client => HttpClient.filterStatusOk(client).post('/auth/sign-out')),
		Effect.andThen(
			Effect.sync(() =>
				location.replace(
					pipe(
						Option.fromUndefinedOr(next),
						Option.filter(page => returnable(page, AUTH_URL)),
						Option.getOrElse(() => location.pathname)
					)
				)
			)
		),
		Effect.mapError(cause => AuthError.make({cause, message: `Cannot sign out: ${cause.message}`}))
	)
}

// From another app's Sign out, whose page says how it failed.
export const signOutAtom = authRuntime.fn(signOut)

// From the account menu, which shows a failure under its own item.
export const menuSignOutAtom = authRuntime.fn(signOut)
