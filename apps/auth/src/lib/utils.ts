import {
	Array,
	Clock,
	DateTime,
	Duration,
	Effect,
	Match,
	Number,
	Option,
	Predicate,
	Schedule,
	Schema,
	Stream,
	String,
	pipe
} from 'effect'

import {startAuthentication, startRegistration} from '@simplewebauthn/browser'
import {Machine} from '@typeonce/effect-machine'
import {AtomMachine} from '@typeonce/effect-machine/reactivity'
import {FetchHttpClient, HttpClient, HttpClientRequest, HttpClientResponse} from 'effect/http'
import {Atom, AtomRpc} from 'effect/reactivity'

import {toast} from '@deslop/components-web/ui/toast'
import {AuthError} from '@deslop/runtime/auth/schema'
import {AUTH_URL} from '@deslop/runtime/auth/utils'
import * as WebRuntime from '@deslop/runtime/web'

import {RpcContracts} from '#rpcs/contracts.ts'
import {PasskeySignIn, Registration, RequestOptions} from '#services/passkeys/schema.ts'
import type {AdmitParams, SignedAccount} from '#services/people/schema.ts'
import {CODE_LENGTH, typedCode} from '#services/sign-ins/lib/utils.ts'
import {PendingAuthorization} from '#services/sign-ins/schema.ts'
import {returnable} from '#services/tokens/lib/utils.ts'
import type {SignedInApp} from '#services/tokens/schema.ts'

const authRuntime = Atom.runtime(FetchHttpClient.layer)

class RpcClient extends AtomRpc.Service<RpcClient>()('@deslop/auth/lib/utils/RpcClient', {
	group: RpcContracts,
	protocol: WebRuntime.layer('@deslop/auth')
}) {}

// A watch opens again after the socket drops; its other failures reach the screen.
function reconnecting<A, E extends {_tag: string}, R>(stream: Stream.Stream<A, E, R>) {
	return Stream.retry(stream, $ =>
		pipe(
			$(Schedule.spaced('1 second')),
			Schedule.while(metadata => metadata.input._tag === 'RpcClientError')
		)
	)
}

// Live, so an account waiting for an admin moves on once allowed; a declined or removed account is signed out and reads None.
export const accountAtom = Atom.keepAlive(
	RpcClient.runtime.atom(
		pipe(
			RpcClient,
			Effect.map(client => client('auth.account', undefined)),
			Stream.unwrap,
			reconnecting,
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
					states: {Found: {fields: {request: PendingAuthorization}}, Looking: {}, Missing: {}}
				},
				// The last answer stays as one line under an empty code, ready for the next sign-in.
				Typing: {fields: {answered: Schema.optionalKey(Schema.Struct(Answered)), typed: Schema.String}}
			}
		}),
		streams: {
			lookup: (code: string) =>
				reconnecting(Stream.unwrap(Effect.map(RpcClient, client => client('auth.lookup', {code}))))
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
					onFailure: {target: 'Code.Missing'},
					src: 'lookup'
				},
				states: {Found: {}, Looking: {}, Missing: {}}
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
export const linkedCodeAtom = Atom.make(get => {
	get.set(codeAtom.send, {_tag: 'Typed', typed: typedCode(new URLSearchParams(location.search).get('code') ?? '')})
})

export const peopleAtom = Atom.keepAlive(
	RpcClient.runtime.atom(
		pipe(
			RpcClient,
			Effect.map(client => client('auth.people', undefined)),
			Stream.unwrap,
			reconnecting
		)
	)
)

// Live, so a new sign-in, each refresh and a disconnect from another page show here.
export const appsAtom = Atom.keepAlive(
	RpcClient.runtime.atom(
		pipe(
			RpcClient,
			Effect.map(client => client('auth.apps', undefined)),
			Stream.unwrap,
			reconnecting
		)
	)
)

// One column holds every sign-in of a client on one device; signing it out ends them all.
export const disconnectAtom = RpcClient.runtime.fn((families: string[]) =>
	Effect.flatMap(RpcClient, client =>
		Effect.forEach(families, family => client('auth.disconnect', {family}), {concurrency: 'unbounded', discard: true})
	)
)

export const admitAtom = RpcClient.runtime.fn((input: AdmitParams) =>
	Effect.flatMap(RpcClient, client => client('auth.admit', input))
)

export const removeAtom = RpcClient.runtime.fn((id: string) =>
	Effect.flatMap(RpcClient, client => client('auth.remove', {id}))
)

export const requestId = Option.fromNullishOr(new URLSearchParams(location.search).get('request'))

