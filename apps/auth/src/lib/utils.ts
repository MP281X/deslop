import {
	Array,
	Clock,
	DateTime,
	Duration,
	Effect,
	Match,
	Number,
	Option,
	Schedule,
	Schema,
	Stream,
	String,
	pipe
} from 'effect'

import {Machine} from '@typeonce/effect-machine'
import {AtomMachine} from '@typeonce/effect-machine/reactivity'
import {FetchHttpClient, HttpClient} from 'effect/http'
import {Atom, AtomRpc} from 'effect/reactivity'

import {AuthError} from '@deslop/runtime/auth/schema'
import * as WebRuntime from '@deslop/runtime/web'

import {RpcContracts} from '#rpcs/contracts.ts'
import type {Account, AdmitParams} from '#services/people/schema.ts'
import {CODE_LENGTH, typedCode} from '#services/sign-ins/lib/utils.ts'
import {PendingAuthorization} from '#services/sign-ins/schema.ts'
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
			Stream.catchTag('AuthError', () => Stream.make(Option.none<Account>()))
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

// One app chip can hold the sign-ins of a client on several machines; signing out of it ends them all.
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

// Each app's server serves its icon at /icon; an iOS app opens through its URL scheme.
export const APPS = [
	{id: 'auth', name: 'Auth', url: 'https://auth.mp281x.xyz'},
	{id: 'gateway', name: 'Gateway', url: 'https://gateway.mp281x.xyz'},
	{id: 'opm', name: 'opm', url: 'opm://'},
	{id: 'portfolio', name: 'Portfolio', url: 'https://portfolio.mp281x.xyz'},
	{id: 'scope', name: 'Scope', url: 'https://scope.mp281x.xyz'},
	{id: 'signal', name: 'Signal', url: 'https://signal.mp281x.xyz'},
	{id: 'stash', name: 'Stash', url: 'stash://'},
	{id: 'trips', name: 'Trips', url: 'trips://'}
] as const

// The apps a sign-in reaches, by id; tracing rides along with every app, so it shows only alone, and a browser session names no app.
export function appIds(resources: PendingAuthorization['resources']) {
	if (Array.isReadonlyArrayEmpty(resources)) return ['browser']
	const ids = Array.dedupe(
		Array.map(
			Array.filter(resources, resource => resource !== 'https://otel.mp281x.xyz'),
			resource =>
				pipe(
					new URL(resource).hostname,
					String.split('.'),
					Array.head,
					Option.getOrElse(() => '')
				)
		)
	)
	if (Array.isReadonlyArrayEmpty(ids)) return ['tracing']
	return ids
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

// The page an app sent this browser to sign in from, carried through either way of signing in.
const next = Option.fromNullishOr(new URLSearchParams(location.search).get('next'))

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

export const signOutAtom = authRuntime.fn(() =>
	pipe(
		HttpClient.HttpClient.use(client => HttpClient.filterStatusOk(client).post('/auth/sign-out')),
		Effect.andThen(Effect.sync(() => location.reload())),
		Effect.mapError(cause => AuthError.make({cause, message: 'Cannot sign out'}))
	)
)
