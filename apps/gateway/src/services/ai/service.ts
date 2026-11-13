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
	Stream,
	String,
	Struct,
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
import {Reactivity} from 'effect/reactivity'
import {Migrator, SqlClient, SqlSchema} from 'effect/sql'

import {Auth, localAuth} from '@deslop/runtime/server/auth'
import {AuthError, bearerOf, failureOptions, isJwt} from '@deslop/runtime/shared/auth'

import {readUsage} from '#services/ai/lib/utils.ts'
import type {AiProvider, AiUsageEntry} from '#services/ai/schema.ts'
import {AiKey, AiUsage, AiUsageBreakdown, AiUsageQuery, ModelsCatalog, PROVIDER_NAMES} from '#services/ai/schema.ts'
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

declare module 'effect/reactivity/Reactivity' {
	interface Keys {
		// A person's usage, by their id.
		readonly aiUsage: string
	}
}

function storageFailure(cause: unknown) {
	return AuthError.make({cause, error: 'temporarily_unavailable', message: 'AI Gateway storage failed'})
}

const storageFailed = Effect.mapError(storageFailure)

const make = Effect.gen(function* () {
	const sql = yield* SqlClient.SqlClient
	// Writes tell this Reactivity of their commits, so callers need none of their own.
	const withReactivity = Effect.provideService(Reactivity.Reactivity, yield* Reactivity.Reactivity)
	const auth = yield* Auth
	const local = yield* localAuth
	const client = yield* HttpClient.HttpClient
	const scope = yield* Scope.Scope
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

	const listKeys = SqlSchema.findAll({
		Request: AiKey.fields.owner,
		Result: Schema.Struct(Struct.pick(AiKey.fields, ['last4', 'lastStatus', 'provider'])),
		execute: owner =>
			sql`SELECT last4, lastStatus, provider FROM ${sql(AiKey.table)} WHERE owner = ${owner} ORDER BY provider`
	})
	const findKey = SqlSchema.findOneOption({
		Request: Schema.Struct(Struct.pick(AiKey.fields, ['owner', 'provider'])),
		Result: AiKey,
		execute: request =>
			sql`SELECT * FROM ${sql(AiKey.table)} WHERE owner = ${request.owner} AND provider = ${request.provider}`
	})
	// A person has one key per provider: a new one replaces it and its status.
	const saveKey = SqlSchema.void({
		Request: AiKey.insert,
		execute: row => sql`INSERT OR REPLACE INTO ${sql(AiKey.table)} ${sql.insert(row)}`
	})
	const deleteKey = SqlSchema.void({
		Request: Schema.Struct(Struct.pick(AiKey.fields, ['owner', 'provider'])),
		execute: request =>
			sql`DELETE FROM ${sql(AiKey.table)} WHERE owner = ${request.owner} AND provider = ${request.provider}`
	})
	// The status lands only on the key that answered, not on one that replaced it meanwhile.
	const markKey = SqlSchema.void({
		Request: Schema.Struct(Struct.pick(AiKey.fields, ['lastStatus', 'owner', 'provider', 'secret'])),
		execute: request => sql`
			UPDATE ${sql(AiKey.table)} SET lastStatus = ${request.lastStatus}
			WHERE owner = ${request.owner} AND provider = ${request.provider} AND secret = ${request.secret}
		`
	})
	const addUsage = SqlSchema.void({
		Request: AiUsage.insert,
		execute: row => sql`
			INSERT INTO ${sql(AiUsage.table)} ${sql.insert(row)}
			ON CONFLICT (owner, hour, provider) DO UPDATE SET
				costUsd = costUsd + excluded.costUsd,
				unknownCostCalls = unknownCostCalls + excluded.unknownCostCalls
		`
	})
	const deleteUsageBefore = SqlSchema.void({
		Request: Schema.Struct({hour: Schema.Finite, owner: AiUsage.fields.owner}),
		execute: request => sql`DELETE FROM ${sql(AiUsage.table)} WHERE owner = ${request.owner} AND hour < ${request.hour}`
	})
	function within(query: AiUsageQuery) {
		return sql`owner = ${query.owner} AND hour >= ${query.from} AND hour < ${query.to}`
	}
	const listTotals = SqlSchema.findAll({
		Request: AiUsageQuery,
		Result: AiUsageBreakdown,
		execute: query => sql`
			SELECT provider AS name, total(costUsd) AS costUsd, sum(unknownCostCalls) AS unknownCostCalls
			FROM ${sql(AiUsage.table)} WHERE ${within(query)}
			GROUP BY provider ORDER BY provider
		`
	})
	// Each bucket of the range, oldest first, with what each provider cost in it.
	const listBuckets = SqlSchema.findAll({
		Request: AiUsageQuery,
		Result: Schema.Struct({at: Schema.Finite, byProvider: Schema.fromJsonString(Schema.Array(AiUsageBreakdown))}),
		execute: query => sql`
			SELECT at, json_group_array(json_object('costUsd', costUsd, 'name', name, 'unknownCostCalls', unknownCostCalls)) AS byProvider
			FROM (
				SELECT hour - hour % ${query.size} AS at, provider AS name, total(costUsd) AS costUsd,
					sum(unknownCostCalls) AS unknownCostCalls
				FROM ${sql(AiUsage.table)} WHERE ${within(query)}
				GROUP BY 1, 2 ORDER BY 1, 2
			)
			GROUP BY at ORDER BY at
		`
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
		// The call joins its hour; an hour older than the bar's longest period goes as a new call arrives.
		yield* pipe(
			Effect.andThen(
				addUsage({
					costUsd: metered.entry.costUsd ?? 0,
					hour: Math.floor(entry.at / 3_600_000) * 3_600_000,
					owner: id,
					provider: entry.provider,
					unknownCostCalls: Boolean.match(metered.entry.costSource === 'unknown', {onFalse: () => 0, onTrue: () => 1})
				}),
				deleteUsageBefore({hour: entry.at - 30 * 86_400_000, owner: id})
			),
			Reactivity.mutation({aiUsage: [id]}),
			sql.withTransaction,
			withReactivity
		)
	})
	return {
		keys: (id: string) => storageFailed(listKeys(id)),
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
			const key = Option.getOrUndefined(yield* storageFailed(findKey({owner: id, provider})))
			if (key === undefined) {
				return HttpServerResponse.jsonUnsafe(
					{error: {message: `Add your ${PROVIDER_NAMES[provider]} key in Gateway`}},
					{status: 402}
				)
			}
			const headers = Headers.removeMany(request.headers, [
				...FORBIDDEN,
				...pipe(request.headers['connection'] ?? '', String.split(','), Array.map(value =>
					String.toLowerCase(String.trim(value))))
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
			yield* storageFailed(markKey({lastStatus: Option.some(response.status), owner: id, provider, secret: key.secret}))
			const web = Option.getOrUndefined(HttpClientResponse.toWeb(response))
			const body = web?.body ?? (yield* Stream.toReadableStreamEffect(response.stream))
			const [forward, meter] = body.tee()
			const entry: AiUsageEntry = {
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
						state.current = yield* Effect.catch(Effect.fromResult(readUsage(text, state.current)), error =>
								Effect.as(
									Effect.logWarning('AI usage was malformed; keeping previously read usage', error),
									state.current
								))
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
						yield* Effect.ignore(feed('\n\n'), {log: 'Warn', message: 'AI usage response could not be read'})
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
				...pipe(response.headers['connection'] ?? '', String.split(','), Array.map(name =>
					String.toLowerCase(String.trim(name))))
			]
			return HttpServerResponse.stream(
				Stream.fromReadableStream({evaluate: () => forward, onError: Function.identity}),
				{headers: Headers.removeMany(response.headers, responseBlocked), status: response.status}
			)
		}),
		removeKey: (id: string, provider: AiProvider) => (storageFailed)(deleteKey({owner: id, provider})),
		setKey: (id: string, provider: AiProvider, secret: Redacted.Redacted) =>
			(storageFailed)(saveKey({
					last4: String.slice(-4)(Redacted.value(secret)),
					lastStatus: Option.none(),
					owner: id,
					provider,
					secret
				})),
		// A person's report now and after each of their recorded calls.
		usage: (id: string, period: Period) =>
			usageWindow(period, range =>
				Stream.mapError(sql.reactive(
						{aiUsage: [id]},
						Effect.all(
							{byProvider: listTotals({...range, owner: id}), series: listBuckets({...range, owner: id})},
							{concurrency: 1}
						)
					), storageFailure)
			)
	}
})

