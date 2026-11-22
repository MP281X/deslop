import {Effect, pipe} from 'effect'

import {HttpClient, HttpClientResponse} from 'effect/http'
import type {Headers} from 'effect/http'

import {AuthError, outageUnlessRefused} from '#shared/auth.ts'
import {ACCOUNT_PATH, Account} from '#shared/schema.ts'

// Both clients distinguish a refusal from an outage, which must keep retrying.
export function readAccount(origin: string, headers?: Headers.Input) {
	return pipe(
		HttpClient.get(`${origin}${ACCOUNT_PATH}`, {headers}),
		Effect.flatMap(
			Effect.fnUntraced(function* (response: HttpClientResponse.HttpClientResponse) {
				if (response.status === 401) return yield* AuthError.make({message: 'Sign in first'})
				if (response.status === 403) {
					return yield* AuthError.make({error: 'access_denied', message: 'This account is refused'})
				}
				return yield* pipe(
					response,
					HttpClientResponse.filterStatusOk,
					Effect.flatMap(HttpClientResponse.schemaBodyJson(Account))
				)
			})
		),
		outageUnlessRefused('The server could not be reached')
	)
}
