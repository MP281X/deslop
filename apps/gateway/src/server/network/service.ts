import {lookup} from 'node:dns'

import {NodeHttpClient} from '@effect/platform-node'
import {Agent} from '@effect/platform-node/Undici'

import {Array, Effect, Layer, Result, String, pipe} from 'effect'

import {FetchHttpClient} from 'effect/http'
import {NetAddress} from 'effect/net'

import {AuthError} from '@deslop/runtime/shared/auth'
import {isPublicAddress} from '@deslop/runtime/shared/net'

function requestUrl(input: RequestInfo | URL) {
	if (input instanceof Request) return new URL(input.url)
	return new URL(input.toString())
}

// The most one answer from an MCP server or its sign-in provider may carry is 8 MiB; past it the body errors, whichever client reads it. An AI provider's answer never passes here: AiProxy streams it on its own client, bounded by its wait for headers and its idle gap, not in size.
function bounded(response: Response) {
	if (response.body === null) return response
	const read = {bytes: 0}
	return new Response(
		response.body.pipeThrough(
			new TransformStream<Uint8Array, Uint8Array>({
				transform: (chunk, controller) => {
					read.bytes += chunk.byteLength
					if (read.bytes > 8 * 1024 * 1024) {
						controller.error(AuthError.make({message: 'The MCP server answered more than 8 MiB'}))
						return
					}
					controller.enqueue(chunk)
				}
			})
		),
		{headers: response.headers, status: response.status, statusText: response.statusText}
	)
}

// Validate at socket lookup, not in a separate DNS preflight: a rebinding must never select a private address.
const layerPublicFetch = Layer.effect(
	FetchHttpClient.Fetch,
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
				(Result.isSuccess(NetAddress.ipFromString(hostname)) && !isPublicAddress(hostname))
			) {
				// oxlint-disable-next-line no-restricted-properties -- FetchHttpClient.Fetch is a Promise-returning transport boundary.
				return Effect.runPromise(Effect.fail(AuthError.make({message: 'MCP endpoints must use public HTTPS URLs'})))
			}
			const init: RequestInit & {dispatcher: typeof dispatcher} = {...options, dispatcher, redirect: 'error'}
			// oxlint-disable-next-line @deslop/coding-standards/no-native-method-call -- fetch's own Promise is the value FetchHttpClient.Fetch must return.
			return fetch(input, init).then(bounded)
		}
	})
)

// Fresh: a shared NodeHttpClient.layerFetch is memoized, and Auth's unguarded client would be reused here.
export const layerUpstream = pipe(
	Layer.fresh(NodeHttpClient.layerFetch),
	Layer.provide(Layer.succeed(NodeHttpClient.RequestInit, {redirect: 'error'})),
	Layer.provideMerge(layerPublicFetch)
)
