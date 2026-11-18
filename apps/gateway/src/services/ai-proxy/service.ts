import {
	Array,
	Boolean,
	Cause,
	Context,
	DateTime,
	Duration,
	Effect,
	Function,
	HashSet,
	Layer,
	Match,
	Option,
	Redacted,
	Result,
	Schema,
	Semaphore,
	Stream,
	String,
	Struct,
	pipe
} from 'effect'

import {
	FetchHttpClient,
	Headers,
	HttpClient,
	HttpClientRequest,
	HttpServerRequest,
	HttpServerResponse
} from 'effect/http'
import {Reactivity} from 'effect/reactivity'
import type {SqlError} from 'effect/sql'
import {Migrator, SqlClient, SqlSchema} from 'effect/sql'

import {Auth} from '@deslop/runtime/server/auth'
import {AiModelId} from '@deslop/runtime/shared/ai'
import {AuthError, failureOptions} from '@deslop/runtime/shared/auth'
import type {UserId} from '@deslop/runtime/shared/auth'

import {migrations} from './migrations.ts'
import type {AiSetKey} from './schema.ts'
import {AiKey, AiKeyItem, AiProvider, AiRefusalError, JsonBody} from './schema.ts'

import {AiMetering} from '#services/ai-metering/service.ts'

// The headers a provider's API reads; proxy metadata, Tailscale identity, cookies and trace ids stay here.
const REQUEST_PREFIXES: Record<AiProvider, readonly string[]> = {
	anthropic: ['anthropic-'],
	openai: ['openai-'],
	opencode: ['anthropic-', 'openai-', 'x-opencode-']
}
// The headers a caller reads: the body's type, request ids, rate limits and retry hints, never cookies or caching.
const RESPONSE_PREFIXES = ['anthropic-', 'openai-', 'x-ratelimit-']
const REQUEST_HEADERS = HashSet.make('accept', 'content-type', 'idempotency-key', 'user-agent')
const RESPONSE_HEADERS = HashSet.make('content-type', 'request-id', 'retry-after', 'x-request-id')
// A provider gets this long to start answering, and then this long between chunks.
const ANSWER_DEADLINE = Duration.minutes(10)

function kept(headers: Headers.Headers, names: HashSet.HashSet<string>, prefixes: readonly string[]) {
	return Headers.removeMany(
		headers,
		Array.filter(
			// oxlint-disable-next-line effecttsgo/prefer-effect-record -- Headers carries symbol-keyed members Record.keys does not accept; only its header names are read.
			Object.keys(headers),
			name => !HashSet.has(names, name) && !Array.some(prefixes, prefix => String.startsWith(prefix)(name))
		)
	)
}

