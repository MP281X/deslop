import {argv, execPath} from 'node:process'

import {NodeCrypto, NodeHttpClient, NodeRuntime, NodeServices} from '@effect/platform-node'

import {Array, Boolean, Config, ConfigProvider, Effect, Layer, Logger, Option, Path, Stdio, Stream, pipe} from 'effect'

import {Command, Flag} from 'effect/cli'

import {savedSettings, saveSettings} from '#cli/config.ts'
import {enroll} from '#cli/enrollment.ts'
import {attachMcp} from '#cli/mcp.ts'
import {oauth} from '#cli/oauth.ts'
import {packageVersion} from '#cli/package.ts'
import {AppError} from '#cli/schema.ts'
import type {AppSettings} from '#cli/schema.ts'
import {service} from '#cli/service.ts'
import {lifecycleLock, managedEntry, probe, update, updateTimer} from '#cli/update.ts'

const flags = {
	auth: pipe(Flag.String('auth'), Flag.withDescription('Optional authorization server URL'), Flag.optional),
	host: pipe(Flag.String('host'), Flag.withDescription('Listen address; defaults to 127.0.0.1'), Flag.optional),
	port: pipe(Flag.Int('port'), Flag.withDescription('Listen port; defaults to 5000'), Flag.optional),
	public: pipe(
		Flag.Boolean('public'),
		Flag.withDefault(false),
		Flag.withDescription('Explicitly allow unauthenticated non-loopback serving')
	),
	traces: pipe(Flag.String('traces'), Flag.withDescription('Optional OTLP/HTTP endpoint'), Flag.optional),
	url: pipe(Flag.String('url'), Flag.withDescription('Canonical public app URL, or MCP attachment URL'), Flag.optional)
}

const settings = Effect.fnUntraced(function* (
	input: {
		auth: Option.Option<string>
		host: Option.Option<string>
		port: Option.Option<number>
		public: boolean
		traces: Option.Option<string>
		url: Option.Option<string>
	},
	serving?: boolean
) {
	const authValue = yield* Option.match(input.auth, {
		onNone: () => pipe(Config.String('AUTH_URL'), Config.withDefault('')),
		onSome: Effect.succeed
	})
	const auth = yield* Boolean.match(authValue === '', {
		onFalse: Effect.fnUntraced(function* () {
			const issuer = yield* Effect.try({
				catch: cause => AppError.make({cause, message: 'Invalid --auth server origin'}),
				try: () => new URL(authValue)
			})
			if (
				!Array.contains(['http:', 'https:'], issuer.protocol) ||
				issuer.username !== '' ||
				issuer.password !== '' ||
				issuer.search !== '' ||
				issuer.hash !== '' ||
				issuer.pathname !== '/'
			) {
				return yield* AppError.make({
					message: '--auth must be an HTTP(S) server origin without credentials, path, query or fragment'
				})
			}
			return issuer.origin
		}),
		onTrue: () => Effect.succeed('')
	})
	const host = yield* Option.match(input.host, {
		onNone: () => pipe(Config.String('HOST'), Config.withDefault('127.0.0.1')),
		onSome: Effect.succeed
	})
	const port = yield* Option.match(input.port, {
		onNone: () => pipe(Config.Port('PORT'), Config.withDefault(5000)),
		onSome: Effect.succeed
	})
	const url = yield* Option.match(input.url, {
		onNone: () => pipe(Config.String('APP_URL'), Config.withDefault(`http://127.0.0.1:${port}`)),
		onSome: Effect.succeed
	})
	const traces = yield* Option.match(input.traces, {
		onNone: () => pipe(Config.String('VITE_OTEL_URL'), Config.withDefault('')),
		onSome: Effect.succeed
	})
	if (port < 1 || port > 65_535) return yield* AppError.make({message: 'Use a port between 1 and 65535'})
	const canonical = yield* Effect.try({
		catch: cause => AppError.make({cause, message: 'Invalid --url'}),
		try: () => new URL(url)
	})
	if (
		!Array.contains(['http:', 'https:'], canonical.protocol) ||
		canonical.username !== '' ||
		canonical.password !== '' ||
		canonical.search !== '' ||
		canonical.hash !== '' ||
		canonical.pathname !== '/'
	) {
		return yield* AppError.make({
			message: '--url must be an HTTP(S) origin without credentials, path, query or fragment'
		})
	}
	if (serving !== false && !Array.contains(['127.0.0.1', 'localhost', '::1'], host) && auth === '' && !input.public) {
		return yield* AppError.make({
			message:
				'Non-loopback listening requires --auth; expose an explicitly configured local service through Deploy instead'
		})
	}
	return {auth, host, port, public: input.public, traces, url: canonical.origin} satisfies AppSettings
})