// Once answered, the page continues where the answer is delivered: the app's callback, or this browser's session.
export const requestAtom = Atom.family((request: string) =>
	RpcClient.runtime.atom(
		pipe(
			RpcClient,
			Effect.map(client => client('auth.wait', {request})),
			Stream.unwrap,
			reconnecting,
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
	RpcClient.runtime.atom(
		pipe(
			RpcClient,
			Effect.map(client => client('auth.catalog', undefined)),
			Stream.unwrap,
			reconnecting
		)
	)
)

// The rows the app list's skeleton draws while it loads, about as many as it lists.
export const APP_ROWS = 9

// The apps a sign-in reaches, by origin; a browser session names no app.
export function appOrigins(resources: PendingAuthorization['resources']) {
	if (Array.isReadonlyArrayEmpty(resources)) return ['browser']
	return Array.dedupe(Array.map(resources, resource => new URL(resource).origin))
}

export function timeLabel(time: number) {
	return pipe(DateTime.makeUnsafe(time), DateTime.formatLocal({hour: '2-digit', minute: '2-digit'}))
}

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

// What is left until `until`, as m:ss.
export function leftLabel(until: number, now: number) {
	const seconds = Number.max(0, Math.ceil((until - now) / 1000))
	return `${Math.floor(seconds / 60)}:${String.padStart(2, '0')(`${seconds % 60}`)}`
}

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

export function minutesSince(time: number, now: number) {
	return Math.floor(Duration.toMinutes(DateTime.distance(DateTime.makeUnsafe(time), DateTime.makeUnsafe(now))))
}

export function ageLabel(minutes: number) {
	if (minutes < 1) return 'now'
	if (minutes < 60) return `${minutes}m`
	if (minutes < 1440) return `${Math.floor(minutes / 60)}h`
	return `${Math.floor(minutes / 1440)}d`
}

// A sign-in as the lists name it: the app or browser, then where it runs.
export function signInLabel(client: string, device: string) {
	return `${client} · ${device}`
}

export function newest(apps: readonly SignedInApp[]) {
	return Array.reduce(apps, 0, (latest, app) => Number.max(latest, app.lastActive))
}

export function dayLabel(time: number) {
	return pipe(DateTime.makeUnsafe(time), DateTime.formatLocal({day: 'numeric', month: 'short'}))
}

// Accounts are keyed "provider:id"; GitHub serves every account's picture by its numeric id.
export function avatarUrl(id: string) {
	return `https://avatars.githubusercontent.com/u/${String.replace('github:', '')(id)}?s=96`
}

export const consentAtom = RpcClient.runtime.fn((input: {accept: boolean; request: PendingAuthorization}, get) =>
	pipe(
		RpcClient,
		Effect.flatMap(client => client('auth.answer', {accept: input.accept, request: input.request.id})),
		Effect.andThen(Effect.sync(() => get.set(codeAtom.send, {_tag: 'Answered', ...input})))
	)
)

// An action from a menu, which closes as it runs, says how it failed in a toast rather than in a line far from it.
function failedWith(title: string) {
	return <A, E extends {message: string}, R>(effect: Effect.Effect<A, E, R>) =>
		Effect.tapError(effect, failure =>
			Effect.sync(() => toast.add({description: failure.message, title, type: 'error'}))
		)
}

// The page an app sent this browser to sign in from, carried through either way of signing in.
const next = Option.fromNullishOr(new URLSearchParams(location.search).get('next'))

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

// The browser asks for any passkey of this site, whichever device or key holds it, then lands signed in where the page asked.
export const passkeySignInAtom = authRuntime.fn(() =>
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
					...Option.match(next, {onNone: () => ({}), onSome: page => ({next: page})}),
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

// The passkeys this account can sign in with, live, for the account menu.
export const passkeysAtom = Atom.keepAlive(
	RpcClient.runtime.atom(
		pipe(
			RpcClient,
			Effect.map(client => client('auth.passkeys', undefined)),
			Stream.unwrap,
			reconnecting
		)
	)
)

// The browser offers every kind it can make: this device's, a password manager's, a security key, or a phone's over a QR code.
export const addPasskeyAtom = RpcClient.runtime.fn(
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
		toast.add({title: 'Passkey added'})
	}, failedWith('Cannot add a passkey'))
)

export const removePasskeyAtom = RpcClient.runtime.fn((id: string) =>
	pipe(
		Effect.flatMap(RpcClient, client => client('auth.removePasskey', {id})),
		failedWith('Cannot remove the passkey')
	)
)

export const signInAtom = Atom.fn(() =>
	Effect.try({
		catch: cause => AuthError.make({cause, message: 'Cannot start GitHub sign-in'}),
		try: () => location.assign(`/auth/github${location.search}`)
	})
)

export const codeSignInAtom = Atom.fn(() =>
	Effect.try({
		catch: cause => AuthError.make({cause, message: 'Cannot start the sign-in'}),
		try: () =>
			location.assign(
				Option.match(next, {
					onNone: () => '/auth/code',
					onSome: page => `/auth/code?${new URLSearchParams({next: page})}`
				})
			)
	})
)

// Another app's account menu signs out here, where the shared session lives, then returns to that app.
export const signingOut = new URLSearchParams(location.search).has('sign-out')

const afterSignOut = pipe(
	Option.fromNullishOr(new URLSearchParams(location.search).get('next')),
	Option.filter(page => returnable(page, AUTH_URL)),
	Option.getOrElse(() => location.pathname)
)

export const signOutAtom = authRuntime.fn(() =>
	pipe(
		HttpClient.HttpClient.use(client => HttpClient.filterStatusOk(client).post('/auth/sign-out')),
		Effect.andThen(Effect.sync(() => location.replace(afterSignOut))),
		Effect.mapError(cause => AuthError.make({cause, message: 'Cannot sign out'})),
		failedWith('Cannot sign out')
	)
)
