import {
	Boolean,
	Cache,
	Config,
	Context,
	Duration,
	Effect,
	Exit,
	Function,
	Layer,
	Option,
	Redacted,
	Semaphore,
	Struct,
	pipe
} from 'effect'

import {Digest, SecureRandom} from 'effect/crypto'
import {HttpClient, HttpClientError, HttpClientRequest, HttpClientResponse, UrlParams} from 'effect/http'

import {localAuth} from '@deslop/runtime/server/auth'
import {AuthError, DEVELOPER, GitHubId, asAuthError} from '@deslop/runtime/shared/auth'

import {hashOf, randomTokenOf} from '#services/crypto/lib/utils.ts'
import {GitHubClientId, GitHubToken, GitHubOAuthState} from '#services/github/schema.ts'
import type {SignInParams} from '#services/github/schema.ts'
import {GitHubUser} from '#services/people/schema.ts'

const HEADERS = {accept: 'application/vnd.github+json', 'user-agent': '@deslop/auth'}
const DEVELOPER_PROFILE = GitHubUser.make({id: GitHubId.make(0), login: DEVELOPER.name, name: Option.none()})

// GitHub proves who someone is; the step in between lives here for ten minutes, and an Auth restart cancels it.
export class GitHub extends Context.Service<
	GitHub,
	{
		readonly finish: (
			code: string,
			state: GitHubOAuthState
		) => Effect.Effect<{flow: SignInParams; profile: GitHubUser}, AuthError>
		readonly login: (login: string) => Effect.Effect<GitHubUser, AuthError>
		readonly start: (flow: SignInParams) => Effect.Effect<{state: GitHubOAuthState; url: string}, AuthError>
	}
>()('@deslop/auth/services/github/service/GitHub') {
	static readonly layer = Layer.effect(
		GitHub,
		Effect.gen(function* () {
			const CALLBACK = new URL('/auth/github/callback', yield* Config.String('APP_URL')).href
			// A pending sign-in can be discarded without signing anyone out.
			const flows = yield* Cache.make<GitHubOAuthState, SignInParams & {verifier: Option.Option<string>}, AuthError>({
				capacity: 64,
				lookup: () => Effect.fail(AuthError.make({message: 'The sign-in expired'})),
				timeToLive: Duration.minutes(10)
			})
			const callbacks = yield* Semaphore.make(1)
			const nonce = randomTokenOf(yield* SecureRandom.SecureRandom)(32)
			const take = Effect.fnUntraced(function* (state: GitHubOAuthState) {
				return yield* pipe(
					Cache.getOption(flows, state),
					Effect.tap(() => Cache.invalidate(flows, state)),
					Effect.flatMap(Effect.fromOption),
					Effect.mapError(() => AuthError.make({message: 'The sign-in expired'})),
					Effect.uninterruptible,
					Semaphore.withPermit(callbacks)
				)
			})
			// Without an issuer there is no GitHub app: the GitHub step returns at once as the developer, an admin there.
			if (yield* localAuth) {
				return GitHub.of({
					finish: Effect.fn('GitHub.finish')(function* (_code: string, state: GitHubOAuthState) {
						return {flow: Struct.omit(yield* take(state), ['verifier']), profile: DEVELOPER_PROFILE}
					}),
					login: () => Effect.withSpan(Effect.succeed(DEVELOPER_PROFILE), 'GitHub.login'),
					start: Effect.fn('GitHub.start')(function* (flow: SignInParams) {
						const state = GitHubOAuthState.make(yield* nonce)
						yield* Cache.set(flows, state, {...flow, verifier: Option.none()})
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
				finish: Effect.fn('GitHub.finish')(function* (code: string, state: GitHubOAuthState) {
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
					const profile = yield* user(
						HttpClientRequest.bearerToken(HttpClientRequest.get('https://api.github.com/user'), token.access_token)
					)
					return {flow, profile}
				}, asAuthError('GitHub sign-in failed')),
				login: login => Cache.get(logins, login),
				start: Effect.fn('GitHub.start')(function* (flow: SignInParams) {
					const state = GitHubOAuthState.make(yield* nonce)
					const verifier = yield* nonce
					yield* Cache.set(flows, state, {...flow, verifier: Option.some(verifier)})
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
