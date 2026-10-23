import {Array, DateTime, Effect, Match, Option, Schedule, Stream, String, pipe} from 'effect'

import {FetchHttpClient, HttpClient, HttpClientRequest} from 'effect/http'
import {Atom, AtomRpc} from 'effect/reactivity'

import {AuthError} from '@deslop/runtime/auth/schema'
import * as WebRuntime from '@deslop/runtime/web'

import {RpcContracts} from '#rpcs/contracts.ts'
import type {Account, AdmitParams, PendingAuthorization} from '#services/authorizations/schema.ts'

const authRuntime = Atom.runtime(FetchHttpClient.layer)

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

// WDJBMJHT reads WDJB-MJHT.
export function requestCode(id: string) {
	return `${String.slice(0, 4)(id)}-${String.slice(4)(id)}`
}

// What someone typed, as the id it names: letters only, in capitals.
export function typedCode(text: string) {
	return String.toUpperCase(String.replaceAll(/[^a-z]/giu, '')(text))
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

// Accounts are keyed "provider:id"; GitHub serves every account's picture by its numeric id.
export function avatarUrl(id: string) {
	return `https://avatars.githubusercontent.com/u/${String.replace('github:', '')(id)}?s=96`
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
