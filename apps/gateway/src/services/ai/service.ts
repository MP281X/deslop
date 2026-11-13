import type {Record} from 'effect'
import {
	Array,
	Boolean,
	Clock,
	Context,
	Effect,
	Exit,
	Function,
	Layer,
	MutableList,
	Option,
	Redacted,
	Ref,
	Result,
	Schema,
	Scope,
	Semaphore,
	Stream,
	String,
	SubscriptionRef,
	pipe
} from 'effect'

import {Sse} from 'effect/encoding'
import {
	Headers,
	HttpClient,
	HttpClientRequest,
	HttpClientResponse,
	HttpServerRequest,
	HttpServerResponse
} from 'effect/http'
import {KeyValueStore} from 'effect/persistence'

import {Auth, localAuth} from '@deslop/runtime/server/auth'
import {dataDirectory} from '@deslop/runtime/server/store'
import {AuthError, bearerOf, failureOptions, isJwt} from '@deslop/runtime/shared/auth'

import {makeUsage, readUsage} from './usage.ts'

import type {AiProvider, AiUsageEntry} from '#services/ai/schema.ts'
import {AiStoredKey, ModelsCatalog, PROVIDER_NAMES} from '#services/ai/schema.ts'
import {usageWindow} from '#services/usage/lib/utils.ts'
import type {Period} from '#services/usage/schema.ts'

const UPSTREAMS = {
	anthropic: 'https://api.anthropic.com',
	'opencode-go': 'https://opencode.ai/inference/go',
	'opencode-zen': 'https://opencode.ai/inference',
	openrouter: 'https://openrouter.ai/api'
}
const HOP_BY_HOP = [
	'connection',
	'keep-alive',
	'proxy-authenticate',
	'proxy-authorization',
	'te',
	'trailer',
	'transfer-encoding',
	'upgrade'
]
const FORBIDDEN = ['authorization', 'x-api-key', 'cookie', 'host', ...HOP_BY_HOP]
const failed = Effect.mapError((cause: unknown) =>
	AuthError.make({cause, error: 'temporarily_unavailable', message: 'AI Gateway storage failed'})
)

