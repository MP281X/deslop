import {Boolean, Config, Context, Effect, Function, Layer, Option, Schema} from 'effect'

import {AiError} from 'effect/ai'
import {HttpClient, HttpClientRequest} from 'effect/http'

import {localAuth} from '#server/auth.ts'
import {Sessions} from '#server/sessions.ts'
import type {AiProvider} from '#shared/ai.ts'

export class AiUnavailable extends Schema.TaggedError<AiUnavailable>()('AiUnavailable', {
	cause: Schema.optional(Schema.Defect()),
	message: Schema.String
}) {}

type Refusal = typeof Refusal.Type
const Refusal = Schema.fromJsonString(Schema.Struct({error: Schema.Struct({message: Schema.String})}))

// Gateway's instruction reaches the person even when a provider client keeps it in an unknown error's body.
export function aiFailure(cause: unknown) {
	if (Schema.is(AiUnavailable)(cause)) return Option.some(cause.message)
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
		apiUrl: (provider: AiProvider) => Effect.Effect<string, AiUnavailable>
		authorize: (
			userId: string
		) => Effect.Effect<(client: HttpClient.HttpClient) => HttpClient.HttpClient, AiUnavailable>
	}
>()('@deslop/runtime/server/ai/AiGateway') {
	static readonly layer = Layer.effect(
		this,
		Effect.gen(function* () {
			const gateway = yield* Config.option(Config.String('GATEWAY_URL'))
			const local = yield* localAuth
			const sessions = yield* Sessions
			return AiGateway.of({
				apiUrl: provider =>
					Option.match(gateway, {
						onNone: () => Effect.fail(AiUnavailable.make({message: 'Start the app with --gateway'})),
						onSome: url =>
							Effect.succeed(
								`${url}/ai/${provider}${Boolean.match(provider === 'openrouter', {onFalse: () => '', onTrue: () => '/v1'})}`
							)
					}),
				authorize: Effect.fnUntraced(function* (userId) {
					if (local) return Function.identity<HttpClient.HttpClient>
					const token = yield* Effect.mapError(sessions.tokenFor(userId), cause =>
						AiUnavailable.make({cause, message: cause.message})
					)
					return (client: HttpClient.HttpClient) => HttpClient.mapRequest(client, HttpClientRequest.bearerToken(token))
				})
			})
		})
	)
}
