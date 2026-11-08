import {
	Array,
	Boolean,
	Clock,
	Context,
	Effect,
	Function,
	HashSet,
	Layer,
	MutableList,
	Number,
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
import {HttpClient, HttpClientRequest, HttpClientResponse, HttpServerRequest, HttpServerResponse} from 'effect/http'
import {KeyValueStore} from 'effect/persistence'

import type {AiProvider} from '@deslop/runtime/ai'
import {AuthError} from '@deslop/runtime/auth/schema'
import {Auth} from '@deslop/runtime/auth/service'
import {DEVELOPER, localAuth} from '@deslop/runtime/auth/utils'
import {Origin} from '@deslop/runtime/schema'

import type {AiUsageQuery} from '#services/ai/schema.ts'
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
	const pricing: {catalog: ModelsCatalog; refreshed: number} = {catalog: {}, refreshed: -Infinity}
	function loadKeys(id: string) {
		return pipe(keys.get(`ai-keys/${id}`), Effect.map(Option.getOrElse(() => [])), failed)
	}
	const loadGrants = pipe(grants.get('ai-grants'), Effect.map(Option.getOrElse(() => [])), failed)
	const saveUsage = Effect.fnUntraced(function* (id: string, entry: AiUsageEntry) {
		const metered = {entry}
		if (
			entry.costSource !== 'provider' &&
			entry.model &&
			entry.inputTokens + entry.outputTokens + entry.cacheReadTokens + entry.cacheWriteTokens > 0
		) {
			const now = yield* Clock.currentTimeMillis
			if (now - pricing.refreshed >= 86_400_000) {
				pricing.refreshed = now
				pricing.catalog = yield* pipe(
					client.get('https://models.dev/api.json'),
					Effect.flatMap(HttpClientResponse.schemaBodyJson(ModelsCatalog)),
					Effect.timeout('10 seconds'),
					Effect.orElseSucceed(() => pricing.catalog)
				)
			}
			const catalogProvider = Boolean.match(entry.provider === 'opencode-zen', {
				onFalse: () => entry.provider,
				onTrue: () => 'opencode'
			})
			const cost = pricing.catalog[catalogProvider]?.models[entry.model]?.cost
			if (cost) {
				const input = Boolean.match(entry.provider === 'anthropic', {
					onFalse: () => Number.max(0, entry.inputTokens - entry.cacheReadTokens - entry.cacheWriteTokens),
					onTrue: () => entry.inputTokens
				})
				if (
					(!entry.cacheReadTokens || cost.cache_read !== undefined) &&
					(!entry.cacheWriteTokens || cost.cache_write !== undefined)
				) {
					metered.entry = {
						...entry,
						costSource: 'models.dev',
						costUsd:
							(input * cost.input +
								entry.outputTokens * cost.output +
								entry.cacheReadTokens * (cost.cache_read ?? 0) +
								entry.cacheWriteTokens * (cost.cache_write ?? 0)) /
							1_000_000
					}
				}
			}
		}
		const key = `ai-usage/${id}/${String.slice(0, 7)(new Date(entry.at).toISOString())}`
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
				entries
					.filter(grant => grant.userId === id)
					.map(grant => ({app: grant.app, createdAt: grant.createdAt, lastUsedAt: grant.lastUsedAt}))
			),
		keys: (id: string) =>
			Effect.map(loadKeys(id), entries =>
				entries.map(key => ({
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
							...(yield* loadGrants).filter(grant => grant.userId !== user.id || grant.app !== input.app),
							{app: input.app, createdAt: now, hash: digest, lastUsedAt: now, userId: user.id}
						])
					}),
					Semaphore.withPermit(lock)
				)
				return HttpServerResponse.jsonUnsafe({token}, {headers: {'cache-control': 'no-store'}})
			}),
			Effect.catch(() =>
				Effect.succeed(
					HttpServerResponse.jsonUnsafe(
						{error: {message: 'Sign in with a credential valid for this app'}},
						{status: 401}
					)
				)
			)
		),
		proxy: Effect.fnUntraced(function* (provider: AiProvider, rest: string) {
			const request = yield* HttpServerRequest.HttpServerRequest
			const now = yield* Clock.currentTimeMillis
			const digest = yield* hash((request.headers['authorization'] ?? '').replace(/^Bearer /u, ''))
			const grant = yield* pipe(
				Effect.gen(function* () {
					const current = yield* loadGrants
					const found = current.find(value => value.hash === digest)
					if (found) {
						yield* grants.set(
							'ai-grants',
							current.map(value => {
								if (value.hash === digest) return {...value, lastUsedAt: now}
								return value
							})
						)
					}
					return found
				}),
				Semaphore.withPermit(lock)
			)
			if (!local && !grant) {
				return HttpServerResponse.jsonUnsafe({error: {message: 'Unknown or revoked AI grant'}}, {status: 401})
			}
			const id = Boolean.match(local, {onFalse: () => grant?.userId ?? DEVELOPER.id, onTrue: () => DEVELOPER.id})
			const key = (yield* loadKeys(id)).find(value => value.provider === provider)
			if (!key) {
				return HttpServerResponse.jsonUnsafe(
					{error: {message: `Add a ${NAMES[provider]} key in Gateway`}},
					{status: 402}
				)
			}
			const stripped = HashSet.fromIterable([
				...FORBIDDEN,
				...(request.headers['connection'] ?? '').split(',').map(value => value.trim().toLowerCase())
			])
			const headers = Object.fromEntries(
				Object.entries(request.headers).filter(entry => !HashSet.has(stripped, entry[0]))
			)
			if (provider === 'anthropic') headers['x-api-key'] = Redacted.value(key.secret)
			else headers['authorization'] = `Bearer ${Redacted.value(key.secret)}`
			const outgoing = {
				model: Option.none<string>(),
				request: HttpClientRequest.make(
					yield* Schema.decodeUnknownEffect(
						Schema.Literals(['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD', 'OPTIONS'])
					)(request.method)
				)(`${UPSTREAMS[provider]}/${rest}`, {headers})
			}
			if (request.method !== 'GET' && request.method !== 'HEAD') {
				if (request.headers['content-type']?.includes('application/json')) {
					const body = new Uint8Array(yield* request.arrayBuffer)
					const decoded = Schema.decodeUnknownOption(
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
						(yield* loadKeys(id)).map(value => {
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
					yield* pipe(
						Effect.tryPromise(async () => {
							const reader = meter.getReader()
							const decoder = new TextDecoder()
							try {
								while (true) {
									const chunk = await reader.read()
									if (chunk.done) break
									state.pending += decoder.decode(chunk.value, {stream: true})
									if (sse) {
										const lines = state.pending.split(/\r?\n/u)
										state.pending = Option.getOrElse(Array.last(lines), () => '')
										for (const line of Array.dropRight(lines, 1)) {
											if (line.startsWith('data:')) {
												state.current = readUsage(String.slice(5)(line).trim(), state.current)
											}
										}
									}
									if (state.pending.length > 10 * 1024 * 1024) {
										await reader.cancel()
										break
									}
								}
								state.current = readUsage(
									Boolean.match(sse, {
										onFalse: () => state.pending,
										onTrue: () => state.pending.replace(/^data:\s*/u, '')
									}),
									state.current
								)
							} finally {
								reader.releaseLock()
							}
						}),
						Effect.ignore({log: 'Warn', message: 'AI usage response could not be read'})
					)
					yield* saveUsage(id, state.current)
				}),
				Effect.catch(error => Effect.logWarning('AI usage could not be saved', error)),
				Effect.forkIn(scope)
			)
			const responseBlocked = HashSet.fromIterable([
				...HOP_BY_HOP,
				'content-encoding',
				'content-length',
				...(response.headers['connection'] ?? '').split(',').map(name => name.trim().toLowerCase())
			])
			return HttpServerResponse.stream(
				Stream.fromReadableStream({evaluate: () => forward, onError: Function.identity}),
				{
					headers: Object.fromEntries(
						Object.entries(response.headers).filter(header => !HashSet.has(responseBlocked, header[0]))
					),
					status: response.status
				}
			)
		}),
		removeKey: Effect.fnUntraced(function* (id: string, provider: AiProvider) {
			return yield* pipe(
				Effect.gen(function* () {
					yield* keys.set(
						`ai-keys/${id}`,
						(yield* loadKeys(id)).filter(key => key.provider !== provider)
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
						(yield* loadGrants).filter(grant => grant.userId !== id || grant.app !== app)
					)
				}),
				Semaphore.withPermit(lock),
				failed
			)
		}),
		setKey: Effect.fnUntraced(function* (id: string, provider: AiProvider, secret: Redacted.Redacted<string>) {
			return yield* pipe(
				Effect.gen(function* () {
					const current = yield* loadKeys(id)
					yield* keys.set(`ai-keys/${id}`, [
						...current.filter(key => key.provider !== provider),
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
					const date = new Date(query.from)
					date.setUTCDate(1)
					date.setUTCHours(0, 0, 0, 0)
					while (date.getTime() < query.to) {
						MutableList.append(months, String.slice(0, 7)(date.toISOString()))
						date.setUTCMonth(date.getUTCMonth() + 1)
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
export class AiProxy extends Context.Service<AiProxy, Effect.Success<typeof make>>()('@deslop/gateway/AiProxy') {
	static readonly make = make
	static readonly layer = Layer.effect(this, make)
}
