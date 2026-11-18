import {Boolean, Cache, Config, Context, Effect, Exit, Function, Layer, Option, Redacted, pipe} from 'effect'

import {Digest, SecureRandom} from 'effect/crypto'
import {HttpClient, HttpClientError, HttpClientRequest, HttpClientResponse, UrlParams} from 'effect/http'

import {localAuth} from '@deslop/runtime/server/auth'
import {AuthError, DEVELOPER, GitHubId, asAuthError} from '@deslop/runtime/shared/auth'

import {hashOf, randomTokenOf} from '#services/crypto/lib/utils.ts'
import {accessTokenOf, pendingSignIns} from '#services/github/lib/utils.ts'
import {GitHubClientId, GitHubToken, GitHubOAuthState} from '#services/github/schema.ts'
import type {PendingSignIn, SignInParams} from '#services/github/schema.ts'
import {GitHubUser} from '#services/people/schema.ts'

const HEADERS = {accept: 'application/vnd.github+json', 'user-agent': '@deslop/auth'}
const DEVELOPER_PROFILE = GitHubUser.make({id: GitHubId.make(0), login: DEVELOPER.name, name: Option.none()})

function unavailable(message: string) {
	return Effect.mapError(cause => AuthError.make({cause, error: 'temporarily_unavailable', message}))
}

// GitHub proves who someone is. The step in between travels sealed in the browser's own login cookie for ten minutes, so no sign-in can push out another; an Auth restart drops the key and cancels it.
export class GitHub extends Context.Service<
	GitHub,
	{
		readonly finish: (code: string, pending: PendingSignIn) => Effect.Effect<GitHubUser, AuthError>
		readonly login: (login: string) => Effect.Effect<GitHubUser, AuthError>
		readonly resume: (state: GitHubOAuthState, sealed: string) => Effect.Effect<PendingSignIn, AuthError>
		readonly start: (
			flow: SignInParams
		) => Effect.Effect<{sealed: string; state: GitHubOAuthState; url: string}, AuthError>
	}
>()('@deslop/auth/services/github/service/GitHub') {
	static readonly layer = Layer.effect(
		GitHub,
		Effect.gen(function* () {
			const CALLBACK = new URL('/auth/github/callback', yield* Config.String('APP_URL')).href
			const sealing = yield* pendingSignIns
			const nonce = randomTokenOf(yield* SecureRandom.SecureRandom)(32)
			const resume = Effect.fn('GitHub.resume')(sealing.open)
			const start = Effect.fnUntraced(function* (flow: SignInParams) {
				const state = GitHubOAuthState.make(yield* nonce)
				const verifier = yield* nonce
				return {sealed: yield* sealing.seal(state, flow, verifier), state, verifier}
			})
			// Without an issuer there is no GitHub app: the GitHub step returns at once as the developer, an admin there.
			if (yield* localAuth) {
				return GitHub.of({
					finish: () => Effect.withSpan(Effect.succeed(DEVELOPER_PROFILE), 'GitHub.finish'),
					login: () => Effect.withSpan(Effect.succeed(DEVELOPER_PROFILE), 'GitHub.login'),
					resume,
					start: Effect.fn('GitHub.start')(function* (flow: SignInParams) {
						const started = yield* start(flow)
						return {
							sealed: started.sealed,
							state: started.state,
							url: `/auth/github/callback?${new URLSearchParams({code: 'development', state: started.state})}`
						}
					}, asAuthError('Cannot start GitHub sign-in'))
				})
			}
			const client = HttpClient.filterStatusOk(yield* HttpClient.HttpClient)
			const hash = hashOf(yield* Digest.Digest)
			const provider = yield* Config.all({
				clientId: Config.schema(GitHubClientId, 'GITHUB_CLIENT_ID'),
				secret: Config.Redacted('GITHUB_CLIENT_SECRET')
			})
			const user = Effect.fnUntraced(function* (request: HttpClientRequest.HttpClientRequest) {
				return yield* pipe(
					client.execute(HttpClientRequest.setHeaders(request, HEADERS)),
					Effect.flatMap(HttpClientResponse.schemaBodyJson(GitHubUser)),
					Effect.timeout('10 seconds')
				)
			})
			// GitHub answers 60 anonymous lookups an hour, and every tailnet request names its caller by login.
			const logins = yield* Cache.makeWith(
				(login: string) =>
					Effect.mapError(
						user(HttpClientRequest.get(`https://api.github.com/users/${encodeURIComponent(login)}`)),
						cause =>
							Boolean.match(HttpClientError.isHttpClientError(cause) && cause.response?.status === 404, {
								onFalse: () =>
									AuthError.make({cause, error: 'temporarily_unavailable', message: 'GitHub could not be reached'}),
								onTrue: () => AuthError.make({cause, message: 'GitHub no longer knows this login'})
							})
					),
				{
					capacity: 64,
					timeToLive: exit => Exit.match(exit, {onFailure: Function.constant(0), onSuccess: Function.constant('1 day')})
				}
			)
			return GitHub.of({
				finish: Effect.fn('GitHub.finish')(function* (code: string, pending: PendingSignIn) {
					const token = yield* pipe(
						HttpClientRequest.post('https://github.com/login/oauth/access_token'),
						HttpClientRequest.acceptJson,
						HttpClientRequest.bodyUrlParams({
							client_id: provider.clientId,
							client_secret: Redacted.value(provider.secret),
							code,
							code_verifier: pending.verifier,
							redirect_uri: CALLBACK
						}),
						client.execute,
						Effect.flatMap(HttpClientResponse.schemaBodyJson(GitHubToken)),
						Effect.timeout('10 seconds'),
						unavailable('GitHub could not finish the sign-in'),
						Effect.flatMap(accessTokenOf)
					)
					return yield* pipe(
						user(HttpClientRequest.bearerToken(HttpClientRequest.get('https://api.github.com/user'), token)),
						unavailable('GitHub could not read the account')
					)
				}),
				login: login => Cache.get(logins, login),
				resume,
				start: Effect.fn('GitHub.start')(function* (flow: SignInParams) {
					const started = yield* start(flow)
					const url = new URL('https://github.com/login/oauth/authorize')
					url.search = UrlParams.toString(
						UrlParams.fromInput({
							client_id: provider.clientId,
							code_challenge: yield* hash(started.verifier),
							code_challenge_method: 'S256',
							redirect_uri: CALLBACK,
							state: started.state
						})
					)
					return {sealed: started.sealed, state: started.state, url: url.href}
				}, asAuthError('Cannot start GitHub sign-in'))
			})
		})
	)
}
