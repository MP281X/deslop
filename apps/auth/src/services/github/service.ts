import {Cache, Config, Context, Effect, Layer, Redacted, Schema, Struct, pipe} from 'effect'

import {Digest, SecureRandom} from 'effect/crypto'
import {Base64Url} from 'effect/encoding'
import {HttpClient, HttpClientRequest, HttpClientResponse, UrlParams} from 'effect/http'

import {AuthError} from '@deslop/runtime/auth/schema'
import {AUTH_URL} from '@deslop/runtime/auth/utils'

import {GitHubToken} from '#services/github/schema.ts'
import type {SignInParams} from '#services/github/schema.ts'
import {GitHubUser} from '#services/people/schema.ts'

const HEADERS = {accept: 'application/vnd.github+json', 'user-agent': '@deslop/auth'}
const CALLBACK = `${AUTH_URL}/auth/github/callback`

function failed(message: string) {
	return Effect.mapError(cause => {
		if (Schema.is(AuthError)(cause)) return cause
		return AuthError.make({cause, message})
	})
}

// GitHub proves who someone is; the step in between lives here for ten minutes, and an Auth restart cancels it.
export class GitHub extends Context.Service<
	GitHub,
	{
		readonly cancel: (state: string) => Effect.Effect<SignInParams, AuthError>
		readonly finish: (
			code: string,
			state: string
		) => Effect.Effect<{flow: SignInParams; profile: GitHubUser}, AuthError>
		readonly profile: (id: string) => Effect.Effect<GitHubUser, AuthError>
		readonly start: (flow: SignInParams) => Effect.Effect<{state: string; url: string}, AuthError>
	}
>()('@deslop/auth/services/github/service/GitHub') {
	static readonly layer = Layer.effect(
		GitHub,
		Effect.gen(function* () {
			const client = HttpClient.filterStatusOk(yield* HttpClient.HttpClient)
			const random = yield* SecureRandom.SecureRandom
			const digest = yield* Digest.Digest
			const provider = yield* Config.all({
				clientId: Config.String('GITHUB_CLIENT_ID'),
				secret: Config.Redacted('GITHUB_CLIENT_SECRET')
			})
			const flows = yield* Cache.make<string, SignInParams & {verifier: string}, AuthError>({
				capacity: 256,
				lookup: () => Effect.fail(AuthError.make({message: 'The sign-in expired'})),
				timeToLive: '10 minutes'
			})
			const nonce = Effect.map(random.randomBytes(32), Base64Url.encode)
			// The sign-in GitHub's callback belongs to, read once.
			const take = Effect.fnUntraced(function* (state: string) {
				const flow = yield* Cache.get(flows, state)
				yield* Cache.invalidate(flows, state)
				return flow
			})
			const user = Effect.fnUntraced(function* (request: HttpClientRequest.HttpClientRequest) {
				return yield* pipe(
					client.execute(HttpClientRequest.setHeaders(request, HEADERS)),
					Effect.flatMap(HttpClientResponse.schemaBodyJson(GitHubUser)),
					Effect.timeout('10 seconds')
				)
			})
			return GitHub.of({
				cancel: state => Effect.map(take(state), flow => Struct.omit(flow, ['verifier'])),
				finish: Effect.fn('GitHub.finish')(function* (code: string, state: string) {
					const flow = yield* take(state)
					const token = yield* pipe(
						HttpClientRequest.post('https://github.com/login/oauth/access_token'),
						HttpClientRequest.acceptJson,
						HttpClientRequest.bodyUrlParams({
							client_id: provider.clientId,
							client_secret: Redacted.value(provider.secret),
							code,
							code_verifier: flow.verifier,
							redirect_uri: CALLBACK
						}),
						request => client.execute(request),
						Effect.flatMap(HttpClientResponse.schemaBodyJson(GitHubToken)),
						Effect.timeout('10 seconds')
					)
					const profile = yield* user(
						HttpClientRequest.bearerToken(HttpClientRequest.get('https://api.github.com/user'), token.access_token)
					)
					return {flow, profile}
				}, failed('GitHub sign-in failed')),
				profile: Effect.fn('GitHub.profile')(function* (id: string) {
					return yield* user(HttpClientRequest.get(`https://api.github.com/user/${id}`))
				}, failed('Cannot read the GitHub profile')),
				start: Effect.fn('GitHub.start')(function* (flow: SignInParams) {
					const state = yield* nonce
					const verifier = yield* nonce
					yield* Cache.set(flows, state, {...flow, verifier})
					const url = new URL('https://github.com/login/oauth/authorize')
					url.search = UrlParams.toString(
						UrlParams.fromInput({
							client_id: provider.clientId,
							code_challenge: Base64Url.encode(yield* digest.digest(Digest.sha256, new TextEncoder().encode(verifier))),
							code_challenge_method: 'S256',
							redirect_uri: CALLBACK,
							state
						})
					)
					return {state, url: url.href}
				}, failed('Cannot start GitHub sign-in'))
			})
		})
	)
}
