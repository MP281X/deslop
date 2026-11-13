import {
	Array,
	Boolean,
	Context,
	DateTime,
	Effect,
	Function,
	Layer,
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

import {Auth, localAuth} from '@deslop/runtime/server/auth'
import {AiModelId} from '@deslop/runtime/shared/ai'
import {AuthError, bearerOf, failureOptions, isJwt} from '@deslop/runtime/shared/auth'
import type {UserId} from '@deslop/runtime/shared/auth'

import type {AiProvider} from './schema.ts'
import {AiKey, PROVIDER_NAMES} from './schema.ts'

import {AiMetering} from '#services/ai-metering/service.ts'

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

const asAuthError = Effect.mapError((cause: unknown) =>
	AuthError.make({cause, error: 'temporarily_unavailable', message: 'AI Gateway storage failed'})
)

export class AiProxy extends Context.Service<AiProxy>()('@deslop/gateway/services/ai-proxy/service/AiProxy', {
	make: Effect.gen(function* () {
		const sql = yield* SqlClient.SqlClient
		const auth = yield* Auth
		const local = yield* localAuth
		const client = yield* HttpClient.HttpClient
		const scope = yield* Scope.Scope
		const metering = yield* AiMetering
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
		const saveKey = SqlSchema.void({
			Request: AiKey.insert,
			execute: row => sql`INSERT OR REPLACE INTO ${sql(AiKey.table)} ${sql.insert(row)}`
		})
		const deleteKey = SqlSchema.void({
			Request: Schema.Struct(Struct.pick(AiKey.fields, ['owner', 'provider'])),
			execute: request =>
				sql`DELETE FROM ${sql(AiKey.table)} WHERE owner = ${request.owner} AND provider = ${request.provider}`
		})
		// Only a changed status writes, and only on the key that answered, never its replacement.
		const markKey = SqlSchema.void({
			Request: Schema.Struct(Struct.pick(AiKey.fields, ['lastStatus', 'owner', 'provider', 'secret'])),
			execute: request => sql`
				UPDATE ${sql(AiKey.table)} SET lastStatus = ${request.lastStatus}
				WHERE owner = ${request.owner} AND provider = ${request.provider} AND secret = ${request.secret}
				AND lastStatus IS NOT ${request.lastStatus}
			`
		})
		return {
			list: Effect.fn('AiProxy.list')(function* (id: UserId) {
				yield* Effect.annotateCurrentSpan('userId', id)
				return yield* asAuthError(listKeys(id))
			}),
			proxy: Effect.fn('AiProxy.proxy')(function* (provider: AiProvider, rest: string) {
				yield* Effect.annotateCurrentSpan('provider', provider)
				const request = yield* HttpServerRequest.HttpServerRequest
				const now = yield* DateTime.now
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
				const key = yield* asAuthError(findKey({owner: person.success.id, provider}))
				if (Option.isNone(key)) {
					return HttpServerResponse.jsonUnsafe(
						{error: {message: `Add your ${PROVIDER_NAMES[provider]} key in Gateway`}},
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
					)(`${UPSTREAMS[provider]}/${rest}`, {
						headers: Boolean.match(provider === 'anthropic', {
							onFalse: () => Headers.set(headers, 'authorization', `Bearer ${Redacted.value(foundKey.secret)}`),
							onTrue: () => Headers.set(headers, 'x-api-key', Redacted.value(foundKey.secret))
						})
					})
				}
				if (request.method !== 'GET' && request.method !== 'HEAD') {
					if (
						Option.exists(Option.fromUndefinedOr(request.headers['content-type']), String.includes('application/json'))
					) {
						const body = new Uint8Array(yield* request.arrayBuffer)
						const decoded = Schema.decodeOption(
							Schema.fromJsonString(Schema.Struct({model: Schema.OptionFromOptionalKey(AiModelId)}))
						)(new TextDecoder().decode(body))
						outgoing.model = Option.flatMap(decoded, value => value.model)
						outgoing.request = HttpClientRequest.bodyUint8Array(outgoing.request, body, request.headers['content-type'])
					} else {
						outgoing.request = HttpClientRequest.bodyStream(outgoing.request, request.stream, {
							contentType: request.headers['content-type']
						})
					}
				}
				const response = yield* client.execute(outgoing.request)
				// Key bookkeeping cannot turn an upstream action that committed into a failed forwarding request.
				yield* Effect.ignore(
					asAuthError(
						markKey({
							lastStatus: Option.some(response.status),
							owner: person.success.id,
							provider,
							secret: foundKey.secret
						})
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
				yield* Effect.annotateCurrentSpan({provider, userId: id})
				return yield* asAuthError(deleteKey({owner: id, provider}))
			}),
			setKey: Effect.fn('AiProxy.setKey')(function* (id: UserId, provider: AiProvider, secret: Redacted.Redacted) {
				yield* Effect.annotateCurrentSpan({provider, userId: id})
				return yield* asAuthError(
					saveKey({
						last4: String.slice(-4)(Redacted.value(secret)),
						lastStatus: Option.none(),
						owner: id,
						provider,
						secret
					})
				)
			})
		}
	})
}) {
	// These deployed migrations remain unchanged; each later shape change gets its own number.
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
	static readonly layer = pipe(
		Layer.effect(AiProxy, AiProxy.make),
		Layer.provideMerge(AiMetering.layer),
		Layer.provide(AiProxy.migrations)
	)
}