function configured<A, E>(effect: Effect.Effect<A, E>, config: AppSettings, name: string) {
	return Effect.flatMap(packageVersion(argv[1] ?? ''), version =>
		Effect.provideService(
			effect,
			ConfigProvider.ConfigProvider,
			ConfigProvider.orElse(
				ConfigProvider.fromUnknown({
					APP_URL: config.url,
					APP_VERSION: version,
					AUTH_URL: config.auth,
					...Boolean.match(name === 'auth', {onFalse: () => ({DESLOP_LOCAL: config.auth === ''}), onTrue: () => ({})}),
					HOST: config.host,
					PORT: config.port,
					VITE_OTEL_URL: config.traces
				}),
				ConfigProvider.orElse(ConfigProvider.fromEnv(), ConfigProvider.fromUnknown({NODE_ENV: 'production'}))
			)
		)
	)
}

export function runApp<E>(name: string, effect: Effect.Effect<unknown, E>) {
	const root = pipe(Command.make(name), Command.withSharedFlags(flags))
	const attachment = Effect.gen(function* () {
		return yield* pipe(
			settings(yield* root, false),
			Effect.provideService(
				ConfigProvider.ConfigProvider,
				ConfigProvider.orElse(ConfigProvider.fromUnknown(yield* savedSettings(name)), ConfigProvider.fromEnv())
			)
		)
	})
	const actions = Array.map(['install', 'status', 'uninstall', 'update'] as const, action =>
		Command.make(
			action,
			{},
			Effect.fnUntraced(function* () {
				const config = yield* Boolean.match(action === 'install', {
					onFalse: () => attachment,
					onTrue: () => Effect.flatMap(root, input => settings(input))
				})
				const path = yield* Path.Path
				const stdio = yield* Stdio.Stdio
				if (action === 'update') return yield* Stream.run(Stream.make(yield* update(name, config)), stdio.stdout())
				if (action === 'install') {
					yield* enroll(name, config)
				}
				if (action !== 'status') yield* lifecycleLock(name)
				const entry = yield* Boolean.match(action === 'install', {
					onFalse: () => Effect.succeed(path.resolve(argv[1] ?? '')),
					onTrue: () => managedEntry(name, path.resolve(argv[1] ?? ''))
				})
				yield* Stream.run(
					Stream.make(
						yield* service(name, action, execPath, entry, [
							'--host',
							config.host,
							'--port',
							`${config.port}`,
							'--url',
							config.url,
							'--auth',
							config.auth,
							'--traces',
							config.traces,
							...Boolean.match(config.public, {onFalse: () => [], onTrue: () => ['--public']})
						])
					),
					stdio.stdout()
				)
				if (action === 'install') {
					yield* probe(config, yield* packageVersion(entry))
					yield* saveSettings(name, config)
				}
				if (name === 'deploy' && action !== 'status') yield* updateTimer(name, execPath, entry, action === 'uninstall')
			})
		)
	)
	const command = pipe(
		root,
		Command.withHandler(input =>
			Effect.flatMap(settings(input), config => Effect.andThen(enroll(name, config), configured(effect, config, name)))
		),
		Command.withSubcommands([
			pipe(Command.make('service'), Command.withSubcommands(actions)),
			Command.make(
				'login',
				{},
				Effect.fnUntraced(function* () {
					const config = yield* attachment
					if (config.auth === '') {
						return yield* AppError.make({message: 'Specify --auth and the HTTPS --url of the running app'})
					}
					yield* (yield* oauth(name, config.url, config.auth)).login
				})
			),
			Command.make(
				'mcp',
				{},
				Effect.fnUntraced(function* () {
					const config = yield* attachment
					return yield* attachMcp(name, new URL('/mcp', config.url).href, config.auth)
				})
			)
		])
	)
	NodeRuntime.runMain(
		pipe(
			Effect.flatMap(packageVersion(argv[1] ?? ''), version => Command.run(command, {version})),
			Effect.scoped,
			// @effect-diagnostics-next-line strictEffectProvide:off -- This shared CLI owns the application entry point and platform lifetime.
			Effect.provide(Layer.mergeAll(NodeServices.layer, NodeHttpClient.layerFetch, NodeCrypto.layer)),
			Effect.provideService(Logger.LogToStderr, true)
		)
	)
}
