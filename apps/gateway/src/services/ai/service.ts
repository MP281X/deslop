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
	Schema,
	Scope,
	Semaphore,
	Stream,
	String,
	pipe
} from 'effect'

import {Digest, SecureRandom} from 'effect/crypto'
import {Base64Url} from 'effect/encoding'
import {
	Headers,
	HttpClient,
	HttpClientRequest,
	HttpClientResponse,
	HttpServerRequest,
	HttpServerResponse
} from 'effect/http'
import {KeyValueStore} from 'effect/persistence'

import {GRANT_REFUSED} from '@deslop/runtime/ai/schema'
import {AuthError} from '@deslop/runtime/auth/schema'
import {Auth} from '@deslop/runtime/auth/service'
import {DEVELOPER, localAuth} from '@deslop/runtime/auth/utils'
import {Origin} from '@deslop/runtime/schema'

import type {AiProvider, AiUsageQuery} from '#services/ai/schema.ts'
import {AiStoredGrant, AiStoredKey, AiUsageEntry, ModelsCatalog} from '#services/ai/schema.ts'
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
	const grants = KeyValueStore.toSchemaStore(kv, Schema.Array(AiStoredGrant))
	const usage = KeyValueStore.toSchemaStore(kv, Schema.Array(AiUsageEntry))
	const auth = yield* Auth
	const random = yield* SecureRandom.SecureRandom
	const digestService = yield* Digest.Digest
	function hash(token: string) {
		return Effect.map(digestService.digest(Digest.sha256, new TextEncoder().encode(token)), Base64Url.encode)
	}
	const local = yield* localAuth
	const client = yield* HttpClient.HttpClient
	const scope = yield* Scope.Scope
	const lock = yield* Semaphore.make(1)
	const pricingLock = yield* Semaphore.make(1)
	const pricing: {catalog: ModelsCatalog; refreshed: number} = {catalog: {}, refreshed: -Infinity}
	function loadKeys(id: string) {
		return pipe(keys.get(`ai-keys/${id}`), Effect.map(Option.getOrElse(() => [])), failed)
	}
	const loadGrants = pipe(grants.get('ai-grants'), Effect.map(Option.getOrElse(() => [])), failed)
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
	})
	return {
		grants: (id: string) =>
			Effect.map(loadGrants, entries =>
				Array.map(
					Array.filter(entries, grant => grant.userId === id),
					grant => ({app: grant.app, createdAt: grant.createdAt, lastUsedAt: grant.lastUsedAt})
				)
			),
		keys: (id: string) =>
			Effect.map(loadKeys(id), entries =>
				Array.map(entries, key => ({
					addedAt: key.addedAt,
					last4: key.last4,
					lastStatus: key.lastStatus,
					provider: key.provider
				}))
			),
		mint: pipe(
			Effect.gen(function* () {
				const request = yield* HttpServerRequest.HttpServerRequest
				const input = yield* HttpServerRequest.schemaBodyJson(Schema.Struct({app: Origin}))
				const user = yield* Boolean.match(request.headers['authorization'] !== undefined, {
					onFalse: () => auth.user(request.headers),
					onTrue: () => auth.access(request.headers, input.app)
				})
				const token = Base64Url.encode(yield* random.randomBytes(32))
				const digest = yield* hash(token)
				const now = yield* Clock.currentTimeMillis
				yield* pipe(
					Effect.gen(function* () {
						yield* grants.set('ai-grants', [
							...Array.filter(yield* loadGrants, grant => grant.userId !== user.id || grant.app !== input.app),
							{app: input.app, createdAt: now, hash: digest, lastUsedAt: now, userId: user.id}
						])
					}),
					Semaphore.withPermit(lock)
				)
				return HttpServerResponse.jsonUnsafe({token}, {headers: {'cache-control': 'no-store'}})
			}),
			Effect.orElseSucceed(() =>
				HttpServerResponse.jsonUnsafe({error: {message: 'Sign in with a credential valid for this app'}}, {status: 401})
			)
		),
		proxy: Effect.fnUntraced(function* (provider: AiProvider, rest: string) {
			const request = yield* HttpServerRequest.HttpServerRequest
			const now = yield* Clock.currentTimeMillis
			const digest = yield* hash(String.replace(/^Bearer /u, '')(request.headers['authorization'] ?? ''))
			const grant = yield* pipe(
				Effect.gen(function* () {
					const current = yield* loadGrants
					const found = Option.getOrUndefined(Array.findFirst(current, value => value.hash === digest))
					if (found !== undefined) {
						yield* grants.set(
							'ai-grants',
							Array.map(current, value => {
								if (value.hash === digest) return {...value, lastUsedAt: now}
								return value
							})
						)
					}
					return found
				}),
				Semaphore.withPermit(lock)
			)
			if (!local && grant === undefined) {
				return HttpServerResponse.jsonUnsafe(
					{error: {message: 'Unknown or revoked AI grant'}},
					{headers: {[GRANT_REFUSED]: 'true'}, status: 401}
				)
			}
			const id = Boolean.match(local, {onFalse: () => grant?.userId ?? DEVELOPER.id, onTrue: () => DEVELOPER.id})
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
				app: Boolean.match(local, {onFalse: () => grant?.app ?? 'local', onTrue: () => 'local'}),
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
					const sse = String.includes('text/event-stream')(response.headers['content-type'] ?? '')
					const decoder = new TextDecoder()
					yield* pipe(
						Stream.fromReadableStream({
							evaluate: () => meter,
							onError: cause => AuthError.make({cause, message: 'AI usage could not be read'})
						}),
						Stream.takeWhile(() => state.pending.length <= 10 * 1024 * 1024),
						Stream.runForEach(chunk =>
							Effect.sync(() => {
								state.pending += decoder.decode(chunk, {stream: true})
								if (!sse) return
								const lines = String.split(/\r?\n/u)(state.pending)
								state.pending = Option.getOrElse(Array.last(lines), () => '')
								for (const line of Array.dropRight(lines, 1)) {
									if (String.startsWith('data:')(line)) {
										state.current = readUsage(String.trim(String.slice(5)(line)), state.current)
									}
								}
							})
						),
						Effect.ignore({log: 'Warn', message: 'AI usage response could not be read'})
					)
					state.current = readUsage(
						Boolean.match(sse, {
							onFalse: () => state.pending,
							onTrue: () => String.replace(/^data:\s*/u, '')(state.pending)
						}),
						state.current
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
		revokeGrant: Effect.fnUntraced(function* (id: string, app: string) {
			return yield* pipe(
				Effect.gen(function* () {
					yield* grants.set(
						'ai-grants',
						Array.filter(yield* loadGrants, grant => grant.userId !== id || grant.app !== app)
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
		usage: Effect.fnUntraced(function* (id: string, query: AiUsageQuery) {
			return yield* pipe(
				Effect.gen(function* () {
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
				}),
				failed
			)
		})
	}
})
export class AiProxy extends Context.Service<AiProxy, Effect.Success<typeof make>>()(
	'@deslop/gateway/services/ai/service/AiProxy'
) {
	static readonly layer = Layer.effect(this, make)
}
