import {NodeHttpClient} from '@effect/platform-node'
import Undici from '@effect/platform-node/Undici'

import {
	Boolean,
	Config,
	Context,
	DateTime,
	Duration,
	Effect,
	Exit,
	HashMap,
	Layer,
	Option,
	Redacted,
	Ref,
	Schema,
	String,
	pipe
} from 'effect'

import {Signature} from 'effect/crypto'
import {Base64} from 'effect/encoding'
import {HttpClient, HttpClientRequest, HttpClientResponse} from 'effect/http'
import {Jwk, Jws} from 'effect/jose'

import type {ApnsToken} from '#shared/apns.ts'
import {DateTimeUtcFromSeconds} from '#shared/time.ts'

type JwtClaims = typeof JwtClaims.Type
const JwtClaims = Schema.fromJsonString(Schema.Struct({iat: DateTimeUtcFromSeconds, iss: Schema.String}))

class ApnsError extends Schema.TaggedError<ApnsError>()('ApnsError', {
	cause: Schema.optional(Schema.Defect()),
	message: Schema.String
}) {}

export type ApnsAnswer = {channel: Option.Option<string>; reason: Option.Option<string>; status: number}
type Target = {bundle: string; production: boolean; token: Redacted.Redacted<ApnsToken>}

export const layerApnsClient = Layer.effect(
	HttpClient.HttpClient,
	Effect.gen(function* () {
		// APNs requires HTTP/2; the bundle exposes Undici's default export.
		const dispatcher = yield* Effect.acquireRelease(
			Effect.sync(() => new Undici.Agent({allowH2: true})),
			agent => Effect.promise(() => agent.destroy())
		)
		return yield* Effect.provideService(NodeHttpClient.makeUndici, NodeHttpClient.Dispatcher, dispatcher)
	})
)

export function apnsDeadToken(answer: ApnsAnswer) {
	return (
		answer.status === 410 ||
		Option.exists(answer.reason, reason => reason === 'BadDeviceToken' || reason === 'Unregistered')
	)
}

export function apnsAccepted(answer: ApnsAnswer) {
	return answer.status >= 200 && answer.status < 300
}

export function apnsRetryable(answer: ApnsAnswer) {
	return answer.status === 429 || answer.status >= 500
}

function asApnsError(message: string) {
	return Effect.mapError((cause: unknown) => ApnsError.make({cause, message}))
}

// Only the server owns signing and transport; the shared token schema has no native dependencies.
export class Apns extends Context.Service<Apns>()('@deslop/runtime/server/apns', {
	make: Effect.gen(function* () {
		const keyId = yield* Config.option(Config.String('APNS_KEY_ID'))
		const teamId = yield* Config.option(Config.String('APNS_TEAM_ID'))
		const privateKey = yield* Config.option(Config.Redacted('APNS_KEY'))
		const client = yield* HttpClient.HttpClient
		const withSignature = Effect.provideService(Signature.Signature, yield* Signature.Signature)
		const signer = Option.all({keyId, privateKey, teamId})
		if (Option.isNone(signer)) {
			yield* Effect.logWarning('No APNS_KEY, APNS_KEY_ID or APNS_TEAM_ID: pushes are off')
		}
		const signingKey = yield* Effect.cached(
			Effect.gen(function* () {
				const found = yield* Effect.fromOption(signer)
				const der = yield* Effect.fromResult(
					Base64.decode(String.replaceAll(/-----[^-]+-----|\\n|\s/gu, '')(Redacted.value(found.privateKey)))
				)
				return yield* Jwk.importPkcs8(Redacted.make(der), 'ES256', {kid: found.keyId})
			})
		)
		const retrying = yield* Ref.make(HashMap.empty<string, {answer: ApnsAnswer; until: DateTime.Utc}>())
		// Apple accepts a provider token for an hour and refuses one renewed more than every twenty minutes.
		const providerToken = yield* pipe(
			Effect.gen(function* () {
				const now = yield* DateTime.now
				const found = yield* Effect.fromOption(signer)
				return yield* Jws.sign(
					new TextEncoder().encode(yield* Schema.encodeEffect(JwtClaims)({iat: now, iss: found.teamId})),
					yield* signingKey,
					{kid: found.keyId}
				)
			}),
			asApnsError('The APNs key could not sign a token.'),
			Effect.cachedWithTTL(exit => Exit.match(exit, {onFailure: () => 0, onSuccess: () => '40 minutes'}))
		)
		const send = Effect.fn('Apns.send')(function* (
			request: HttpClientRequest.HttpClientRequest,
			notification?: string
		) {
			const now = yield* DateTime.now
			const key = notification ?? `${request.method} ${request.url} ${request.headers['apns-channel-id'] ?? ''}`
			const deferred = Option.getOrUndefined(
				pipe(
					yield* Ref.get(retrying),
					HashMap.get(key),
					Option.filter(pending => DateTime.isGreaterThan(pending.until, now))
				)
			)
			if (deferred !== undefined) return deferred.answer
			const response = yield* pipe(
				client.execute(
					HttpClientRequest.setHeader(request, 'authorization', `bearer ${Redacted.value(yield* providerToken)}`)
				),
				Effect.timeout('20 seconds'),
				asApnsError('APNs did not answer.')
			)
			const reason = yield* pipe(
				HttpClientResponse.schemaBodyJson(Schema.Struct({reason: Schema.String}))(response),
				Effect.map(body => Option.some(body.reason)),
				Effect.orElseSucceed(() => Option.none<string>())
			)
			if (response.status >= 300) {
				yield* Effect.logWarning(`APNs refused a push: ${response.status} ${Option.getOrElse(reason, () => '')}`)
			}
			const answer: ApnsAnswer = {
				channel: Option.fromNullishOr(response.headers['apns-channel-id']),
				reason,
				status: response.status
			}
			const receivedAt = yield* DateTime.now
			yield* Ref.update(retrying, pending => {
				const current = HashMap.filter(pending, entry => DateTime.isGreaterThan(entry.until, receivedAt))
				if (!apnsRetryable(answer)) return HashMap.remove(current, key)
				return HashMap.set(current, key, {
					answer,
					until: DateTime.addDuration(
						receivedAt,
						Boolean.match(answer.status >= 500, {
							onFalse: () => Duration.seconds(30),
							onTrue: () => Duration.minutes(15)
						})
					)
				})
			})
			return answer
		}, withSignature)
		return {
			enabled: Option.isSome(signer),
			isDeferred: Effect.fn('Apns.isDeferred')(function* (notification: string, now: DateTime.Utc) {
				return pipe(
					yield* Ref.get(retrying),
					HashMap.get(notification),
					Option.exists(pending => DateTime.isGreaterThan(pending.until, now))
				)
			}),
			send,
			sendToDevice(
				target: Target,
				type: 'alert' | 'liveactivity',
				body: unknown,
				priority: 5 | 10,
				notification?: string
			) {
				const host = Boolean.match(target.production, {
					onFalse: () => 'https://api.sandbox.push.apple.com',
					onTrue: () => 'https://api.push.apple.com'
				})
				return pipe(
					HttpClientRequest.post(`${host}/3/device/${Redacted.value(target.token)}`, {
						headers: {
							'apns-priority': `${priority}`,
							'apns-push-type': type,
							'apns-topic': Boolean.match(type === 'liveactivity', {
								onFalse: () => target.bundle,
								onTrue: () => `${target.bundle}.push-type.liveactivity`
							})
						}
					}),
					HttpClientRequest.bodyJson(body),
					Effect.flatMap(request => send(request, notification))
				)
			}
		}
	})
}) {
	static readonly layer = Layer.effect(this, this.make)
}
