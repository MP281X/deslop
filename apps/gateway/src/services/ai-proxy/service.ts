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
	Stream,
	String,
	Struct,
	pipe
} from 'effect'

import {Headers, HttpClient, HttpClientRequest, HttpServerRequest, HttpServerResponse} from 'effect/http'
import {Reactivity} from 'effect/reactivity'
import type {SqlError} from 'effect/sql'
import {Migrator, SqlClient, SqlSchema} from 'effect/sql'

import {Auth} from '@deslop/runtime/server/auth'
import {AiModelId} from '@deslop/runtime/shared/ai'
import {AuthError, CLIENT_HEADER, ON_BEHALF_HEADER, failureOptions} from '@deslop/runtime/shared/auth'
import type {UserId} from '@deslop/runtime/shared/auth'

import {migrations} from './migrations.ts'
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
	const state: {path: Option.Option<string>} = {path: Option.some(Array.headNonEmpty(String.split(rest, '?')))}
	while (Option.exists(state.path, String.includes('%'))) {
		state.path = Option.flatMap(state.path, Option.liftThrowable(decodeURIComponent))
	}
	return Option.filter(state.path, value => !String.includes('..')(value))
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
		if (
			method !== 'POST' ||
			pipe(rest, String.match(/^openai\/v1\/(?:responses|chat\/completions)(?:\?.*)?$/u), Option.isNone)
		) {
			return Result.fail(HttpServerResponse.jsonUnsafe({error: {message: 'Unknown OpenAI endpoint'}}, {status: 404}))
		}
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

const asAuthError = Effect.mapError((cause: SqlError.SqlError | Schema.SchemaError) =>
	AuthError.make({cause, error: 'temporarily_unavailable', message: 'AI Gateway storage failed'})
)

declare module 'effect/reactivity/Reactivity' {
	interface Keys {
		readonly aiKeys: UserId
	}
}

export class AiProxy extends Context.Service<AiProxy>()('@deslop/gateway/services/ai-proxy/service/AiProxy', {
	make: Effect.gen(function* () {
		const sql = yield* SqlClient.SqlClient
		const reactivity = yield* Reactivity.Reactivity
		const withReactivity = Effect.provideService(Reactivity.Reactivity, reactivity)
		const auth = yield* Auth
		const client = yield* HttpClient.HttpClient
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
		const deleteKey = SqlSchema.findOneOption({
			Request: Schema.Struct({owner: AiKey.fields.owner, provider: AiProvider}),
			Result: Schema.Struct({provider: AiProvider}),
			execute: key =>
				sql`DELETE FROM ${sql(AiKey.table)} WHERE owner = ${key.owner} AND provider = ${key.provider} RETURNING provider`
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
			key: (id: UserId) =>
				pipe(
					sql.reactive({aiKeys: [id]}, asAuthError(listKeys(id))),
					Stream.provideService(Reactivity.Reactivity, reactivity),
					Stream.withSpan('AiProxy.key', {attributes: {'rpc.stream': true, userId: id}})
				),
			proxy: Effect.fn('AiProxy.proxy')(function* (rest: string) {
				const request = yield* HttpServerRequest.HttpServerRequest
				const now = yield* DateTime.now
				const person = yield* Effect.result(auth.user(request.headers))
				if (Result.isFailure(person)) {
					return HttpServerResponse.jsonUnsafe(
						{error: {message: 'AI access could not be verified. Check your sign-in or try again shortly.'}},
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
				return yield* Option.match(yield* asAuthError(findKey({owner: person.success.id, provider})), {
					onNone: () =>
						Effect.succeed(
							HttpServerResponse.jsonUnsafe(
								{
									error: {
										message: `Save your ${{anthropic: 'Anthropic API', openai: 'OpenAI API', opencode: 'OpenCode service account'}[provider]} key in Gateway`
									}
								},
								{status: 402}
							)
						),
					onSome: Effect.fnUntraced(function* (foundKey) {
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
							outgoing.request = HttpClientRequest.bodyUint8Array(
								outgoing.request,
								body,
								request.headers['content-type']
							)
						}
						const destination = destinationOf(request.method, rest, outgoing.model)
						if (Result.isFailure(destination)) return destination.failure
						const response = yield* client.execute(HttpClientRequest.setUrl(outgoing.request, destination.success))
						// Key bookkeeping cannot turn an upstream action that committed into a failed forwarding request.
						yield* Effect.ignore(
							pipe(
								markKey({lastStatus: Option.some(response.status), owner: person.success.id, secret: foundKey.secret}),
								Reactivity.mutation({aiKeys: [person.success.id]}),
								withReactivity,
								asAuthError
							),
							{log: 'Warn', message: 'AI key status could not be saved'}
						)
						const meter = yield* metering.observe(
							foundKey.owner,
							provider,
							outgoing.model,
							now,
							Option.exists(
								Option.fromUndefinedOr(response.headers['content-type']),
								String.includes('text/event-stream')
							)
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
							pipe(response.stream, Stream.tap(meter.write), Stream.onExit(meter.save)),
							{headers: Headers.removeMany(response.headers, blocked), status: response.status}
						)
					})
				})
			}),
			removeKey: Effect.fn('AiProxy.removeKey')(function* (id: UserId, provider: AiProvider) {
				yield* Effect.annotateCurrentSpan('userId', id)
				if (
					Option.isNone(
						yield* pipe(
							deleteKey({owner: id, provider}),
							Reactivity.mutation({aiKeys: [id]}),
							withReactivity,
							asAuthError
						)
					)
				) {
					return yield* AuthError.make({message: `No ${provider} key is saved. Nothing changed.`})
				}
			}),
			setKey: Effect.fn('AiProxy.setKey')(function* (id: UserId, input: AiSetKey) {
				yield* Effect.annotateCurrentSpan('userId', id)
				return yield* pipe(
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
					}),
					Reactivity.mutation({aiKeys: [id]}),
					withReactivity,
					asAuthError
				)
			})
		}
	})
}) {
	// The tables this service owns, made and changed at start in one transaction; one statement per `sql` call, since SQLite runs only the first statement of a string.
	static readonly migrations = Layer.effectDiscard(
		Migrator.make({})({loader: Migrator.fromRecord(migrations), table: 'ai_migrations'})
	)
	static readonly layer = pipe(
		Layer.effect(AiProxy, AiProxy.make),
		Layer.provideMerge(AiMetering.layer),
		Layer.provide(AiProxy.migrations)
	)
}
