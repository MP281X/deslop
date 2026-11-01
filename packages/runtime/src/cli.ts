import {argv, execPath} from 'node:process'

import {NodeCrypto, NodeHttpClient, NodeRuntime, NodeServices} from '@effect/platform-node'

import {
	Array,
	Boolean,
	Config,
	ConfigProvider,
	Effect,
	Layer,
	Logger,
	Option,
	Path,
	Schema,
	Stdio,
	Stream,
	String,
	pipe
} from 'effect'

import {Command, Flag} from 'effect/cli'

import {savedSettings, saveSettings} from '#cli/config.ts'
import {enroll} from '#cli/enrollment.ts'
import {oauth} from '#cli/oauth.ts'
import {AppError, AppSettings} from '#cli/schema.ts'
import type {PackageMetadata} from '#cli/schema.ts'
import {service} from '#cli/service.ts'
import {lifecycleLock, managedEntry, probe, update, updateTimer} from '#cli/update.ts'

const flags = {
	auth: pipe(Flag.String('auth'), Flag.withDescription('Optional Deslop Auth server origin'), Flag.optional),
	host: pipe(Flag.String('host'), Flag.withDescription('Listen address; defaults to 127.0.0.1'), Flag.optional),
	port: pipe(Flag.Int('port'), Flag.withDescription('Listen port; defaults to 5000'), Flag.optional),
	traces: pipe(Flag.String('traces'), Flag.withDescription('Optional OTLP/HTTP endpoint'), Flag.optional),
	url: pipe(Flag.String('url'), Flag.withDescription('Canonical app origin'), Flag.optional)
}

const settings = Effect.fnUntraced(function* (input: Command.Command.Config.Infer<typeof flags>) {
	const port = yield* Option.match(input.port, {
		onNone: () => pipe(Config.Port('PORT'), Config.withDefault(5000)),
		onSome: Effect.succeed
	})
	const value = yield* Schema.decodeEffect(AppSettings)({
		auth: yield* Option.match(input.auth, {
			onNone: () => pipe(Config.String('AUTH_URL'), Config.withDefault('')),
			onSome: Effect.succeed
		}),
		host: yield* Option.match(input.host, {
			onNone: () => pipe(Config.String('HOST'), Config.withDefault('127.0.0.1')),
			onSome: Effect.succeed
		}),
		port,
		traces: yield* Option.match(input.traces, {
			onNone: () => pipe(Config.String('OTEL_URL'), Config.withDefault('')),
			onSome: Effect.succeed
		}),
		url: yield* Option.match(input.url, {
			onNone: () => pipe(Config.String('APP_URL'), Config.withDefault(`http://127.0.0.1:${port}`)),
			onSome: Effect.succeed
		})
	})
	return {
		...value,
		auth: Boolean.match(value.auth === '', {onFalse: () => new URL(value.auth).origin, onTrue: () => ''}),
		url: new URL(value.url).origin
	}
})

function configured<A, E>(effect: Effect.Effect<A, E>, config: AppSettings, name: string, version: string) {
	return Effect.provideService(
		effect,
		ConfigProvider.ConfigProvider,
		ConfigProvider.orElse(
			ConfigProvider.fromUnknown({
				APP_URL: config.url,
				APP_VERSION: version,
				AUTH_URL: config.auth,
				...Boolean.match(name === 'auth', {onFalse: () => ({DESLOP_LOCAL: config.auth === ''}), onTrue: () => ({})}),
				HOST: config.host,
				OTEL_URL: config.traces,
				PORT: config.port
			}),
			ConfigProvider.orElse(ConfigProvider.fromEnv(), ConfigProvider.fromUnknown({NODE_ENV: 'production'}))
		)
	)
}

export function runApp<E>(metadata: Pick<PackageMetadata, 'name' | 'version'>, effect: Effect.Effect<unknown, E>) {
	const name = String.replace('@deslop/', '')(metadata.name)
	const root = pipe(Command.make(name), Command.withSharedFlags(flags))
	const installedSettings = Effect.gen(function* () {
		return yield* pipe(
			settings(yield* root),
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
					onFalse: () => installedSettings,
					onTrue: () => Effect.flatMap(root, settings)
				})
				const path = yield* Path.Path
				const stdio = yield* Stdio.Stdio
				if (action === 'update') return yield* Stream.run(Stream.make(yield* update(name, config)), stdio.stdout())
				if (action === 'install') yield* enroll(name, config)
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
							config.traces
						])
					),
					stdio.stdout()
				)
				if (action === 'install') {
					yield* probe(config, metadata.version)
					yield* saveSettings(name, config)
				}
				if (name === 'deploy' && action !== 'status') yield* updateTimer(name, execPath, entry, action === 'uninstall')
			})
		)
	)
	const command = pipe(
		root,
		Command.withHandler(input =>
			Effect.flatMap(settings(input), config =>
				Effect.andThen(enroll(name, config), configured(effect, config, name, metadata.version))
			)
		),
		Command.withSubcommands([
			pipe(Command.make('service'), Command.withSubcommands(actions)),
			Command.make(
				'login',
				{},
				Effect.fnUntraced(function* () {
					const config = yield* installedSettings
					if (config.auth === '') {
						return yield* AppError.make({message: 'Specify --auth and the HTTPS --url of the running app'})
					}
					yield* (yield* oauth(name, config.url, config.auth)).login
				})
			)
		])
	)
	NodeRuntime.runMain(
		pipe(
			Command.run(command, {version: metadata.version}),
			Effect.scoped,
			// @effect-diagnostics-next-line strictEffectProvide:off -- This shared CLI owns the application entry point and platform lifetime.
			Effect.provide(Layer.mergeAll(NodeServices.layer, NodeHttpClient.layerFetch, NodeCrypto.layer)),
			Effect.provideService(Logger.LogToStderr, true)
		)
	)
}
