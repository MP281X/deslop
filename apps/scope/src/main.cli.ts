import {NodeRuntime, NodeServices} from '@effect/platform-node'

import {
	Clock,
	Config,
	Console,
	Duration,
	Effect,
	FileSystem,
	Layer,
	Logger,
	Redacted,
	Schema,
	Stream,
	String,
	pipe
} from 'effect'

import {Argument, Command, Flag} from 'effect/cli'
import {RpcClient, RpcSerialization} from 'effect/rpc'
import {Socket} from 'effect/socket'

import {AuthError} from '@deslop/auth/schema'
import {AUTH_URL, RpcAuth} from '@deslop/auth/utils'

import packageJson from '#package.json' with {type: 'json'}

import {RpcContracts} from '#rpcs/contracts.ts'
import {Page, Query, Service, Stats, TelemetryError, Trace, TraceId, TracesPage} from '#services/telemetry/schema.ts'

const server = pipe(
	Flag.String('server'),
	Flag.withFallbackConfig(Config.String('SCOPE_SERVER')),
	Flag.withDefault('https://scope.mp281x.xyz')
)
const dev = pipe(
	Flag.Boolean('dev'),
	Flag.withDefault(false),
	Flag.withDescription('Use the development server’s mock authentication instead of a stored API key.')
)
const filters = {
	dev,
	errors: pipe(Flag.Boolean('errors'), Flag.withDefault(false)),
	limit: pipe(Flag.Int('limit'), Flag.withDefault(100)),
	offset: pipe(Flag.Int('offset'), Flag.withDefault(0)),
	operation: pipe(Flag.String('operation'), Flag.withDefault('')),
	server,
	service: pipe(Flag.String('service'), Flag.withDefault('')),
	since: pipe(
		Flag.String('since'),
		Flag.withSchema(Schema.DurationFromString),
		Flag.withDefault(Duration.minutes(10)),
		Flag.withDescription('Lookback duration, e.g. "10 minutes" or "1 hour". Defaults to 10 minutes.')
	),
	sort: pipe(Flag.Literals('sort', ['recent', 'slowest']), Flag.withDefault('recent')),
	text: pipe(Flag.String('text'), Flag.withDefault('')),
	traceId: pipe(Flag.String('trace'), Flag.withDefault(''))
}

function protocol(url: string, mock: boolean) {
	return Layer.merge(
		pipe(
			RpcClient.layerProtocolSocket({pingTimeout: '15 seconds'}),
			Layer.provide(Socket.layerWebSocket(pipe(new URL('/api/rpc', url).href, String.replace(/^http/u, 'ws')))),
			Layer.provide(Socket.layerWebSocketConstructorGlobal),
			Layer.provide(RpcSerialization.layerSchemaBinary())
		),
		RpcAuth.layerClient(
			pipe(
				Effect.gen(function* () {
					if (mock) return 'development'
					return yield* (yield* FileSystem.FileSystem).readFileString(
						`${yield* Config.String('HOME')}/.deslop/scope/api-key`
					)
				}),
				Effect.mapError(cause =>
					AuthError.make({cause, message: `Create an API key at ${AUTH_URL}, then run scope login '<api key>'.`})
				)
			)
		)
	)
}

const login = pipe(
	Command.make(
		'login',
		{key: Argument.Redacted('api-key')},
		Effect.fnUntraced(function* (input) {
			const fs = yield* FileSystem.FileSystem
			const directory = `${yield* Config.String('HOME')}/.deslop/scope`
			yield* fs.makeDirectory(directory, {recursive: true})
			yield* fs.writeFileString(`${directory}/api-key`, Redacted.value(input.key), {mode: 0o600})
			yield* Effect.logInfo('Signed in to Scope.')
		})
	),
	Command.withDescription(`Store an API key from ${AUTH_URL} in ~/.deslop/scope/api-key.`)
)

const services = pipe(
	Command.make(
		'services',
		{dev, server},
		Effect.fnUntraced(function* () {
			yield* Console.log(
				yield* Schema.encodeEffect(Schema.fromJsonString(Schema.Array(Service), {space: 2}))(
					yield* (yield* RpcClient.make(RpcContracts))['telemetry.services'](undefined)
				)
			)
		})
	),
	Command.provide(input => protocol(input.server, input.dev)),
	Command.withDescription('List current services and their frontend/backend runtimes.')
)

