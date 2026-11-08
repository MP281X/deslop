import {Boolean, Config, Context, Effect, Layer, Option, Record, Redacted, Ref, Schema, Semaphore, pipe} from 'effect'

import type {Headers} from 'effect/http'
import {HttpClient, HttpClientError, HttpClientRequest, HttpClientResponse} from 'effect/http'
import {KeyValueStore} from 'effect/persistence'

import {localAuth} from '#auth/lib/utils.ts'

export type AiProvider = typeof AiProvider.Type
export const AiProvider = Schema.Literals(['anthropic', 'openrouter', 'opencode-zen', 'opencode-go'])

export class AiUnavailable extends Schema.TaggedError<AiUnavailable>()('AiUnavailable', {message: Schema.String}) {}

export class AiGateway extends Context.Service<
	AiGateway,
	{
		apiUrl: (provider: AiProvider) => Effect.Effect<string, AiUnavailable>
		authorize: (userId: string) => (client: HttpClient.HttpClient) => HttpClient.HttpClient
		enroll: (userId: string, headers: Headers.Headers) => Effect.Effect<void>
	}
>()('@deslop/runtime/ai/AiGateway') {
	static readonly layer = Layer.effect(
		this,
		Effect.gen(function* () {
			const gateway = yield* Config.option(Config.String('GATEWAY_URL'))
			const local = yield* localAuth
			const app = yield* Config.String('APP_URL')
			const client = yield* HttpClient.HttpClient
			const store = KeyValueStore.toSchemaStore(
				yield* KeyValueStore.KeyValueStore,
				Schema.Record(Schema.String, Schema.RedactedFromValue(Schema.String))
			)
			const grants = yield* Ref.make<Record<string, Redacted.Redacted<string>>>(
				Option.getOrElse(yield* store.get('ai-gateway-grants'), () => ({}))
			)
			const lock = yield* Semaphore.make(1)
			return AiGateway.of({
				apiUrl: provider =>
					Option.match(gateway, {
						onNone: () => Effect.fail(new AiUnavailable({message: 'Start the app with --gateway'})),
						onSome: url =>
							Effect.succeed(
								`${url}/ai/${provider}${Boolean.match(provider === 'openrouter', {onFalse: () => '', onTrue: () => '/v1'})}`
							)
					}),
				authorize: userId => http =>
					pipe(
						HttpClient.mapRequestEffect(http, request =>
							Effect.gen(function* () {
								if (local) return request
								const token = (yield* Ref.get(grants))[userId]
								if (!token) {
									return yield* Effect.fail(
										new HttpClientError.HttpClientError({
											reason: new HttpClientError.TransportError({
												description: 'AI access is unavailable; sign in again to enroll with Gateway',
												request
											})
										})
									)
								}
								return HttpClientRequest.setHeader(request, 'authorization', `Bearer ${Redacted.value(token)}`)
							})
						),
						HttpClient.tap(response =>
							pipe(
								Effect.gen(function* () {
									if (
										local ||
										response.status !== 401 ||
										!Option.exists(gateway, url => response.request.url.startsWith(`${url}/ai/`))
									) {
										return
									}
									const current = yield* Ref.get(grants)
									const token = current[userId]
									if (!token || response.request.headers['authorization'] !== `Bearer ${Redacted.value(token)}`) return
									const next = Record.remove(current, userId)
									yield* pipe(
										store.set('ai-gateway-grants', next),
										Effect.ignore({log: 'Warn', message: 'The rejected AI grant could not be removed from storage'})
									)
									yield* Ref.set(grants, next)
								}),
								Semaphore.withPermit(lock)
							)
						)
					),
				enroll: Effect.fnUntraced(function* (userId, headers) {
					return yield* pipe(
						Effect.gen(function* () {
							if (local || Option.isNone(gateway) || (yield* Ref.get(grants))[userId]) return
							const response = yield* client.execute(
								yield* HttpClientRequest.bodyJson(
									HttpClientRequest.post(`${Option.getOrElse(gateway, () => '')}/ai/grants`, {
										headers: Boolean.match(headers['authorization'] !== undefined, {
											onFalse: () => ({cookie: headers['cookie'] ?? ''}),
											onTrue: () => ({authorization: headers['authorization']})
										})
									}),
									{app}
								)
							)
							const result = yield* HttpClientResponse.schemaBodyJson(Schema.Struct({token: Schema.String}))(response)
							const next = {...(yield* Ref.get(grants)), [userId]: Redacted.make(result.token)}
							yield* store.set('ai-gateway-grants', next)
							yield* Ref.set(grants, next)
						}),
						Semaphore.withPermit(lock),
						Effect.timeout('10 seconds'),
						Effect.catch(() => Effect.logWarning('AI Gateway enrollment failed'))
					)
				})
			})
		})
	)
}
