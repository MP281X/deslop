import {DateTime, Effect, Match, Option, Predicate, Schema, Stream, String, pipe} from 'effect'

import {startAuthentication, startRegistration} from '@simplewebauthn/browser'
import {Machine} from '@typeonce/effect-machine'
import {AtomMachine} from '@typeonce/effect-machine/reactivity'
import {FetchHttpClient, HttpClient, HttpClientRequest, HttpClientResponse} from 'effect/http'
import {AsyncResult, Atom, AtomRpc} from 'effect/reactivity'

import {liveAtom, liveStream, reconnectOnDrop} from '@deslop/runtime/client/live-stream'
import {AUTH_URL, AuthError} from '@deslop/runtime/shared/auth'
import type {UserId} from '@deslop/runtime/shared/auth'
import {RpcStream} from '@deslop/runtime/shared/rpc'
import {addPageTelemetry, layerPageProtocol} from '@deslop/runtime/web/client'

import {RpcContracts} from '#rpcs/contracts.ts'
import {CreationOptions, PasskeySignIn, Registration, RequestOptions} from '#services/passkeys/schema.ts'
import type {SignedAccount} from '#services/people/schema.ts'
import {CODE_LENGTH, typedCode} from '#services/sign-ins/lib/utils.ts'
import {PendingAuthorization, SignInCode} from '#services/sign-ins/schema.ts'
import {returnable} from '#services/tokens/lib/utils.ts'
import type {SessionVia} from '#services/tokens/schema.ts'

// The tab remembers the passkey it went to GitHub for, so the page it lands on adds it.
const ADDING_PASSKEY = 'adding-passkey'

const authRuntime = Atom.runtime(FetchHttpClient.layer)

export type Search = typeof Search.Type
export const Search = Schema.Struct({
	code: Schema.OptionFromOptionalKey(Schema.String),
	error: Schema.OptionFromOptionalKey(Schema.String),
	next: Schema.OptionFromOptionalKey(Schema.String),
	request: Schema.OptionFromOptionalKey(SignInCode),
	'sign-out': Schema.OptionFromOptionalKey(Schema.String)
})

addPageTelemetry('@deslop/auth')

class RpcClient extends AtomRpc.Service<RpcClient>()('@deslop/auth/lib/auth/RpcClient', {
	group: RpcContracts.middleware(RpcStream),
	protocol: layerPageProtocol
}) {}

// Live, so an account waiting for an admin moves on once allowed; a declined or removed account is signed out and reads None.
export const accountAtom = Atom.keepAlive(
	RpcClient.runtime.atom(
		pipe(
			liveStream(RpcClient, 'people.account'),
			reconnectOnDrop,
			Stream.map(Option.some),
			Stream.catchTag('AuthError', () => Stream.make(Option.none<SignedAccount>()))
		)
	)
)

type AuthPage =
	| {_tag: 'SigningOut'}
	| {_tag: 'Request'; account: Option.Option<SignedAccount>; id: SignInCode}
	| {_tag: 'SignIn'}
	| {_tag: 'Signed'; account: SignedAccount}

export const pageAtom = Atom.family((search: Search) =>
	Atom.map(
		accountAtom,
		AsyncResult.map(account => {
			if (Option.isSome(search['sign-out'])) return {_tag: 'SigningOut'} satisfies AuthPage
			return Option.match(search.request, {
				onNone: () =>
					Option.match(account, {
						onNone: () => ({_tag: 'SignIn'}) satisfies AuthPage,
						onSome: signed => ({_tag: 'Signed', account: signed}) satisfies AuthPage
					}),
				onSome: id => ({_tag: 'Request', account, id}) satisfies AuthPage
			})
		})
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
					fields: {code: SignInCode},
					states: {
						// The lookup itself failed, which says nothing about the code.
						Failed: {fields: {message: Schema.String}},
						Found: {fields: {request: PendingAuthorization}},
						Looking: {},
						Missing: {}
					}
				},
				Typing: {fields: {answered: Schema.OptionFromOptionalKey(Schema.Struct(Answered)), typed: Schema.String}}
			}
		}),
		streams: {lookup: (code: SignInCode) => reconnectOnDrop(liveStream(RpcClient, 'sign-ins.lookup', {code}))}
	}).handle({
		initial: {data: {answered: Option.none(), typed: ''}, target: 'Typing'},
		on: {
			Answered: {
				data: transition => ({
					answered: Option.some({accept: transition.event.accept, request: transition.event.request}),
					typed: ''
				}),
				target: 'Typing'
			},
			Typed: {data: transition => ({answered: Option.none(), typed: transition.event.typed}), target: 'Typing'}
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
					data: transition => ({code: SignInCode.make(transition.state.typed)}),
					guard: transition => String.length(transition.state.typed) >= CODE_LENGTH,
					target: 'Code'
				}
			}
		}
	})
)