export class AiProxy extends Context.Service<AiProxy, Effect.Success<typeof make>>('@deslop/gateway/services/ai/service/AiProxy') {
	// The tables this service owns, made and changed at start in one transaction; one statement per `sql` call, since SQLite runs only the first statement of a string.
	static readonly migrations = Layer.effectDiscard(
		Migrator.make({})({
			loader: Migrator.fromRecord({
				'0001_ai': Effect.gen(function* () {
					const sql = yield* SqlClient.SqlClient
					yield* sql`
						CREATE TABLE ai_keys (
							owner TEXT NOT NULL,
							provider TEXT NOT NULL,
							secret TEXT NOT NULL,
							last4 TEXT NOT NULL,
							lastStatus INTEGER,
							PRIMARY KEY (owner, provider)
						) STRICT, WITHOUT ROWID
					`
					// Keyed by person then hour, so a person's period reads as one range of the table.
					yield* sql`
						CREATE TABLE ai_usage (
							owner TEXT NOT NULL,
							hour INTEGER NOT NULL,
							provider TEXT NOT NULL,
							costUsd REAL NOT NULL,
							unknownCostCalls INTEGER NOT NULL,
							PRIMARY KEY (owner, hour, provider)
						) STRICT, WITHOUT ROWID
					`
				})
			}),
			table: 'ai_migrations'
		})
	)

	static readonly layer = Layer.provide(Layer.effect(AiProxy, make), AiProxy.migrations)
}
