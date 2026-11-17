import {AnthropicClient, AnthropicLanguageModel} from '@effect/ai-anthropic'

import {Config, Context, Effect, Layer, Option, Schema, pipe} from 'effect'

import {AiError} from 'effect/ai'
import {HttpClient, HttpClientRequest} from 'effect/http'

import {ON_BEHALF_HEADER} from '#shared/auth.ts'
import type {UserId} from '#shared/auth.ts'

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
	if (Schema.is(AiError.NetworkError)(cause.reason)) {
		return Option.some(cause.reason.description ?? cause.reason.message)
	}
	if (Schema.is(AiError.UnknownError)(cause.reason) && cause.reason.http?.body !== undefined) {
		return Option.some(
			Option.match(Schema.decodeOption(Refusal)(cause.reason.http.body), {
				onNone: () => cause.reason.message,
				onSome: body => body.error.message
			})
		)
	}
	return Option.some(cause.reason.message)
}

export class AiGateway extends Context.Service<
	AiGateway,
	{
		apiUrl: Effect.Effect<string, AiUnavailableError>
		authorize: (
			userId: UserId
		) => Effect.Effect<(client: HttpClient.HttpClient) => HttpClient.HttpClient, AiUnavailableError>
	}
>()('@deslop/runtime/server/ai/AiGateway') {
	static readonly languageModel = Effect.fn('AiGateway.languageModel')(function* (
		userId: UserId,
		options: {maxTokens: number}
	) {
		yield* Effect.annotateCurrentSpan({maxTokens: options.maxTokens, userId})
		const gateway = yield* AiGateway
		// Gateway sends Messages to Anthropic with the person's saved API key; callers never receive it.
		const client = yield* AnthropicClient.make({
			apiUrl: `${yield* gateway.apiUrl}/anthropic`,
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
			const apiUrl = pipe(
				yield* Config.option(Config.String('GATEWAY_URL')),
				Option.match({
					onNone: () => Effect.fail(AiUnavailableError.make({message: 'Start the app with --domain'})),
					onSome: url => Effect.succeed(`${url}/ai`)
				}),
				Effect.withSpan('AiGateway.apiUrl')
			)
			const authorize = Effect.fn('AiGateway.authorize')(function* (userId: UserId) {
				yield* Effect.annotateCurrentSpan('userId', userId)
				// Gateway trusts this claim only from an app on Auth's machine, and charges the person's own key.
				return (client: HttpClient.HttpClient) =>
					HttpClient.mapRequest(client, HttpClientRequest.setHeader(ON_BEHALF_HEADER, userId))
			})
			return AiGateway.of({apiUrl, authorize})
		})
	)
}