const query = Effect.fnUntraced(function* (input: Command.Command.Config.Infer<typeof filters>) {
	const now = yield* Clock.currentTimeMillis
	return yield* pipe(
		Query.makeEffect({...input, from: now - Duration.toMillis(input.since), to: now}),
		Effect.mapError(cause =>
			TelemetryError.make({
				cause,
				message: 'Use a positive limit up to 1000, a nonnegative offset and a finite lookback.'
			})
		)
	)
})

const traces = pipe(
	Command.make(
		'traces',
		filters,
		Effect.fnUntraced(function* (input) {
			yield* Console.log(
				yield* Schema.encodeEffect(Schema.fromJsonString(TracesPage, {space: 2}))(
					yield* (yield* RpcClient.make(RpcContracts))['telemetry.traces'](yield* query(input))
				)
			)
		})
	),
	Command.provide(input => protocol(input.server, input.dev)),
	Command.withDescription('Search traces. JSON includes the full matching count; paginate with --offset.')
)

const spans = pipe(
	Command.make(
		'spans',
		filters,
		Effect.fnUntraced(function* (input) {
			yield* Console.log(
				yield* Schema.encodeEffect(Schema.fromJsonString(Page, {space: 2}))(
					yield* (yield* RpcClient.make(RpcContracts))['telemetry.spans'](yield* query(input))
				)
			)
		})
	),
	Command.provide(input => protocol(input.server, input.dev)),
	Command.withDescription('Search individual spans, including their original OTLP fields.')
)

const logs = pipe(
	Command.make(
		'logs',
		filters,
		Effect.fnUntraced(function* (input) {
			yield* Console.log(
				yield* Schema.encodeEffect(Schema.fromJsonString(Page, {space: 2}))(
					yield* (yield* RpcClient.make(RpcContracts))['telemetry.logs'](yield* query(input))
				)
			)
		})
	),
	Command.provide(input => protocol(input.server, input.dev)),
	Command.withDescription('Search standalone or trace-correlated logs.')
)

const stats = pipe(
	Command.make(
		'stats',
		filters,
		Effect.fnUntraced(function* (input) {
			yield* Console.log(
				yield* Schema.encodeEffect(Schema.fromJsonString(Stats, {space: 2}))(
					yield* (yield* RpcClient.make(RpcContracts))['telemetry.stats'](yield* query(input))
				)
			)
		})
	),
	Command.provide(input => protocol(input.server, input.dev)),
	Command.withDescription('Span latency and error counts across the entire window, not just the first page.')
)

const trace = pipe(
	Command.make(
		'trace',
		{dev, id: pipe(Argument.String('trace-id'), Argument.withSchema(TraceId)), server},
		Effect.fnUntraced(function* (input) {
			yield* Console.log(
				yield* Schema.encodeEffect(Schema.fromJsonString(Trace, {space: 2}))(
					yield* (yield* RpcClient.make(RpcContracts))['telemetry.trace'](input.id)
				)
			)
		})
	),
	Command.provide(input => protocol(input.server, input.dev)),
	Command.withDescription('Read every received span and log for one trace; no time window or result cap.')
)

const watch = pipe(
	Command.make(
		'watch',
		filters,
		Effect.fnUntraced(function* (input) {
			const client = yield* RpcClient.make(RpcContracts)
			yield* pipe(
				client['telemetry.watch'](undefined),
				Stream.mapEffect(
					Effect.fnUntraced(function* () {
						return yield* Schema.encodeEffect(Schema.fromJsonString(TracesPage))(
							yield* client['telemetry.traces'](yield* query(input))
						)
					})
				),
				Stream.changes,
				Stream.runForEach(value => Console.log(value))
			)
		})
	),
	Command.provide(input => protocol(input.server, input.dev)),
	Command.withDescription(
		'Follow matching traces as newline-delimited JSON. Emits an initial snapshot, then changes; Ctrl-C stops.'
	)
)

NodeRuntime.runMain(
	pipe(
		Command.make('scope'),
		Command.withDescription(
			'Inspect Effect traces and logs. Every command writes JSON to stdout; diagnostics go to stderr.'
		),
		Command.withSubcommands([login, services, traces, spans, logs, stats, trace, watch]),
		Command.run({version: packageJson.version}),
		Effect.scoped,
		Effect.provideService(Logger.LogToStderr, true),
		// @effect-diagnostics-next-line strictEffectProvide:off -- This CLI entrypoint owns the single platform Layer and its resource lifetime.
		Effect.provide(NodeServices.layer)
	)
)
