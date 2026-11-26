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
	Function,
	HashMap,
	Layer,
	Option,
	Predicate,
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

import {ApnsAnswer, ApnsError, apnsAnswer, deviceHeaders, tooLargeAnswer} from '#shared/apns.ts'
import type {ApnsPriority, ApnsPushType, ApnsToken} from '#shared/apns.ts'
import {DateTimeUtcFromSeconds} from '#shared/time.ts'

type JwtClaims = typeof JwtClaims.Type
const JwtClaims = Schema.fromJsonString(Schema.Struct({iat: DateTimeUtcFromSeconds, iss: Schema.String}))

type Target = {bundle: string; token: Redacted.Redacted<ApnsToken>}
type Payload = {aps: Record<string, unknown>; [key: string]: unknown}

function hostsOf(bundle: string) {
	if (String.endsWith('.dev')(bundle)) {
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

function asApnsError(message: string) {
	// Signing and HTTP failures can embed the private key, bearer or device token.
	return Effect.mapError(() => ApnsError.make({message}))
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
		const [providerToken, renewProviderToken] = yield* pipe(
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
			Effect.cachedInvalidateWithTTL(exit =>
				Exit.match(exit, {onFailure: Function.constant(0), onSuccess: Function.constant('40 minutes')})
			)
		)
		const oversized = Effect.fnUntraced(function* (request: HttpClientRequest.HttpClientRequest) {
			if (!Predicate.isTagged(request.body, 'Uint8Array')) return Option.none()
			const answer = tooLargeAnswer(request.body.contentLength)
			if (Option.isSome(answer)) {
				yield* Effect.logWarning(`An APNs payload of ${request.body.contentLength} bytes was not sent`)
			}
			return answer
		})
		const send = Effect.fnUntraced(function* (request: HttpClientRequest.HttpClientRequest, notification?: string) {
			const key = notification ?? `${request.method} ${request.url} ${request.headers['apns-channel-id'] ?? ''}`
			const pending = Option.getOrUndefined(yield* deferred(key))
			if (pending !== undefined) return pending
			const tooLarge = Option.getOrUndefined(yield* oversized(request))
			if (tooLarge !== undefined) return tooLarge
			const token = Redacted.value(yield* providerToken)
			const response = yield* pipe(
				client.execute(HttpClientRequest.setHeader(request, 'authorization', `bearer ${token}`)),
				Effect.provideService(HttpClient.TracerDisabledWhen, outgoing => String.includes('/3/device/')(outgoing.url)),
				Effect.timeout('20 seconds'),
				asApnsError('APNs did not answer.')
			)
			const reason = yield* pipe(
				HttpClientResponse.schemaBodyJson(Schema.Struct({reason: Schema.String}))(response),
				Effect.map(body => body.reason),
				Effect.option
			)
			if (response.status >= 300) {
				yield* Effect.logWarning(
					`APNs refused a push: ${response.status} ${Option.getOrElse(reason, Function.constant(''))}`
				)
			}
			// Concurrent sends that all met the expired token renew it once.
			if (Option.contains(reason, 'ExpiredProviderToken') && Redacted.value(yield* providerToken) === token) {
				yield* renewProviderToken
			}
			const answer = apnsAnswer({
				channel: Option.fromNullishOr(response.headers['apns-channel-id']),
				reason,
				status: response.status
			})
			const receivedAt = yield* DateTime.now
			yield* Ref.update(retrying, cached => {
				const current = HashMap.filter(cached, entry => DateTime.isGreaterThan(entry.until, receivedAt))
				if (!ApnsAnswer.isAnyOf(['Retry'])(answer)) return HashMap.remove(current, key)
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
				asApnsError('The channel request could not be written.'),
				Effect.flatMap(request => send(request))
			)
			return yield* pipe(answer.channel, Effect.fromOption, asApnsError(`APNs created no channel: ${answer.status}`))
		}, withSignature)
		// Only `Retry` leaves the channel to delete again; Apple's other answers are final.
		const deleteChannel = Effect.fn('Apns.deleteChannel')(
			(bundle: string, channel: string) =>
				send(
					HttpClientRequest.delete(`${hostsOf(bundle).channels}/1/apps/${bundle}/channels`, {
						headers: {'apns-channel-id': channel}
					})
				),
			withSignature
		)
		function deviceRequest(
			target: Target,
			type: ApnsPushType,
			body: Payload,
			priority: ApnsPriority,
			collapseId?: string
		) {
			return pipe(
				HttpClientRequest.bodyJson(
					HttpClientRequest.post(`${hostsOf(target.bundle).devices}/3/device/${Redacted.value(target.token)}`, {
						headers: deviceHeaders(target.bundle, type, priority, collapseId)
					}),
					body
				),
				asApnsError('The device push request could not be written.')
			)
		}
		const sendToDevice = Effect.fn('Apns.sendToDevice')(
			(target: Target, type: ApnsPushType, body: Payload, priority: ApnsPriority, collapseId?: string) =>
				Effect.flatMap(deviceRequest(target, type, body, priority, collapseId), request => send(request)),
			withSignature
		)
		// Attributes identify the booking, while the leg distinguishes its departure and arrival activities.
		const startKey = Effect.fnUntraced(function* (target: Target, leg: string, body: Payload) {
			const attributes = yield* pipe(
				Schema.encodeEffect(Schema.fromJsonString(Schema.Unknown))(body.aps['attributes']),
				asApnsError('The activity attributes could not be written.')
			)
			return `start ${target.bundle} ${Redacted.value(target.token)} ${attributes} ${leg}`
		})
		function startRequest(target: Target, body: Payload, channel: string) {
			return deviceRequest(
				target,
				'liveactivity',
				{
					...body,
					aps: {
						...Struct.omit(body.aps, ['relevance-score', 'timestamp']),
						'input-push-channel': channel,
						'relevance-score': body.aps['relevance-score'],
						timestamp: body.aps['timestamp']
					}
				},
				10
			)
		}
		return {
			broadcast: Effect.fn('Apns.broadcast')(function* (
				bundle: string,
				channel: string,
				aps: Record<string, unknown>,
				priority: ApnsPriority,
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
					asApnsError('The broadcast request could not be written.'),
					Effect.flatMap(request => send(request))
				)
			}, withSignature),
			createChannel,
			deleteChannel,
			enabled: Option.isSome(signer),
			sendToDevice,
			// Starts the activity on a channel the caller created and wrote down; deleting the channel is the caller's.
			startActivity: Effect.fn('Apns.startActivity')(function* (
				target: Target,
				leg: string,
				channel: string,
				body: Payload
			) {
				return yield* send(yield* startRequest(target, body, channel), yield* startKey(target, leg, body))
			}, withSignature),
			// The answer a start gets without asking Apple, which is the retry it was given a moment ago, or too large, for which no channel is created.
			startHeld: Effect.fn('Apns.startHeld')(function* (target: Target, leg: string, body: Payload) {
				const pending = Option.getOrUndefined(yield* deferred(yield* startKey(target, leg, body)))
				if (pending !== undefined) return Option.some(pending)
				// Without its channel id, which is all a start has before its channel exists.
				return yield* oversized(yield* startRequest(target, body, ''))
			})
		}
	})
}) {
	static readonly layer = Layer.effect(this, this.make)
}
