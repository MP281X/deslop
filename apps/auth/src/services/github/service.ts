import {Config, Context, Duration, Effect, Layer, Option, Redacted, Struct, pipe} from 'effect'

import {Digest, SecureRandom} from 'effect/crypto'
import {HttpClient, HttpClientRequest, HttpClientResponse, UrlParams} from 'effect/http'

import {localAuth} from '@deslop/runtime/server/auth'
import {AUTH_URL, AuthError, DEVELOPER, GitHubId, asAuthError} from '@deslop/runtime/shared/auth'

import {GitHubClientId, GitHubToken, OAuthState} from '#services/github/schema.ts'
import type {SignInParams} from '#services/github/schema.ts'
import {GitHubUser} from '#services/people/schema.ts'
import {makeRecords} from '#services/records/service.ts'
import {hashOf, randomTokenOf} from '#services/tokens/lib/utils.ts'

const HEADERS = {accept: 'application/vnd.github+json', 'user-agent': '@deslop/auth'}
const CALLBACK = `${AUTH_URL}/auth/github/callback`
const DEVELOPER_PROFILE = GitHubUser.make({id: GitHubId.make(0), login: DEVELOPER.name, name: Option.none()})

// GitHub proves who someone is; the step in between lives here for ten minutes, and an Auth restart cancels it.
export class GitHub extends Context.Service<
	GitHub,
	{
		readonly cancel: (state: OAuthState) => Effect.Effect<SignInParams, AuthError>
		readonly finish: (
			code: string,
			state: OAuthState
		) => Effect.Effect<{flow: SignInParams; profile: GitHubUser}, AuthError>
		readonly start: (flow: SignInParams) => Effect.Effect<{state: OAuthState; url: string}, AuthError>
	}
>()('@deslop/auth/services/github/service/GitHub') {
	static readonly layer = Layer.effect(
		GitHub,
		Effect.gen(function* () {
			const flows = yield* makeRecords<OAuthState, SignInParams & {verifier: Option.Option<string>}>(
				Duration.minutes(10)
			)
			const nonce = randomTokenOf(yield* SecureRandom.SecureRandom)(32)
			const take = Effect.fnUntraced(function* (state: OAuthState) {
				return (yield* pipe(
					flows.consume(state, Option.none()),
					Effect.flatMap(Effect.fromOption),
					Effect.mapError(() => AuthError.make({message: 'The sign-in expired'}))
				)).value
			})
			const cancel = Effect.fn('GitHub.cancel')(function* (state: OAuthState) {
				return Struct.omit(yield* take(state), ['verifier'])
			})
			// Without an issuer there is no GitHub app: the GitHub step returns at once as the developer, an admin there.
			if (yield* localAuth) {
				return GitHub.of({
					cancel,
					finish: Effect.fn('GitHub.finish')(function* (_code: string, state: OAuthState) {
						return {flow: Struct.omit(yield* take(state), ['verifier']), profile: DEVELOPER_PROFILE}
					}),
					start: Effect.fn('GitHub.start')(function* (flow: SignInParams) {
						const state = OAuthState.make(yield* nonce)
						yield* flows.create(state, {...flow, verifier: Option.none()})
						return {state, url: `/auth/github/callback?${new URLSearchParams({code: 'development', state})}`}
					})
				})
			}
			const client = HttpClient.filterStatusOk(yield* HttpClient.HttpClient)
			const hash = hashOf(yield* Digest.Digest)
			const provider = yield* Config.all({
				clientId: Config.schema(GitHubClientId, 'GITHUB_CLIENT_ID'),
				secret: Config.Redacted('GITHUB_CLIENT_SECRET')
			})
			return GitHub.of({
				cancel,
				finish: Effect.fn('GitHub.finish')(function* (code: string, state: OAuthState) {
					const flow = yield* take(state)
					const token = yield* pipe(
						HttpClientRequest.post('https://github.com/login/oauth/access_token'),
						HttpClientRequest.acceptJson,
						HttpClientRequest.bodyUrlParams({
							client_id: provider.clientId,
							client_secret: Redacted.value(provider.secret),
							code,
							code_verifier: yield* Effect.fromOption(flow.verifier),
							redirect_uri: CALLBACK
						}),
						client.execute,
						Effect.flatMap(HttpClientResponse.schemaBodyJson(GitHubToken)),
						Effect.timeout('10 seconds')
					)
					const profile = yield* pipe(
						HttpClientRequest.get('https://api.github.com/user'),
						HttpClientRequest.bearerToken(token.access_token),
						HttpClientRequest.setHeaders(HEADERS),
						client.execute,
						Effect.flatMap(HttpClientResponse.schemaBodyJson(GitHubUser)),
						Effect.timeout('10 seconds')
					)
					return {flow, profile}
				}, asAuthError('GitHub sign-in failed')),
				start: Effect.fn('GitHub.start')(function* (flow: SignInParams) {
					const state = OAuthState.make(yield* nonce)
					const verifier = yield* nonce
					yield* flows.create(state, {...flow, verifier: Option.some(verifier)})
					const url = new URL('https://github.com/login/oauth/authorize')
					url.search = UrlParams.toString(
						UrlParams.fromInput({
							client_id: provider.clientId,
							code_challenge: yield* hash(verifier),
							code_challenge_method: 'S256',
							redirect_uri: CALLBACK,
							state
						})
					)
					return {state, url: url.href}
				}, asAuthError('Cannot start GitHub sign-in'))
			})
		})
	)
}