function make(directory: string) {
	return Effect.gen(function* () {
		const keys = KeyValueStore.toSchemaStore(yield* KeyValueStore.KeyValueStore, Schema.Array(AiStoredKey))
		const usage = yield* makeUsage(directory)
		// Each person's recorded calls wake only that person's open reader; reads coalesce, so one report goes out at most each second.
		const usageChanged = yield* SubscriptionRef.make<Record<string, number>>({})
		const auth = yield* Auth
		const local = yield* localAuth
		const client = yield* HttpClient.HttpClient
		const scope = yield* Scope.Scope
		const lock = yield* Semaphore.make(1)
		const pricing = yield* Ref.make<ModelsCatalog>({})
		const refreshPricing = yield* pipe(
			client.get('https://models.dev/api.json'),
			Effect.flatMap(HttpClientResponse.schemaBodyJson(ModelsCatalog)),
			Effect.timeout('10 seconds'),
			Effect.tap(catalog => Ref.set(pricing, catalog)),
			Effect.tapError(error =>
				Effect.logWarning('The pricing catalog could not be refreshed; keeping cached pricing', error)
			),
			Effect.option,
			Effect.cachedWithTTL(exit => {
				if (Exit.isSuccess(exit) && Option.isSome(exit.value)) return '1 day'
				return 0
			})
		)
		function loadKeys(id: string) {
			return pipe(keys.get(`ai-keys/${id}`), Effect.map(Option.getOrElse(() => [])), failed)
		}
		const updateKeys = Effect.fnUntraced(function* (
			id: string,
			update: (current: readonly AiStoredKey[]) => AiStoredKey[]
		) {
			yield* pipe(
				Effect.gen(function* () {
					yield* keys.set(`ai-keys/${id}`, update(yield* loadKeys(id)))
				}),
				Semaphore.withPermit(lock),
				failed
			)
		})
		const saveUsage = Effect.fnUntraced(function* (id: string, entry: AiUsageEntry) {
			const metered = {entry}
			if (
				entry.costSource !== 'provider' &&
				entry.model !== undefined &&
				entry.inputTokens + entry.outputTokens + entry.cacheReadTokens + entry.cacheWriteTokens > 0
			) {
				// Calls finishing together share one refresh, even when it fails.
				yield* refreshPricing
				const catalog = yield* Ref.get(pricing)
				const catalogProvider = Boolean.match(entry.provider === 'opencode-zen', {
					onFalse: () => entry.provider,
					onTrue: () => 'opencode'
				})
				const cost = catalog[catalogProvider]?.models[entry.model]?.cost
				if (cost !== undefined) {
					if (
						(entry.cacheReadTokens === 0 || cost.cache_read !== undefined) &&
						(entry.cacheWriteTokens === 0 || cost.cache_write !== undefined)
					) {
						metered.entry = {
							...entry,
							costSource: 'models.dev',
							costUsd:
								(entry.inputTokens * cost.input +
									entry.outputTokens * cost.output +
									entry.cacheReadTokens * (cost.cache_read ?? 0) +
									entry.cacheWriteTokens * (cost.cache_write ?? 0)) /
								1_000_000
						}
					}
				}
			}
			yield* pipe(usage.save(id, metered.entry), Semaphore.withPermit(lock))
			yield* SubscriptionRef.update(usageChanged, versions => ({...versions, [id]: (versions[id] ?? 0) + 1}))
		})
		return {
			keys: (id: string) =>
				Effect.map(loadKeys(id), entries =>
					Array.map(entries, key => ({last4: key.last4, lastStatus: key.lastStatus, provider: key.provider}))
				),
			proxy: Effect.fnUntraced(function* (provider: AiProvider, rest: string) {
				const request = yield* HttpServerRequest.HttpServerRequest
				const now = yield* Clock.currentTimeMillis
				// Only an access token Auth signed spends a key, never a session on Gateway's own pages.
				if (!local && !Option.exists(bearerOf(request.headers), isJwt)) {
					return HttpServerResponse.jsonUnsafe({error: {message: 'Sign in first'}}, {status: 401})
				}
				const person = yield* Effect.result(auth.user(request.headers))
				if (Result.isFailure(person)) {
					return HttpServerResponse.jsonUnsafe(
						{error: {message: person.failure.message}},
						failureOptions(person.failure, 401)
					)
				}
				const id = person.success.id
				const key = Option.getOrUndefined(Array.findFirst(yield* loadKeys(id), value => value.provider === provider))
				if (key === undefined) {
					return HttpServerResponse.jsonUnsafe(
						{error: {message: `Add your ${PROVIDER_NAMES[provider]} key in Gateway`}},
						{status: 402}
					)
				}
				const headers = Headers.removeMany(request.headers, [
					...FORBIDDEN,
					...Array.map(String.split(',')(request.headers['connection'] ?? ''), value =>
						String.toLowerCase(String.trim(value))
					)
				])
				const outgoing = {
					model: Option.none<string>(),
					request: HttpClientRequest.make(
						yield* Schema.decodeUnknownEffect(
							Schema.Literals(['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD', 'OPTIONS'])
						)(request.method)
					)(`${UPSTREAMS[provider]}/${rest}`, {
						headers: Boolean.match(provider === 'anthropic', {
							onFalse: () => Headers.set(headers, 'authorization', `Bearer ${Redacted.value(key.secret)}`),
							onTrue: () => Headers.set(headers, 'x-api-key', Redacted.value(key.secret))
						})
					})
				}
				if (request.method !== 'GET' && request.method !== 'HEAD') {
					if (String.includes('application/json')(request.headers['content-type'] ?? '')) {
						const body = new Uint8Array(yield* request.arrayBuffer)
						const decoded = Schema.decodeOption(
							Schema.fromJsonString(Schema.Struct({model: Schema.optionalKey(Schema.String)}))
						)(new TextDecoder().decode(body))
						outgoing.model = Option.flatMap(decoded, value => Option.fromUndefinedOr(value.model))
						outgoing.request = HttpClientRequest.bodyUint8Array(outgoing.request, body, request.headers['content-type'])
					} else {
						outgoing.request = HttpClientRequest.bodyStream(outgoing.request, request.stream, {
							contentType: request.headers['content-type']
						})
					}
				}
				const response = yield* client.execute(outgoing.request)
				yield* pipe(
					Effect.gen(function* () {
						yield* keys.set(
							`ai-keys/${id}`,
							Array.map(yield* loadKeys(id), value => {
								if (value.provider === provider && Redacted.value(value.secret) === Redacted.value(key.secret)) {
									return {...value, lastStatus: response.status}
								}
								return value
							})
						)
					}),
					Semaphore.withPermit(lock)
				)
				const web = Option.getOrUndefined(HttpClientResponse.toWeb(response))
				const body = web?.body ?? (yield* Stream.toReadableStreamEffect(response.stream))
				const [forward, meter] = body.tee()
				const entry: AiUsageEntry = {
					app: person.success.client ?? 'local',
					at: now,
					cacheReadTokens: 0,
					cacheWriteTokens: 0,
					costSource: 'unknown',
					inputTokens: 0,
					model: Option.getOrUndefined(outgoing.model),
					outputTokens: 0,
					provider
				}
				yield* pipe(
					Effect.gen(function* () {
						const state = {current: entry, pending: ''}
						const updateUsage = Effect.fnUntraced(function* (text: string) {
							state.current = yield* pipe(
								Effect.fromResult(readUsage(text, state.current)),
								Effect.catch(error =>
									Effect.as(
										Effect.logWarning('AI usage was malformed; keeping previously read usage', error),
										state.current
									)
								)
							)
						})
						const sse = String.includes('text/event-stream')(response.headers['content-type'] ?? '')
						const stream = Stream.fromReadableStream({
							evaluate: () => meter,
							onError: cause =>
								AuthError.make({cause, error: 'temporarily_unavailable', message: 'AI usage could not be read'})
						})
						if (sse) {
							const events = MutableList.make<string>()
							const parser = Sse.makeParser(event => {
								if (event._tag === 'Event') MutableList.append(events, event.data)
							})
							const feed = Effect.fnUntraced(function* (text: string) {
								const error = parser.feed(text)
								for (const data of MutableList.toArray(events)) yield* updateUsage(data)
								MutableList.clear(events)
								if (error !== undefined) return yield* error
							})
							yield* pipe(
								stream,
								Stream.decodeText,
								Stream.runForEach(feed),
								Effect.ignore({log: 'Warn', message: 'AI usage response could not be read'})
							)
							// A response cut after its last data line never sends the blank line that ends the event, and usage often arrives last.
							yield* pipe(feed('\n\n'), Effect.ignore({log: 'Warn', message: 'AI usage response could not be read'}))
						} else {
							const decoder = new TextDecoder()
							yield* pipe(
								stream,
								Stream.takeWhile(() => state.pending.length <= 10 * 1024 * 1024),
								Stream.runForEach(chunk =>
									Effect.sync(() => {
										state.pending += decoder.decode(chunk, {stream: true})
									})
								),
								Effect.ignore({log: 'Warn', message: 'AI usage response could not be read'})
							)
							yield* updateUsage(state.pending)
						}
						yield* saveUsage(id, state.current)
					}),
					Effect.catch(error => Effect.logWarning('AI usage could not be saved', error)),
					Effect.forkIn(scope)
				)
				const responseBlocked = [
					...HOP_BY_HOP,
					'content-encoding',
					'content-length',
					...Array.map(String.split(',')(response.headers['connection'] ?? ''), name =>
						String.toLowerCase(String.trim(name))
					)
				]
				return HttpServerResponse.stream(
					Stream.fromReadableStream({evaluate: () => forward, onError: Function.identity}),
					{headers: Headers.removeMany(response.headers, responseBlocked), status: response.status}
				)
			}),
			removeKey: Effect.fnUntraced(function* (id: string, provider: AiProvider) {
				yield* updateKeys(id, entries => Array.filter(entries, key => key.provider !== provider))
			}),
			setKey: Effect.fnUntraced(function* (id: string, provider: AiProvider, secret: Redacted.Redacted) {
				yield* updateKeys(id, entries => [
					...Array.filter(entries, key => key.provider !== provider),
					{last4: String.slice(-4)(Redacted.value(secret)), provider, secret}
				])
			}),
			usage: (id: string, period: Period) =>
				usageWindow(
					period,
					pipe(
						SubscriptionRef.changes(usageChanged),
						Stream.map(versions => versions[id] ?? 0),
						Stream.changes,
						Stream.map(() => undefined)
					),
					range => pipe(usage.read(id, range), failed)
				)
		}
	})
}
export class AiProxy extends Context.Service<AiProxy, Effect.Success<ReturnType<typeof make>>>()(
	'@deslop/gateway/services/ai/service/AiProxy'
) {
	// oxlint-disable-next-line eslint/no-use-before-define -- The layer function is called after this module finishes evaluating.
	static readonly layer = Layer.unwrap(Effect.map(dataDirectory, layerAiProxy))
}
export function layerAiProxy(directory: string) {
	return Layer.effect(AiProxy, make(directory))
}