export type CodeView = {
	answered: Option.Option<{accept: boolean; request: PendingAuthorization}>
	pending: Option.Option<PendingAuthorization>
	state: 'Checking' | 'Found' | 'Missing' | 'Typing' | {failed: string}
	typed: string
}

export const codeViewAtom = Atom.map(
	codeAtom.result,
	AsyncResult.map(snapshot => {
		if (snapshot.state.path === 'Typing') {
			return {
				answered: snapshot.state.value.answered,
				pending: Option.none(),
				state: 'Typing',
				typed: snapshot.state.value.typed
			} satisfies CodeView
		}
		const view = {answered: Option.none(), pending: Option.none(), typed: snapshot.state.value.code}
		if (snapshot.state.state.path === 'Code.Found') {
			return {...view, pending: Option.some(snapshot.state.state.value.request), state: 'Found'} satisfies CodeView
		}
		if (snapshot.state.state.path === 'Code.Failed') {
			return {...view, state: {failed: snapshot.state.state.value.message}} satisfies CodeView
		}
		if (snapshot.state.state.path === 'Code.Looking') return {...view, state: 'Checking'} satisfies CodeView
		return {...view, state: 'Missing'} satisfies CodeView
	})
)

// Read each time the approve page opens, so returning to it from People does not bring back an answered code.
export const linkedCodeAtom = Atom.family((code: string) =>
	Atom.make(get => {
		get.set(codeAtom.send, {_tag: 'Typed', typed: typedCode(code)})
	})
)

export const peopleAtom = Atom.keepAlive(liveAtom(RpcClient, 'people.watch'))

// Live, so a new sign-in, each refresh and a disconnect from another page show here.
export const appsAtom = Atom.keepAlive(liveAtom(RpcClient, 'tokens.watchApps'))

// One per person, so a failed answer shows beneath that person's row.
export const admitAtom = Atom.family((id: UserId) =>
	RpcClient.runtime.fn((allow: boolean) => Effect.flatMap(RpcClient, client => client('people.admit', {allow, id})))
)

