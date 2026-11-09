import type {Record} from 'effect'
import {
	Array,
	Boolean,
	Clock,
	Context,
	DateTime,
	Effect,
	Function,
	Layer,
	MutableList,
	Option,
	Redacted,
	Result,
	Schema,
	Scope,
	Semaphore,
	Stream,
	String,
	SubscriptionRef,
	pipe
} from 'effect'

import {
	Headers,
	HttpClient,
	HttpClientRequest,
	HttpClientResponse,
	HttpServerRequest,
	HttpServerResponse
} from 'effect/http'
import {KeyValueStore} from 'effect/persistence'

import {AuthError} from '@deslop/runtime/auth/schema'
import {Auth} from '@deslop/runtime/auth/service'
import {bearerOf, failureOptions, isJwt, localAuth} from '@deslop/runtime/auth/utils'

import type {AiProvider, AiUsageQuery} from '#services/ai/schema.ts'
import {AiStoredKey, AiUsageEntry, ModelsCatalog} from '#services/ai/schema.ts'
import {readUsage, report} from '#services/ai/usage.ts'

const UPSTREAMS = {
	anthropic: 'https://api.anthropic.com',
	'opencode-go': 'https://opencode.ai/inference/go',
	'opencode-zen': 'https://opencode.ai/inference',
	openrouter: 'https://openrouter.ai/api'
}
const NAMES = {
	anthropic: 'Anthropic',
	'opencode-go': 'OpenCode Go',
	'opencode-zen': 'OpenCode Zen',
	openrouter: 'OpenRouter'
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
const failed = Effect.mapError((cause: unknown) => AuthError.make({cause, message: 'AI Gateway storage failed'}))

const make = Effect.gen(function* () {
	const kv = yield* KeyValueStore.KeyValueStore
	const keys = KeyValueStore.toSchemaStore(kv, Schema.Array(AiStoredKey))
	const usage = KeyValueStore.toSchemaStore(kv, Schema.Array(AiUsageEntry))
	// Each person's recorded calls wake only that person's open reader; reads coalesce, so one report goes out at most each second.
	const usageChanged = yield* SubscriptionRef.make<Record<string, number>>({})
	const auth = yield* Auth
	const local = yield* localAuth
	const client = yield* HttpClient.HttpClient
	const scope = yield* Scope.Scope
	const lock = yield* Semaphore.make(1)
	const pricingLock = yield* Semaphore.make(1)
	const pricing: {catalog: ModelsCatalog; refreshed: number} = {catalog: {}, refreshed: -Infinity}
	function loadKeys(id: string) {
		return pipe(keys.get(`ai-keys/${id}`), Effect.map(Option.getOrElse(() => [])), failed)
	}
	const saveUsage = Effect.fnUntraced(function* (id: string, entry: AiUsageEntry) {
		const metered = {entry}
		if (
			entry.costSource !== 'provider' &&
			entry.model !== undefined &&
			entry.inputTokens + entry.outputTokens + entry.cacheReadTokens + entry.cacheWriteTokens > 0
		) {
			// Calls finishing together wait for one refresh instead of pricing against the catalog before it.
			yield* pipe(
				Effect.gen(function* () {
					const now = yield* Clock.currentTimeMillis
					if (now - pricing.refreshed < 86_400_000) return
					pricing.refreshed = now
					pricing.catalog = yield* pipe(
						client.get('https://models.dev/api.json'),
						Effect.flatMap(HttpClientResponse.schemaBodyJson(ModelsCatalog)),
						Effect.timeout('10 seconds'),
						Effect.tapError(error =>
							Effect.logWarning('The pricing catalog could not be refreshed; keeping cached pricing', error)
						),
						Effect.orElseSucceed(() => pricing.catalog)
					)
				}),
				Semaphore.withPermit(pricingLock)
			)
			const catalogProvider = Boolean.match(entry.provider === 'opencode-zen', {
				onFalse: () => entry.provider,
				onTrue: () => 'opencode'
			})
			const cost = pricing.catalog[catalogProvider]?.models[entry.model]?.cost
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
		const key = `ai-usage/${id}/${String.slice(0, 7)(DateTime.formatIsoDateUtc(DateTime.makeUnsafe(entry.at)))}`
		yield* pipe(
			Effect.gen(function* () {
				yield* usage.set(key, [...Option.getOrElse(yield* usage.get(key), () => []), metered.entry])
			}),
			Semaphore.withPermit(lock)
		)
		yield* SubscriptionRef.update(usageChanged, versions => ({...versions, [id]: (versions[id] ?? 0) + 1}))
	})
	const usageReport = Effect.fnUntraced(function* (id: string, query: AiUsageQuery) {
		const months = MutableList.make<string>()
		const cursor = {date: DateTime.startOf(DateTime.makeUnsafe(query.from), 'month')}
		while (DateTime.toEpochMillis(cursor.date) < query.to) {
			MutableList.append(months, String.slice(0, 7)(DateTime.formatIsoDateUtc(cursor.date)))
			cursor.date = DateTime.add(cursor.date, {months: 1})
		}
		const entries = yield* Effect.forEach(
			MutableList.toArray(months),
			month =>
				Effect.map(
					usage.get(`ai-usage/${id}/${month}`),
					Option.getOrElse(() => [])
				),
			{concurrency: 1}
		)
		return report(Array.flatten(entries), query)
	}, failed)
	return {
		keys: (id: string) =>
			Effect.map(loadKeys(id), entries =>
				Array.map(entries, key => ({
					addedAt: key.addedAt,
					last4: key.last4,
					lastStatus: key.lastStatus,
					provider: key.provider
				}))
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
					{error: {message: `Add your ${NAMES[provider]} key in Gateway`}},
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
				provider,
				status: response.status
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
					const decoder = new TextDecoder()
					yield* pipe(
						Stream.fromReadableStream({
							evaluate: () => meter,
							onError: cause => AuthError.make({cause, message: 'AI usage could not be read'})
						}),
						Stream.takeWhile(() => state.pending.length <= 10 * 1024 * 1024),
						Stream.runForEach(chunk =>
							Effect.gen(function* () {
								state.pending += decoder.decode(chunk, {stream: true})
								if (!sse) return
								const lines = String.split(/\r?\n/u)(state.pending)
								state.pending = Option.getOrElse(Array.last(lines), () => '')
								for (const line of Array.dropRight(lines, 1)) {
									if (String.startsWith('data:')(line)) {
										yield* updateUsage(String.trim(String.slice(5)(line)))
									}
								}
							})
						),
						Effect.ignore({log: 'Warn', message: 'AI usage response could not be read'})
					)
					yield* updateUsage(
						Boolean.match(sse, {
							onFalse: () => state.pending,
							onTrue: () => String.replace(/^data:\s*/u, '')(state.pending)
						})
					)
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
			return yield* pipe(
				Effect.gen(function* () {
					yield* keys.set(
						`ai-keys/${id}`,
						Array.filter(yield* loadKeys(id), key => key.provider !== provider)
					)
				}),
				Semaphore.withPermit(lock),
				failed
			)
		}),
		setKey: Effect.fnUntraced(function* (id: string, provider: AiProvider, secret: Redacted.Redacted) {
			return yield* pipe(
				Effect.gen(function* () {
					yield* keys.set(`ai-keys/${id}`, [
						...Array.filter(yield* loadKeys(id), key => key.provider !== provider),
						{addedAt: yield* Clock.currentTimeMillis, last4: String.slice(-4)(Redacted.value(secret)), provider, secret}
					])
				}),
				Semaphore.withPermit(lock),
				failed
			)
		}),
		usage: (id: string, query: AiUsageQuery) =>
			pipe(
				SubscriptionRef.changes(usageChanged),
				Stream.map(versions => versions[id] ?? 0),
				Stream.changes,
				Stream.buffer({capacity: 1, strategy: 'sliding'}),
				Stream.flatMap(() =>
					Stream.concat(
						Stream.fromEffect(usageReport(id, query)),
						Stream.drain(Stream.fromEffect(Effect.sleep('1 second')))
					)
				)
			)
	}
})
export class AiProxy extends Context.Service<AiProxy, Effect.Success<typeof make>>()(
	'@deslop/gateway/services/ai/service/AiProxy'
) {
	static readonly layer = Layer.effect(this, make)
}
