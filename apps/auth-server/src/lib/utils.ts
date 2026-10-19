import {Effect, Option, pipe} from 'effect'

import {FetchHttpClient, HttpClient, HttpClientRequest, HttpClientResponse} from 'effect/http'
import {Atom, AtomRpc} from 'effect/reactivity'

import {AuthError, Authorization, Redirect} from '@deslop/auth/schema'
import * as WebRuntime from '@deslop/runtime/web'

import {RpcContracts} from '#rpcs/contracts.ts'

const authRuntime = Atom.runtime(FetchHttpClient.layer)

class RpcClient extends AtomRpc.Service<RpcClient>()('@deslop/auth-server/lib/utils/RpcClient', {
	group: RpcContracts,
	protocol: WebRuntime.layer('@deslop/auth-server')
}) {}

export const meAtom = RpcClient.runtime.atom(
	pipe(
		Effect.flatMap(RpcClient, rpc => rpc('auth.me', undefined)),
		Effect.asSome,
		Effect.catchTag('AuthError', () => Effect.succeedNone)
	)
)

export const requestAtom = authRuntime.atom(
	Option.match(Option.fromNullishOr(new URLSearchParams(location.search).get('request')), {
		onNone: () => Effect.succeedNone,
		onSome: Effect.fnUntraced(function* (request: string) {
			return yield* pipe(
				HttpClient.HttpClient.use(client =>
					HttpClient.filterStatusOk(client).get('/auth/request', {urlParams: {request}})
				),
				Effect.flatMap(HttpClientResponse.schemaBodyJson(Authorization)),
				Effect.asSome,
				Effect.mapError(cause => AuthError.make({cause, message: 'Open the authorization link again'}))
			)
		})
	})
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

export const consentAtom = authRuntime.fn((accept: boolean) =>
	pipe(
		HttpClientRequest.post('/api/auth/oauth2/consent'),
		HttpClientRequest.bodyJson({accept, request: new URLSearchParams(location.search).get('request')}),
		Effect.flatMap(request => HttpClient.HttpClient.use(client => HttpClient.filterStatusOk(client).execute(request))),
		Effect.flatMap(HttpClientResponse.schemaBodyJson(Redirect)),
		Effect.flatMap(result => Effect.sync(() => location.assign(result.url))),
		Effect.mapError(cause => AuthError.make({cause, message: 'Cannot finish authorization'}))
	)
)