export const requestAtom = Atom.family((request: SignInCode) =>
	RpcClient.runtime.atom(
		pipe(
			liveStream(RpcClient, 'sign-ins.status', {request}),
			reconnectOnDrop,
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
export function requestCode(id: SignInCode) {
	return `${String.slice(0, 4)(id)}-${String.slice(4)(id)}`
}

// The link RFC 8628 calls verification_uri_complete: it opens the approve page with the code filled in.
export function approveLink(id: SignInCode) {
	return `${location.origin}/?code=${id}`
}

// The time once a minute, so "4m" labels keep counting on an idle page.
export const minuteAtom = Atom.make(Stream.mapEffect(Stream.tick('1 minute'), () => DateTime.now))

// The time each second, for a waiting sign-in's countdown.
export const secondAtom = Atom.make(Stream.mapEffect(Stream.tick('1 second'), () => DateTime.now))

// Copies the code; the result waits a moment after, while the code shows it was copied.
export const copyCodeAtom = Atom.fn((code: string) =>
	Effect.andThen(
		Effect.tryPromise({
			catch: cause => AuthError.make({cause, message: 'Cannot copy the code; type it in instead'}),
			try: () => navigator.clipboard.writeText(code)
		}),
		Effect.sleep('1200 millis')
	)
)

// A sign-in as the lists name it: the app or browser, then where it runs.
export function signInLabel(client: string, device: string) {
	return `${client} · ${device}`
}

export const consentAtom = RpcClient.runtime.fn((input: {accept: boolean; request: PendingAuthorization}, get) =>
	pipe(
		RpcClient,
		Effect.flatMap(client => client('sign-ins.answer', {accept: input.accept, request: input.request.id})),
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
	Effect.mapError(
		Effect.gen(function* () {
			const client = yield* HttpClient.HttpClient
			const offered = yield* client.get('/auth/passkey')
			if (offered.status !== 200) return yield* refused(offered)
			const options = yield* HttpClientResponse.schemaBodyJson(RequestOptions)(offered)
			const encoded = yield* Schema.encodeEffect(RequestOptions)(options)
			const response = yield* Effect.catchIf(
				Effect.tryPromise({
					catch: cause => AuthError.make({cause, message: 'No passkey was used'}),
					try: () => startAuthentication({optionsJSON: encoded})
				}),
				cancelled,
				() => Effect.interrupt
			)
			const answer = yield* pipe(
				HttpClientRequest.post('/auth/passkey'),
				HttpClientRequest.schemaBodyJson(PasskeySignIn)({
					next,
					response: yield* Schema.decodeEffect(PasskeySignIn.fields.response)(response)
				}),
				Effect.flatMap(request => client.execute(request)),
				Effect.flatMap(
					Effect.fnUntraced(function* (signedIn) {
						if (signedIn.status !== 200) return yield* refused(signedIn)
						return yield* HttpClientResponse.schemaBodyJson(
							Schema.Struct({next: Schema.OptionFromOptionalKey(Schema.String)})
						)(signedIn)
					})
				)
			)
			yield* Effect.sync(() =>
				Option.match(answer.next, {onNone: () => location.reload(), onSome: page => location.assign(page)})
			)
		}),
		cause => {
			if (Schema.is(AuthError)(cause)) return cause
			return AuthError.make({cause, message: 'Cannot sign in with a passkey'})
		}
	)
)

export const passkeysAtom = Atom.keepAlive(liveAtom(RpcClient, 'passkeys.watch'))

// Kept alive, since the browser's passkey prompt outlives the menu that starts it.
export const addPasskeyAtom = Atom.keepAlive(
	RpcClient.runtime.fn(
		Effect.fnUntraced(function* () {
			const client = yield* RpcClient
			const options = yield* client('passkeys.registration', undefined)
			const encoded = yield* Schema.encodeEffect(CreationOptions)(options)
			const response = yield* pipe(
				Effect.tryPromise({
					catch: cause => AuthError.make({cause, message: 'No passkey was added'}),
					try: () => startRegistration({optionsJSON: encoded})
				}),
				Effect.catchIf(cancelled, () => Effect.interrupt),
				Effect.flatMap(Schema.decodeUnknownEffect(Registration))
			)
			yield* client('passkeys.add', {response})
		})
	)
)

// The account menu's open state, which the return from GitHub also sets so the passkey's outcome shows on its action.
export const accountMenuOpenAtom = Atom.make(false)

// Back from GitHub, the passkey the tab went for starts at once, and only once.
export const resumePasskeyAtom = Atom.family((via: SessionVia) =>
	Atom.make(get => {
		if (sessionStorage.getItem(ADDING_PASSKEY) === null) return
		sessionStorage.removeItem(ADDING_PASSKEY)
		if (via === 'Code') return
		get.set(accountMenuOpenAtom, true)
		get.set(addPasskeyAtom, undefined)
	})
)

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
				Option.match(next, {
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
						next,
						Option.filter(page => returnable(page, AUTH_URL)),
						Option.getOrElse(() => location.pathname)
					)
				)
			)
		),
		Effect.mapError(cause => AuthError.make({cause, message: `Cannot sign out: ${cause.message}`}))
	)
}

// From another app's Sign out, which starts once the page shows it and again on its retry; the page says how it failed.
export const signingOutAtom = Atom.family((next: Search['next']) => authRuntime.atom(signOut(next)))

// From the account menu, which shows a failure under its own item.
export const menuSignOutAtom = authRuntime.fn(signOut)
