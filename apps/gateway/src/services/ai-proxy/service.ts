import {
	Array,
	Boolean,
	Context,
	DateTime,
	Effect,
	Function,
	Layer,
	Match,
	Option,
	Redacted,
	Result,
	Schema,
	Scope,
	Stream,
	String,
	Struct,
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
import {Migrator, SqlClient, SqlSchema} from 'effect/sql'

import {Auth} from '@deslop/runtime/server/auth'
import {AiModelId} from '@deslop/runtime/shared/ai'
import {AuthError, CLIENT_HEADER, ON_BEHALF_HEADER, failureOptions} from '@deslop/runtime/shared/auth'
import type {UserId} from '@deslop/runtime/shared/auth'

import type {AiSetKey} from './schema.ts'
import {AiKey, AiKeyItem, AiProvider} from './schema.ts'

import {AiMetering} from '#services/ai-metering/service.ts'

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
const FORBIDDEN = ['authorization', 'x-api-key', 'cookie', 'host', CLIENT_HEADER, ON_BEHALF_HEADER, ...HOP_BY_HOP]

function inferencePath(rest: string) {
	const state = {path: Array.headNonEmpty(String.split(rest, '?'))}
	while (String.includes('%')(state.path)) {
		const decoded = Option.liftThrowable(decodeURIComponent)(state.path)
		if (Option.isNone(decoded)) return Option.none<string>()
		state.path = Option.getOrThrow(decoded)
	}
	return Option.liftPredicate(state.path, value => !String.includes('..')(value))
}

function isClaude(value: string) {
	return pipe(value, String.match(/(?:^|\/)claude-/iu), Option.isSome)
}

function destinationOf(method: string, rest: string, model: Option.Option<AiModelId>) {
	const path = inferencePath(rest)
	if (Option.isNone(path)) {
		return Result.fail(HttpServerResponse.jsonUnsafe({error: {message: 'Invalid inference path'}}, {status: 400}))
	}
	if (String.startsWith('openai/')(rest)) {
		return Result.succeed(`https://api.openai.com/${String.slice('openai/'.length)(rest)}`)
	}
	if (!String.startsWith('anthropic/')(rest)) {
		if (Option.exists(model, isClaude) || Option.exists(path, isClaude)) {
			return Result.fail(
				HttpServerResponse.jsonUnsafe(
					{error: {message: 'Claude must use the Anthropic key: use /ai/anthropic/v1/messages'}},
					{status: 403}
				)
			)
		}
		return Result.succeed(`https://opencode.ai/inference/${rest}`)
	}
	if (method !== 'POST' || pipe(rest, String.match(/^anthropic\/v1\/messages(?:\?.*)?$/u), Option.isNone)) {
		return Result.fail(HttpServerResponse.jsonUnsafe({error: {message: 'Unknown Anthropic endpoint'}}, {status: 404}))
	}
	return Result.succeed(`https://api.anthropic.com/${String.slice('anthropic/'.length)(rest)}`)
}

const asAuthError = Effect.mapError((cause: unknown) =>
	AuthError.make({cause, error: 'temporarily_unavailable', message: 'AI Gateway storage failed'})
)

export class AiProxy extends Context.Service<AiProxy>()('@deslop/gateway/services/ai-proxy/service/AiProxy', {
	make: Effect.gen(function* () {
		const sql = yield* SqlClient.SqlClient
		const auth = yield* Auth
		const client = yield* HttpClient.HttpClient
		const scope = yield* Scope.Scope
		const metering = yield* AiMetering
		const listKeys = SqlSchema.findAll({
			Request: AiKey.fields.owner,
			Result: AiKeyItem,
			execute: owner =>
				sql`SELECT provider, last4, lastStatus FROM ${sql(AiKey.table)} WHERE owner = ${owner} ORDER BY provider`
		})
		const findKey = SqlSchema.findOneOption({
			Request: Schema.Struct({owner: AiKey.fields.owner, provider: AiProvider}),
			Result: AiKey,
			execute: key => sql`SELECT * FROM ${sql(AiKey.table)} WHERE owner = ${key.owner} AND provider = ${key.provider}`
		})
		const saveKey = SqlSchema.void({
			Request: AiKey.insert,
			execute: row => sql`INSERT OR REPLACE INTO ${sql(AiKey.table)} ${sql.insert(row)}`
		})
		const deleteKey = SqlSchema.void({
			Request: Schema.Struct({owner: AiKey.fields.owner, provider: AiProvider}),
			execute: key => sql`DELETE FROM ${sql(AiKey.table)} WHERE owner = ${key.owner} AND provider = ${key.provider}`
		})
		// Only a changed status writes, and only on the key that answered, never its replacement.
		const markKey = SqlSchema.void({
			Request: Schema.Struct(Struct.pick(AiKey.fields, ['lastStatus', 'owner', 'secret'])),
			execute: request => sql`
				UPDATE ${sql(AiKey.table)} SET lastStatus = ${request.lastStatus}
				WHERE owner = ${request.owner} AND secret = ${request.secret}
				AND lastStatus IS NOT ${request.lastStatus}
			`
		})
		return {
			key: Effect.fn('AiProxy.key')(function* (id: UserId) {
				yield* Effect.annotateCurrentSpan('userId', id)
				return yield* asAuthError(listKeys(id))
			}),
			proxy: Effect.fn('AiProxy.proxy')(function* (rest: string) {
				const request = yield* HttpServerRequest.HttpServerRequest
				const now = yield* DateTime.now
				const person = yield* Effect.result(auth.user(request.headers))
				if (Result.isFailure(person)) {
					return HttpServerResponse.jsonUnsafe(
						{error: {message: person.failure.message}},
						failureOptions(person.failure, 401)
					)
				}
				const provider = pipe(
					rest,
					Match.value,
					Match.when(String.startsWith('anthropic/'), Function.constant('anthropic' as const)),
					Match.when(String.startsWith('openai/'), Function.constant('openai' as const)),
					Match.orElse(Function.constant('opencode' as const))
				)
				const key = yield* asAuthError(findKey({owner: person.success.id, provider}))
				if (Option.isNone(key)) {
					return HttpServerResponse.jsonUnsafe(
						{
							error: {
								message: `Save your ${{anthropic: 'Anthropic API', openai: 'OpenAI API', opencode: 'OpenCode service account'}[provider]} key in Gateway`
							}
						},
						{status: 402}
					)
				}
				const foundKey = Option.getOrThrow(key)
				const headers = Headers.removeMany(request.headers, [
					...FORBIDDEN,
					...pipe(
						Option.fromUndefinedOr(request.headers['connection']),
						Option.map(String.split(',')),
						Option.getOrElse(() => []),
						Array.map(value => String.toLowerCase(String.trim(value)))
					)
				])
				const outgoing = {
					model: Option.none<AiModelId>(),
					request: HttpClientRequest.make(
						yield* Schema.decodeUnknownEffect(
							Schema.Literals(['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD', 'OPTIONS'])
						)(request.method)
					)('/', {
						headers: Boolean.match(provider === 'anthropic', {
							onFalse: () => Headers.set(headers, 'authorization', `Bearer ${Redacted.value(foundKey.secret)}`),
							onTrue: () => Headers.set(headers, 'x-api-key', Redacted.value(foundKey.secret))
						})
					})
				}
				if (request.method !== 'GET' && request.method !== 'HEAD') {
					const body = new Uint8Array(yield* request.arrayBuffer)
					const decoded = Schema.decodeOption(
						Schema.fromJsonString(Schema.Struct({model: Schema.OptionFromOptionalKey(AiModelId)}))
					)(new TextDecoder().decode(body))
					outgoing.model = Option.flatMap(decoded, value => value.model)
					outgoing.request = HttpClientRequest.bodyUint8Array(outgoing.request, body, request.headers['content-type'])
				}
				const destination = destinationOf(request.method, rest, outgoing.model)
				if (Result.isFailure(destination)) return destination.failure
				const response = yield* client.execute(HttpClientRequest.setUrl(outgoing.request, destination.success))
				// Key bookkeeping cannot turn an upstream action that committed into a failed forwarding request.
				yield* Effect.ignore(
					asAuthError(
						markKey({lastStatus: Option.some(response.status), owner: person.success.id, secret: foundKey.secret})
					),
					{log: 'Warn', message: 'AI key status could not be saved'}
				)
				const body = yield* pipe(
					HttpClientResponse.toWeb(response),
					Option.flatMap(web => Option.fromNullOr(web.body)),
					Option.match({onNone: () => Stream.toReadableStreamEffect(response.stream), onSome: Effect.succeed})
				)
				const [forward, meter] = body.tee()
				yield* Effect.forkIn(
					metering.record(
						person.success.id,
						provider,
						outgoing.model,
						now,
						Option.exists(
							Option.fromUndefinedOr(response.headers['content-type']),
							String.includes('text/event-stream')
						),
						meter
					),
					scope
				)
				const blocked = [
					...HOP_BY_HOP,
					'content-encoding',
					'content-length',
					...pipe(
						Option.fromUndefinedOr(response.headers['connection']),
						Option.map(String.split(',')),
						Option.getOrElse(() => []),
						Array.map(name => String.toLowerCase(String.trim(name)))
					)
				]
				return HttpServerResponse.stream(
					Stream.fromReadableStream({evaluate: () => forward, onError: Function.identity}),
					{headers: Headers.removeMany(response.headers, blocked), status: response.status}
				)
			}),
			removeKey: Effect.fn('AiProxy.removeKey')(function* (id: UserId, provider: AiProvider) {
				yield* Effect.annotateCurrentSpan('userId', id)
				return yield* asAuthError(deleteKey({owner: id, provider}))
			}),
			setKey: Effect.fn('AiProxy.setKey')(function* (id: UserId, input: AiSetKey) {
				yield* Effect.annotateCurrentSpan('userId', id)
				return yield* asAuthError(
					saveKey({
						last4: String.slice(-4)(Redacted.value(input.secret)),
						lastStatus: Option.none(),
						owner: id,
						provider: pipe(
							Redacted.value(input.secret),
							Match.value,
							Match.when(String.startsWith('sk-ant-'), Function.constant('anthropic' as const)),
							Match.when(String.startsWith('sk-'), Function.constant('openai' as const)),
							Match.orElse(Function.constant('opencode' as const))
						),
						secret: input.secret
					})
				)
			})
		}
	})
}) {
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
				}),
				'0002_opencode_only': Effect.gen(function* () {
					const sql = yield* SqlClient.SqlClient
					yield* sql`DELETE FROM ai_keys WHERE provider IN ('anthropic', 'openrouter')`
					yield* sql`DELETE FROM ai_usage WHERE provider IN ('anthropic', 'openrouter')`
				}),
				'0003_single_opencode': Effect.gen(function* () {
					const sql = yield* SqlClient.SqlClient
					yield* sql`CREATE TABLE ai_keys_new (
						owner TEXT PRIMARY KEY NOT NULL,
						connectionUrl TEXT,
						secret TEXT NOT NULL,
						last4 TEXT NOT NULL,
						lastStatus INTEGER
					) STRICT, WITHOUT ROWID`
					yield* sql`INSERT INTO ai_keys_new (owner, secret, last4, lastStatus)
						SELECT owner, secret, last4, lastStatus FROM (
							SELECT *, row_number() OVER (PARTITION BY owner ORDER BY provider = 'opencode-zen' DESC) AS position
							FROM ai_keys
						) WHERE position = 1`
					yield* sql`DROP TABLE ai_keys`
					yield* sql`ALTER TABLE ai_keys_new RENAME TO ai_keys`
					yield* sql`CREATE TABLE ai_usage_new (
						owner TEXT NOT NULL, hour INTEGER NOT NULL, costUsd REAL NOT NULL, unknownCostCalls INTEGER NOT NULL,
						PRIMARY KEY (owner, hour)
					) STRICT, WITHOUT ROWID`
					yield* sql`INSERT INTO ai_usage_new SELECT owner, hour, sum(costUsd), sum(unknownCostCalls) FROM ai_usage GROUP BY owner, hour`
					yield* sql`DROP TABLE ai_usage`
					yield* sql`ALTER TABLE ai_usage_new RENAME TO ai_usage`
				}),
				'0004_spend_source': Effect.gen(function* () {
					const sql = yield* SqlClient.SqlClient
					yield* sql`CREATE TABLE ai_usage_new (
						owner TEXT NOT NULL, hour INTEGER NOT NULL, spendSource TEXT NOT NULL,
						costUsd REAL NOT NULL, unknownCostCalls INTEGER NOT NULL, estimatedCalls INTEGER NOT NULL,
						PRIMARY KEY (owner, hour, spendSource)
					) STRICT, WITHOUT ROWID`
					// Earlier aggregates mixed balances and estimates; they cannot be attributed retrospectively.
					yield* sql`INSERT INTO ai_usage_new SELECT owner, hour, 'unattributed', costUsd, unknownCostCalls, 0 FROM ai_usage`
					yield* sql`DROP TABLE ai_usage`
					yield* sql`ALTER TABLE ai_usage_new RENAME TO ai_usage`
				}),
				'0005_payer_required': Effect.gen(function* () {
					const sql = yield* SqlClient.SqlClient
					yield* sql`CREATE TABLE ai_usage_new (
						owner TEXT NOT NULL, hour INTEGER NOT NULL,
						spendSource TEXT NOT NULL CHECK (spendSource IN ('balance', 'byok', 'free', 'go', 'go-plus')),
						costUsd REAL NOT NULL, unknownCostCalls INTEGER NOT NULL, estimatedCalls INTEGER NOT NULL,
						PRIMARY KEY (owner, hour, spendSource)
					) STRICT, WITHOUT ROWID`
					// Spend recorded before it was split by payer is dropped, not guessed.
					yield* sql`INSERT INTO ai_usage_new SELECT * FROM ai_usage WHERE spendSource <> 'unattributed'`
					yield* sql`DROP TABLE ai_usage`
					yield* sql`ALTER TABLE ai_usage_new RENAME TO ai_usage`
				}),
				'0006_anthropic_key': Effect.gen(function* () {
					const sql = yield* SqlClient.SqlClient
					yield* sql`CREATE TABLE ai_keys_new (
						owner TEXT NOT NULL, provider TEXT NOT NULL CHECK (provider IN ('opencode', 'anthropic')),
						secret TEXT NOT NULL, last4 TEXT NOT NULL, lastStatus INTEGER,
						PRIMARY KEY (owner, provider)
					) STRICT, WITHOUT ROWID`
					yield* sql`INSERT INTO ai_keys_new SELECT owner, 'opencode', secret, last4, lastStatus FROM ai_keys`
					yield* sql`DROP TABLE ai_keys`
					yield* sql`ALTER TABLE ai_keys_new RENAME TO ai_keys`
				}),
				'0007_openai_key': Effect.gen(function* () {
					const sql = yield* SqlClient.SqlClient
					yield* sql`CREATE TABLE ai_keys_new (
						owner TEXT NOT NULL, provider TEXT NOT NULL CHECK (provider IN ('opencode', 'anthropic', 'openai')),
						secret TEXT NOT NULL, last4 TEXT NOT NULL, lastStatus INTEGER,
						PRIMARY KEY (owner, provider)
					) STRICT, WITHOUT ROWID`
					yield* sql`INSERT INTO ai_keys_new SELECT * FROM ai_keys`
					yield* sql`DROP TABLE ai_keys`
					yield* sql`ALTER TABLE ai_keys_new RENAME TO ai_keys`
					yield* sql`CREATE TABLE ai_usage_new (
						owner TEXT NOT NULL, hour INTEGER NOT NULL,
						spendSource TEXT NOT NULL CHECK (spendSource IN ('balance', 'byok', 'openai', 'free', 'go', 'go-plus')),
						costUsd REAL NOT NULL, unknownCostCalls INTEGER NOT NULL, estimatedCalls INTEGER NOT NULL,
						PRIMARY KEY (owner, hour, spendSource)
					) STRICT, WITHOUT ROWID`
					yield* sql`INSERT INTO ai_usage_new SELECT * FROM ai_usage`
					yield* sql`DROP TABLE ai_usage`
					yield* sql`ALTER TABLE ai_usage_new RENAME TO ai_usage`
				}),
				'0008_minute_usage': Effect.gen(function* () {
					const sql = yield* SqlClient.SqlClient
					// Hour timestamps already name their first minute; preserve every existing payer total.
					yield* sql`ALTER TABLE ai_usage RENAME COLUMN hour TO minute`
				})
			}),
			table: 'ai_migrations'
		})
	)
	static readonly layer = pipe(
		Layer.effect(AiProxy, AiProxy.make),
		Layer.provideMerge(AiMetering.layer),
		Layer.provide(AiProxy.migrations)
	)
}
