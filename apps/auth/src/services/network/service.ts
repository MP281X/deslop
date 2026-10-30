import {lookup} from 'node:dns'

import {NodeHttpClient} from '@effect/platform-node'

import {Array, Effect, Layer, String} from 'effect'

import {FetchHttpClient} from 'effect/http'
import ipaddr from 'ipaddr.js'

import {AuthError} from '@deslop/runtime/auth/schema'

function requestUrl(input: RequestInfo | URL) {
	if (input instanceof Request) return new URL(input.url)
	return new URL(input.toString())
}

function publicAddress(address: string) {
	return ipaddr.isValid(address) && ipaddr.process(address).range() === 'unicast'
}

// Validate at socket lookup, not in a separate DNS preflight: a rebinding must never select a private address.
export const layerPublicFetch = Layer.effect(FetchHttpClient.Fetch)(
	Effect.gen(function* () {
		const fetch = yield* FetchHttpClient.Fetch
		const dispatcher = yield* NodeHttpClient.makeDispatcherOptions({
			connect: {
				lookup: (hostname, options, callback) => {
					lookup(hostname, {all: true}, (error, addresses) => {
						if (
							error !== null ||
							Array.isArrayEmpty(addresses) ||
							!Array.every(addresses, entry => publicAddress(entry.address))
						) {
							callback(error ?? AuthError.make({message: 'MCP endpoints must resolve to public addresses'}), '', 4)
							return
						}
						if (options.all === true) callback(error, addresses)
						else callback(error, addresses[0]?.address ?? '', addresses[0]?.family ?? 4)
					})
				}
			}
		})
		return (input, options) => {
			const url = requestUrl(input)
			const hostname = String.replaceAll(/^\[|\]$/gu, '')(url.hostname)
			if (
				url.protocol !== 'https:' ||
				url.username !== '' ||
				url.password !== '' ||
				url.hash !== '' ||
				(ipaddr.isValid(hostname) && !publicAddress(hostname))
			) {
				// oxlint-disable-next-line no-restricted-properties -- FetchHttpClient.Fetch is a Promise-returning transport boundary.
				return Effect.runPromise(Effect.fail(AuthError.make({message: 'MCP endpoints must use public HTTPS URLs'})))
			}
			const init: RequestInit & {dispatcher: typeof dispatcher} = {...options, dispatcher, redirect: 'error'}
			return fetch(input, init)
		}
	})
)
