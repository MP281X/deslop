import {Array, DateTime, Effect, Layer, Match, Option, Schedule, Stream, String, pipe} from 'effect'

import {FetchHttpClient, HttpClient, HttpClientRequest} from 'effect/http'
import {Atom, AtomRpc} from 'effect/reactivity'
import * as Rpc from 'effect/rpc'

import {AuthError} from '@deslop/runtime/auth/schema'
import * as WebRuntime from '@deslop/runtime/web'

import {RpcContracts} from '#rpcs/contracts.ts'
import type {Account, AdmitParams, PendingAuthorization} from '#services/authorizations/schema.ts'

const authRuntime = Atom.runtime(FetchHttpClient.layer)

export const connectedAtom = Atom.make(false)

class RpcClient extends AtomRpc.Service<RpcClient>()('@deslop/auth/lib/utils/RpcClient', {
	group: RpcContracts,
	protocol: get =>
		pipe(
			WebRuntime.layer('@deslop/auth'),
			Layer.provide(
				Layer.succeed(Rpc.RpcClient.ConnectionHooks, {
					onConnect: Effect.sync(() => get.set(connectedAtom, true)),
					onDisconnect: Effect.sync(() => get.set(connectedAtom, false))
				})
			)
		)
}) {}

// Live, so an account waiting for an admin moves on once allowed; a declined or removed account is signed out and reads None.
export const accountAtom = Atom.keepAlive(
	RpcClient.runtime.atom(
		pipe(
			RpcClient,
			Effect.map(client => client('auth.account', undefined)),
			Stream.unwrap,
			Stream.retry($ =>
				pipe(
					$(Schedule.spaced('1 second')),
					Schedule.while(metadata => metadata.input._tag === 'RpcClientError')
				)
			),
			Stream.map(Option.some),
			Stream.catchTag('AuthError', () => Stream.make(Option.none<Account>()))
		)
	)
)

export const pendingAtom = Atom.keepAlive(
	RpcClient.runtime.atom(
		pipe(
			RpcClient,
			Effect.map(client => client('auth.pending', undefined)),
			Stream.unwrap,
			Stream.retry($ =>
				pipe(
					$(Schedule.spaced('1 second')),
					Schedule.while(metadata => metadata.input._tag === 'RpcClientError')
				)
			)
		)
	)
)

export const peopleAtom = Atom.keepAlive(
	RpcClient.runtime.atom(
		pipe(
			RpcClient,
			Effect.map(client => client('auth.people', undefined)),
			Stream.unwrap,
			Stream.retry($ =>
				pipe(
					$(Schedule.spaced('1 second')),
					Schedule.while(metadata => metadata.input._tag === 'RpcClientError')
				)
			)
		)
	)
)

export const admitAtom = RpcClient.runtime.fn((input: AdmitParams) =>
	Effect.flatMap(RpcClient, client => client('auth.admit', input))
)

export const removeAtom = RpcClient.runtime.fn((id: string) =>
	Effect.flatMap(RpcClient, client => client('auth.remove', {id}))
)

export const requestId = Option.fromNullishOr(new URLSearchParams(location.search).get('request'))

export const requestAtom = Atom.family((request: string) =>
	RpcClient.runtime.atom(
		pipe(
			RpcClient,
			Effect.map(client => client('auth.wait', {request})),
			Stream.unwrap,
			Stream.retry($ =>
				pipe(
					$(Schedule.spaced('1 second')),
					Schedule.while(metadata => metadata.input._tag === 'RpcClientError')
				)
			),
			Stream.tap(status =>
				pipe(
					Match.value(status),
					Match.tag('Completed', result => Effect.sync(() => location.assign(result.url))),
					Match.orElse(() => Effect.void)
				)
			)
		)
	)
)

export function requestCode(id: string) {
	return `${String.slice(0, 4)(id)}-${String.slice(4, 8)(id)}`
}

export function applicationName(request: PendingAuthorization) {
	return Array.match(
		Array.dedupe(
			Array.map(
				Array.filter(request.resources, resource => resource !== 'https://otel.mp281x.xyz'),
				resource =>
					pipe(
						new URL(resource).hostname,
						String.split('.'),
						Array.head,
						Option.getOrElse(() => '')
					)
			)
		),
		{onEmpty: () => 'Tracing', onNonEmpty: found => Array.join(Array.map(found, String.capitalize), ' + ')}
	)
}

export function timeLabel(time: number) {
	return pipe(DateTime.makeUnsafe(time), DateTime.formatLocal({hour: '2-digit', minute: '2-digit'}))
}

export function dayLabel(time: number) {
	return pipe(DateTime.makeUnsafe(time), DateTime.formatLocal({day: 'numeric', month: 'short'}))
}

// "luca-b" reads LB and "MP281X" MP, from the login's first two words or its first two letters.
export function initials(login: string) {
	const words = Array.filter(String.split(login, /[-_.\s]+/u), String.isNonEmpty)
	return String.toUpperCase(
		Array.match(Array.drop(words, 1), {
			onEmpty: () => String.slice(0, 2)(login),
			onNonEmpty: rest => `${String.slice(0, 1)(words[0] ?? '')}${String.slice(0, 1)(rest[0])}`
		})
	)
}

// The same account keeps the same square, picked from the theme's chart colors by its id.
export function avatarClass(id: string) {
	const shades = ['bg-chart-1', 'bg-chart-2', 'bg-chart-3', 'bg-chart-4', 'bg-chart-5']
	return shades[
		Array.reduce(
			String.split(id, ''),
			0,
			(sum, letter) =>
				sum +
				pipe(
					letter,
					String.charCodeAt(0),
					Option.getOrElse(() => 0)
				)
		) % shades.length
	]
}

export const consentAtom = authRuntime.fn((input: {accept: boolean; request: PendingAuthorization}) =>
	pipe(
		HttpClientRequest.post('/api/auth/oauth2/consent'),
		HttpClientRequest.bodyJson({accept: input.accept, request: input.request.id}),
		Effect.flatMap(request => HttpClient.HttpClient.use(client => HttpClient.filterStatusOk(client).execute(request))),
		Effect.as(input),
		Effect.mapError(cause =>
			AuthError.make({
				cause,
				message: 'Cannot answer the authorization request. It may have expired or already been answered.'
			})
		)
	)
)

export const signInAtom = Atom.fn(() =>
	Effect.try({
		catch: cause => AuthError.make({cause, message: 'Cannot start GitHub sign-in'}),
		try: () => location.assign(`/auth/github${location.search}`)
	})
)

export const signOutAtom = authRuntime.fn(() =>
	pipe(
		HttpClient.HttpClient.use(client => HttpClient.filterStatusOk(client).post('/auth/sign-out')),
		Effect.andThen(Effect.sync(() => location.reload())),
		Effect.mapError(cause => AuthError.make({cause, message: 'Cannot sign out'}))
	)
)
