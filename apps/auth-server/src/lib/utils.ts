import {Array, DateTime, Effect, Layer, Match, Option, Schedule, Stream, String, pipe} from 'effect'

import {FetchHttpClient, HttpClient, HttpClientRequest} from 'effect/http'
import {Atom, AtomRpc} from 'effect/reactivity'
import * as Rpc from 'effect/rpc'

import type {PendingAuthorization} from '@deslop/auth/schema'
import {AuthError} from '@deslop/auth/schema'
import * as WebRuntime from '@deslop/runtime/web'

import {RpcContracts} from '#rpcs/contracts.ts'

const authRuntime = Atom.runtime(FetchHttpClient.layer)

export const connectedAtom = Atom.make(false)

class RpcClient extends AtomRpc.Service<RpcClient>()('@deslop/auth-server/lib/utils/RpcClient', {
	group: RpcContracts,
	protocol: get =>
		pipe(
			WebRuntime.layer('@deslop/auth-server'),
			Layer.provide(
				Layer.succeed(Rpc.RpcClient.ConnectionHooks, {
					onConnect: Effect.sync(() => get.set(connectedAtom, true)),
					onDisconnect: Effect.sync(() => get.set(connectedAtom, false))
				})
			)
		)
}) {}

export const meAtom = RpcClient.runtime.atom(
	pipe(
		Effect.flatMap(RpcClient, rpc => rpc('auth.me', undefined)),
		Effect.asSome,
		Effect.catchTag('AuthError', () => Effect.succeedNone)
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
	const names = Array.dedupe(
		Array.map(request.resources, resource =>
			pipe(
				new URL(resource).hostname,
				String.split('.'),
				Array.head,
				Option.getOrElse(() => '')
			)
		)
	)
	if (names.length !== 1) return 'Shared access'
	return String.capitalize(names[0] ?? 'Unknown app')
}

export function timeLabel(time: number) {
	return pipe(DateTime.makeUnsafe(time), DateTime.formatLocal({hour: '2-digit', minute: '2-digit'}))
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
