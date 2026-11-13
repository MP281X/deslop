import {AnthropicClient, AnthropicLanguageModel} from '@effect/ai-anthropic'

import {Boolean, Config, Context, Effect, Function, Layer, Option, Schema} from 'effect'

import {AiError} from 'effect/ai'
import {HttpClient, HttpClientRequest} from 'effect/http'

import {localAuth} from '#server/auth.ts'
import {Sessions} from '#server/sessions.ts'
import type {AiProvider} from '#shared/ai.ts'

export class AiUnavailableError extends Schema.TaggedError<AiUnavailableError>()('AiUnavailableError', {
	cause: Schema.optional(Schema.Defect()),
	message: Schema.String
}) {}

type Refusal = typeof Refusal.Type
const Refusal = Schema.fromJsonString(Schema.Struct({error: Schema.Struct({message: Schema.String})}))

// Gateway's instruction reaches the person even when a provider client keeps it in an unknown error's body.
export function aiFailure(cause: unknown) {
	if (Schema.is(AiUnavailableError)(cause)) return Option.some(cause.message)
	if (!AiError.isAiError(cause)) return Option.none()
	if (cause.reason._tag === 'NetworkError') return Option.some(cause.reason.description ?? cause.reason.message)
	if (cause.reason._tag === 'UnknownError' && cause.reason.http?.body !== undefined) {
		return Option.map(Schema.decodeOption(Refusal)(cause.reason.http.body), body => body.error.message)
	}
	return Option.some(cause.reason.message)
}

export class AiGateway extends Context.Service<
	AiGateway,
	{
		apiUrl: (provider: AiProvider) => Effect.Effect<string, AiUnavailableError>
		authorize: (
			userId: string
		) => Effect.Effect<(client: HttpClient.HttpClient) => HttpClient.HttpClient, AiUnavailableError>
	}
>()('@deslop/runtime/server/ai/AiGateway') {
	static readonly languageModel = Effect.fn('AiGateway.languageModel')(function* (
		userId: string,
		options: {maxTokens: number}
	) {
		const gateway = yield* AiGateway
		const client = yield* AnthropicClient.make({
			apiUrl: yield* gateway.apiUrl('anthropic'),
			transformClient: yield* gateway.authorize(userId)
		})
		return yield* Effect.provideService(
			AnthropicLanguageModel.make({
				config: {max_tokens: options.maxTokens, output_config: {effort: 'high'}},
				model: 'claude-haiku-5-5'
			}),
			AnthropicClient.AnthropicClient,
			client
		)
	})
	static readonly layer = Layer.effect(
		this,
		Effect.gen(function* () {
			const gateway = yield* Config.option(Config.String('GATEWAY_URL'))
			const local = yield* localAuth
			const sessions = yield* Sessions
			function apiUrl(provider: AiProvider) {
				return Option.match(gateway, {
					onNone: () => Effect.fail(AiUnavailableError.make({message: 'Start the app with --gateway'})),
					onSome: url =>
						Effect.succeed(
							`${url}/ai/${provider}${Boolean.match(provider === 'openrouter', {onFalse: () => '', onTrue: () => '/v1'})}`
						)
				})
			}
			const authorize = Effect.fnUntraced(function* (userId: string) {
				if (local) return Function.identity<HttpClient.HttpClient>
				const token = yield* Effect.mapError(sessions.tokenOf(userId), cause =>
					AiUnavailableError.make({cause, message: cause.message})
				)
				return (client: HttpClient.HttpClient) => HttpClient.mapRequest(client, HttpClientRequest.bearerToken(token))
			})
			return AiGateway.of({apiUrl, authorize})
		})
	)
}