function failure(message: string, status: number) {
	return HttpServerResponse.jsonUnsafe({error: {message}}, {status})
}

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
	if (Option.isNone(path)) return Result.fail(failure('Invalid inference path', 400))
	if (String.startsWith('openai/')(rest)) {
		if (
			method !== 'POST' ||
			pipe(rest, String.match(/^openai\/v1\/(?:responses|chat\/completions)(?:\?.*)?$/u), Option.isNone)
		) {
			return Result.fail(failure('Unknown OpenAI endpoint', 404))
		}
		return Result.succeed(`https://api.openai.com/${String.slice('openai/'.length)(rest)}`)
	}
	if (!String.startsWith('anthropic/')(rest)) {
		if (Option.exists(model, isClaude) || Option.exists(path, isClaude)) {
			return Result.fail(failure('Claude must use the Anthropic key: use /ai/anthropic/v1/messages', 403))
		}
		return Result.succeed(`https://opencode.ai/inference/${rest}`)
	}
	if (method !== 'POST' || pipe(rest, String.match(/^anthropic\/v1\/messages(?:\?.*)?$/u), Option.isNone)) {
		return Result.fail(failure('Unknown Anthropic endpoint', 404))
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
		// Each exchange belongs to its request's scope, so a caller that leaves before reading the answer aborts it too; a redirect is never followed past the provider, and Gateway's trace ids stay here.
		const client = pipe(
			yield* HttpClient.HttpClient,
			HttpClient.withScope,
			HttpClient.transformResponse(Effect.provideService(FetchHttpClient.RequestInit, {redirect: 'error'})),
			HttpClient.transformResponse(Effect.provideService(HttpClient.TracerPropagationEnabled, false))
		)
		const metering = yield* AiMetering
		// Calls in flight at once, each holding its body and meter; more are refused, not queued.
		const admission = yield* Semaphore.make(32)
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
					// A slow reader gets only the newest list.
					Stream.buffer({capacity: 1, strategy: 'sliding'}),
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
					onSome: Effect.fnUntraced(
						function* (foundKey) {
							const admitted = yield* Effect.acquireRelease(Semaphore.takeIfAvailable(admission, 1), taken =>
								Boolean.match(taken, {onFalse: () => Effect.void, onTrue: () => Semaphore.release(admission, 1)})
							)
							if (!admitted) {
								return yield* AiRefusalError.make({
									message: 'Too many AI calls are in flight; retry shortly',
									status: 429
								})
							}
							const method = yield* Schema.decodeUnknownEffect(
								Schema.Literals(['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD', 'OPTIONS'])
							)(request.method)
							const sent = yield* Boolean.match(method === 'GET' || method === 'HEAD', {
								onFalse: Effect.fnUntraced(function* () {
									if (
										!Option.exists(Option.fromUndefinedOr(request.headers['content-type']), type =>
											String.startsWith('application/json')(String.toLowerCase(type))
										) ||
										!Option.match(Option.fromUndefinedOr(request.headers['content-encoding']), {
											onNone: Function.constTrue,
											onSome: encoding => String.toLowerCase(encoding) === 'identity'
										})
									) {
										return yield* AiRefusalError.make({message: 'Send the body as uncompressed JSON', status: 415})
									}
									const bytes = new Uint8Array(yield* request.arrayBuffer)
									// The model policy and the provider read the same parsed JSON: the body is sent as Gateway decoded it.
									const parsed = yield* pipe(
										Option.liftThrowable(() => new TextDecoder('utf-8', {fatal: true}).decode(bytes))(),
										Option.flatMap(Schema.decodeOption(JsonBody)),
										Option.map(fields => ({
											// Chat Completions streams report usage only when asked, and without it the call's cost is never known.
											fields: Boolean.match(
												rest === 'openai/v1/chat/completions' &&
													fields['stream'] === true &&
													fields['stream_options'] === undefined,
												{onFalse: () => fields, onTrue: () => ({...fields, stream_options: {include_usage: true}})}
											),
											model: Schema.decodeUnknownOption(AiModelId)(fields['model'])
										})),
										Option.match({
											onNone: () => AiRefusalError.make({message: 'The body must be a JSON object', status: 400}),
											onSome: Effect.succeed
										})
									)
									return {body: Option.some(yield* Schema.encodeEffect(JsonBody)(parsed.fields)), model: parsed.model}
								}),
								onTrue: () => Effect.succeed({body: Option.none<string>(), model: Option.none<AiModelId>()})
							})
							const destination = destinationOf(method, rest, sent.model)
							if (Result.isFailure(destination)) return destination.failure
							const forwarded = kept(request.headers, REQUEST_HEADERS, REQUEST_PREFIXES[provider])
							const response = yield* pipe(
								HttpClientRequest.make(method)(destination.success, {
									headers: Boolean.match(provider === 'anthropic', {
										onFalse: () => Headers.set(forwarded, 'authorization', `Bearer ${Redacted.value(foundKey.secret)}`),
										onTrue: () => Headers.set(forwarded, 'x-api-key', Redacted.value(foundKey.secret))
									})
								}),
								outgoing =>
									Option.match(sent.body, {
										onNone: () => outgoing,
										onSome: text => HttpClientRequest.bodyText(outgoing, text, 'application/json')
									}),
								client.execute,
								Effect.timeout(ANSWER_DEADLINE),
								Effect.catchTags({
									HttpClientError: () =>
										AiRefusalError.make({message: 'The AI provider could not be reached', status: 502}),
									TimeoutError: () =>
										AiRefusalError.make({message: 'The AI provider did not answer in time', status: 504})
								})
							)
							// Key bookkeeping cannot turn an upstream action that committed into a failed forwarding request.
							yield* Effect.ignore(
								pipe(
									markKey({
										lastStatus: Option.some(response.status),
										owner: person.success.id,
										secret: foundKey.secret
									}),
									Reactivity.mutation({aiKeys: [person.success.id]}),
									withReactivity,
									asAuthError
								),
								{log: 'Warn', message: 'AI key status could not be saved'}
							)
							const meter = yield* metering.observe(foundKey.owner, provider, sent.model, now, {
								accepted: response.status >= 200 && response.status < 300,
								sse: Option.exists(
									Option.fromUndefinedOr(response.headers['content-type']),
									String.includes('text/event-stream')
								)
							})
							return HttpServerResponse.stream(
								pipe(
									response.stream,
									Stream.timeoutOrElse({
										duration: ANSWER_DEADLINE,
										orElse: () => Stream.fail(new Cause.TimeoutError('The AI provider stopped answering'))
									}),
									Stream.tap(meter.write),
									Stream.ensuring(meter.save)
								),
								{headers: kept(response.headers, RESPONSE_HEADERS, RESPONSE_PREFIXES), status: response.status}
							)
						},
						Effect.catchTag('AiRefusalError', refusal => Effect.succeed(failure(refusal.message, refusal.status)))
					)
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
