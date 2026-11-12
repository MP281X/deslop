import {lookup} from 'node:dns'

import {NodeHttpClient} from '@effect/platform-node'
import {Agent} from '@effect/platform-node/Undici'

import {Array, Effect, Layer, String, pipe} from 'effect'

import {FetchHttpClient} from 'effect/http'

import {AuthError} from '@deslop/runtime/shared/auth'
import {isIpAddress, isPublicAddress} from '@deslop/runtime/shared/net'

function requestUrl(input: RequestInfo | URL) {
	if (input instanceof Request) return new URL(input.url)
	return new URL(input.toString())
}

// Validate at socket lookup, not in a separate DNS preflight: a rebinding must never select a private address.
const layerPublicFetch = Layer.effect(FetchHttpClient.Fetch)(
	Effect.gen(function* () {
		const fetch = yield* FetchHttpClient.Fetch
		const dispatcher = yield* Effect.acquireRelease(
			Effect.sync(
				() =>
					new Agent({
						connect: {
							lookup: (hostname, options, callback) => {
								lookup(hostname, {all: true}, (error, addresses) => {
									if (
										error !== null ||
										Array.isArrayEmpty(addresses) ||
										!Array.every(addresses, entry => isPublicAddress(entry.address))
									) {
										callback(
											error ?? AuthError.make({message: 'MCP endpoints must resolve to public addresses'}),
											'',
											4
										)
										return
									}
									if (options.all === true) callback(error, addresses)
									else callback(error, addresses[0]?.address ?? '', addresses[0]?.family ?? 4)
								})
							}
						}
					})
			),
			agent => Effect.promise(() => agent.destroy())
		)
		return (input, options) => {
			const url = requestUrl(input)
			const hostname = String.replaceAll(/^\[|\]$/gu, '')(url.hostname)
			if (
				url.protocol !== 'https:' ||
				url.username !== '' ||
				url.password !== '' ||
				url.hash !== '' ||
				(isIpAddress(hostname) && !isPublicAddress(hostname))
			) {
				// oxlint-disable-next-line no-restricted-properties -- FetchHttpClient.Fetch is a Promise-returning transport boundary.
				return Effect.runPromise(Effect.fail(AuthError.make({message: 'MCP endpoints must use public HTTPS URLs'})))
			}
			const init: RequestInit & {dispatcher: typeof dispatcher} = {...options, dispatcher, redirect: 'error'}
			return fetch(input, init)
		}
	})
)

// Fresh: a shared NodeHttpClient.layerFetch is memoized, and Auth's unguarded client would be reused here.
export const layerUpstream = pipe(
	Layer.fresh(NodeHttpClient.layerFetch),
	Layer.provide(Layer.succeed(NodeHttpClient.RequestInit, {redirect: 'error'})),
	Layer.provideMerge(layerPublicFetch)
)
