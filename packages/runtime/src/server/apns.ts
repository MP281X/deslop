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
	Struct,
	pipe
} from 'effect'

import {Signature} from 'effect/crypto'
import {Base64} from 'effect/encoding'
import {HttpClient, HttpClientRequest, HttpClientResponse} from 'effect/http'
import {Jwk, Jws} from 'effect/jose'

import {DEVELOPMENT_BUNDLE_SUFFIX} from '#config/expo.ts'
import type {ApnsToken} from '#shared/apns.ts'
import {DateTimeUtcFromSeconds} from '#shared/time.ts'

type JwtClaims = typeof JwtClaims.Type
const JwtClaims = Schema.fromJsonString(Schema.Struct({iat: DateTimeUtcFromSeconds, iss: Schema.String}))

class ApnsError extends Schema.TaggedError<ApnsError>()('ApnsError', {
	cause: Schema.optional(Schema.Defect()),
	message: Schema.String
}) {}

export type ApnsAnswer = {channel: Option.Option<string>; reason: Option.Option<string>; status: number}
type Target = {bundle: string; token: Redacted.Redacted<ApnsToken>}
type Payload = {aps: Record<string, unknown>; [key: string]: unknown}

function hostsOf(bundle: string) {
	if (String.endsWith(DEVELOPMENT_BUNDLE_SUFFIX)(bundle)) {
		return {
			channels: 'https://api-manage-broadcast.sandbox.push.apple.com:2195',
			devices: 'https://api.sandbox.push.apple.com'
		}
	}
	return {channels: 'https://api-manage-broadcast.push.apple.com:2196', devices: 'https://api.push.apple.com'}
}

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
		const deferred = Effect.fnUntraced(function* (key: string) {
			const now = yield* DateTime.now
			return pipe(
				yield* Ref.get(retrying),
				HashMap.get(key),
				Option.filter(pending => DateTime.isGreaterThan(pending.until, now)),
				Option.map(pending => pending.answer)
			)
		})
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
		const send = Effect.fnUntraced(function* (request: HttpClientRequest.HttpClientRequest, notification?: string) {
			const key = notification ?? `${request.method} ${request.url} ${request.headers['apns-channel-id'] ?? ''}`
			const pending = Option.getOrUndefined(yield* deferred(key))
			if (pending !== undefined) return pending
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
			yield* Ref.update(retrying, cached => {
				const current = HashMap.filter(cached, entry => DateTime.isGreaterThan(entry.until, receivedAt))
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
		})
		const createChannel = Effect.fn('Apns.createChannel')(function* (bundle: string) {
			const answer = yield* pipe(
				HttpClientRequest.post(`${hostsOf(bundle).channels}/1/apps/${bundle}/channels`),
				HttpClientRequest.bodyJson({'message-storage-policy': 1, 'push-type': 'LiveActivity'}),
				Effect.flatMap(request => send(request))
			)
			return yield* pipe(answer.channel, Effect.fromOption, asApnsError(`APNs created no channel: ${answer.status}`))
		}, withSignature)
		const deleteChannel = Effect.fn('Apns.deleteChannel')(
			(bundle: string, channel: string) =>
				Effect.ignore(
					send(
						HttpClientRequest.delete(`${hostsOf(bundle).channels}/1/apps/${bundle}/channels`, {
							headers: {'apns-channel-id': channel}
						})
					),
					{log: 'Warn', message: 'A finished activity channel was not deleted'}
				),
			withSignature
		)
		const sendToDevice = Effect.fn('Apns.sendToDevice')(function* (
			target: Target,
			type: 'alert' | 'liveactivity',
			body: Payload,
			priority: 5 | 10
		) {
			const url = `${hostsOf(target.bundle).devices}/3/device/${Redacted.value(target.token)}`
			const starting = type === 'liveactivity' && body.aps['event'] === 'start'
			// ActivityKit attributes identify a start; rotating content and timestamps must not bypass its backoff.
			const key = yield* Boolean.match(starting, {
				onFalse: () => Effect.succeed(`POST ${url} `),
				onTrue: () =>
					Effect.map(
						Schema.encodeEffect(Schema.fromJsonString(Schema.Unknown))(body.aps['attributes']),
						attributes => `start ${url} ${attributes}`
					)
			})
			const pending = Option.getOrUndefined(yield* deferred(key))
			if (pending !== undefined) return pending
			const channel = yield* Boolean.match(starting, {
				onFalse: () => Effect.succeed(Option.none<string>()),
				onTrue: () => Effect.asSome(createChannel(target.bundle))
			})
			const payload = Option.match(channel, {
				onNone: () => body,
				onSome: id => ({
					...body,
					aps: {
						...Struct.omit(body.aps, ['relevance-score', 'timestamp']),
						'input-push-channel': id,
						'relevance-score': body.aps['relevance-score'],
						timestamp: body.aps['timestamp']
					}
				})
			})
			const request = yield* HttpClientRequest.bodyJson(
				HttpClientRequest.post(url, {
					headers: {
						'apns-priority': `${priority}`,
						'apns-push-type': type,
						'apns-topic': Boolean.match(type === 'liveactivity', {
							onFalse: () => target.bundle,
							onTrue: () => `${target.bundle}.push-type.liveactivity`
						})
					}
				}),
				payload
			)
			const cleanup = Option.match(channel, {onNone: () => Effect.void, onSome: id => deleteChannel(target.bundle, id)})
			const answer = yield* Effect.onError(send(request, key), () => cleanup)
			if (!apnsAccepted(answer)) yield* cleanup
			return {...answer, channel: Option.orElse(channel, () => answer.channel)}
		}, withSignature)
		return {
			broadcast: Effect.fn('Apns.broadcast')(function* (
				bundle: string,
				channel: string,
				aps: Record<string, unknown>,
				priority: 5 | 10,
				now: DateTime.Utc
			) {
				return yield* pipe(
					HttpClientRequest.post(`${hostsOf(bundle).devices}/4/broadcasts/apps/${bundle}`, {
						headers: {
							'apns-channel-id': channel,
							'apns-expiration': `${DateTime.toEpochSeconds(DateTime.addDuration(now, Duration.hours(8)))}`,
							'apns-priority': `${priority}`,
							'apns-push-type': 'liveactivity'
						}
					}),
					HttpClientRequest.bodyJson({aps}),
					Effect.flatMap(request => send(request))
				)
			}, withSignature),
			createChannel,
			deleteChannel,
			enabled: Option.isSome(signer),
			sendToDevice
		}
	})
}) {
	static readonly layer = Layer.effect(this, this.make)
}
