import {Effect, String, pipe} from 'effect'

import {FetchHttpClient, HttpClient, HttpClientResponse} from 'effect/http'
import {AsyncResult, Atom} from 'effect/reactivity'

import {layerSocketProtocol} from '#client/protocol.ts'
import {activationsAtom} from '#mobile/activations.ts'
import {appConfig} from '#mobile/app.ts'
import {AuthError, asAuthError} from '#shared/auth.ts'
import {Account, RPC_PATH} from '#shared/schema.ts'
import {layerOtlp} from '#shared/telemetry.ts'

// Scope's public receiver takes traces and logs from anywhere; the version is the release running, a build's or an over-the-air update's.
Atom.runtime.addGlobalLayer(
	layerOtlp(`@deslop/${appConfig.slug}-ios`, 'https://scope.mp281x.xyz', 'mobile', appConfig.version)
)

export function makeSession(server: string) {
	const sessionRuntime = Atom.runtime(FetchHttpClient.layer)
	const accountAtom = sessionRuntime.atom(get => {
		get(activationsAtom)
		return pipe(
			HttpClient.get(new URL('/api/account', server).href),
			Effect.filterOrFail(
				response => response.status !== 401 && response.status !== 403,
				() => AuthError.make({error: 'access_denied', message: 'Connect to Tailscale'})
			),
			Effect.flatMap(HttpClientResponse.filterStatusOk),
			Effect.flatMap(HttpClientResponse.schemaBodyJson(Account)),
			Effect.timeout('10 seconds'),
			asAuthError('The server could not be reached')
		)
	})

	return {
		account: accountAtom,
		// Reading the account restarts live work on each return from the background, when iOS has closed its sockets.
		available: (get: Atom.AtomContext) => AsyncResult.isSuccess(get(accountAtom)),
		protocol: layerSocketProtocol(String.replace(/^http/u, 'ws')(new URL(RPC_PATH, server).href)),
		runtime: sessionRuntime
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
