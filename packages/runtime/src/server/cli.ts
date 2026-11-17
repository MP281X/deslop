import {execArgv, execPath} from 'node:process'

import {NodeCrypto, NodeHttpClient, NodeRuntime, NodeServices} from '@effect/platform-node'

import {
	Array,
	Boolean,
	Config,
	ConfigProvider,
	Effect,
	FileSystem,
	Function,
	Layer,
	Logger,
	Option,
	Path,
	Predicate,
	Record,
	Schema,
	Stdio,
	Stream,
	String,
	pipe
} from 'effect'

import {Command, Flag} from 'effect/cli'
import type {HttpServerResponse} from 'effect/http'
import {HttpRouter} from 'effect/http'

import {AiGateway} from '#server/ai.ts'
import {Auth} from '#server/auth.ts'
import {
	serverMiddleware,
	layerIcon,
	layerNodeHttpServer,
	layerProbeHttpServer,
	layerServerProtocol,
	layerRoutes,
	layerTelemetry,
	layerWeb
} from '#server/http.ts'
import {appName, packageMetadata, packageRoot} from '#server/package.ts'
import {layerProbeRouter, probeServer} from '#server/probe.ts'
import {executeProcess} from '#server/process.ts'
import {installService, installUpdateService, serviceStatus, uninstallService} from '#server/services.ts'
import {dataDirectory, layerDataStore} from '#server/store.ts'
import {activateRelease, updateRelease} from '#server/update.ts'
import type {RpcAuth, RpcAdmin} from '#shared/auth.ts'
import {Port} from '#shared/schema.ts'

const DEFAULT_HOST = '127.0.0.1'

type TailnetSelf = typeof TailnetSelf.Type
const TailnetSelf = Schema.Struct({Self: Schema.Struct({DNSName: Schema.NonEmptyString})})

export type Setting = {
	readonly description: string
	readonly flag: string
	readonly schema: Schema.Codec<string, string>
}

const SETTINGS = {
	DOMAIN: {
		description: 'Parent domain for Deslop apps; without it every caller is the developer',
		flag: 'domain',
		schema: Schema.String.check(Schema.isPattern(/^(?:[a-z\d](?:[a-z\d-]*[a-z\d])?\.)+[a-z](?:[a-z\d-]*[a-z\d])?$/iu))
	},
	HOST: {description: `Listen address; defaults to ${DEFAULT_HOST}`, flag: 'host', schema: Schema.NonEmptyString}
} satisfies Record<string, Setting>

const configProvider = Effect.fnUntraced(function* (given: Record<string, string>, defaultPort: number) {
	const port = given['PORT'] ?? `${defaultPort}`
	const name = yield* appName
	// Without a domain, Tailscale Serve publishes the app on this machine's tailnet name at the same port, as worker Deploys and previews do.
	const urls = yield* Option.match(Option.fromUndefinedOr(given['DOMAIN']), {
		onNone: () =>
			pipe(
				executeProcess('tailscale', ['status', '--json']),
				Effect.flatMap(Schema.decodeUnknownEffect(Schema.fromJsonString(TailnetSelf))),
				Effect.map(status => ({APP_URL: `https://${String.replace(/\.$/u, '')(status.Self.DNSName)}:${port}`})),
				Effect.timeout('5 seconds')
			),
		onSome: domain =>
			Effect.succeed({
				APP_URL: `https://${name}.${domain}`,
				AUTH_URL: `https://auth.${domain}`,
				GATEWAY_URL: `https://gateway.${domain}`,
				OTEL_URL: `https://scope.${domain}`
			})
	})
	const environment = ConfigProvider.fromEnv()
	return ConfigProvider.orElse(
		ConfigProvider.fromUnknown({HOST: DEFAULT_HOST, ...given, ...urls, PORT: port}),
		ConfigProvider.make(path => {
			if (
				Array.some(
					path,
					key => Predicate.isString(key) && Array.contains(['APP_URL', 'AUTH_URL', 'GATEWAY_URL', 'OTEL_URL'], key)
				)
			) {
				return Effect.undefined
			}
			return environment.load(path)
		})
	)
})

const layerPlatform = Layer.mergeAll(NodeServices.layer, NodeHttpClient.layerFetch, NodeCrypto.layer)

type Provided =
	| Layer.Success<typeof layerPlatform>
	| HttpRouter.HttpRouter
	| Auth
	| AiGateway
	| RpcAuth
	| RpcAdmin
	| Layer.Success<ReturnType<typeof layerDataStore>>
	| Layer.Success<typeof layerServerProtocol>

export type Routes<A, E> = Layer.Layer<
	A,
	E,
	// fallow-ignore-next-line private-type-leak -- App route layers expose inferred platform requirements, not a type callers construct or import.
	| Provided
	| HttpRouter.Request<RequestErrorKind, unknown>
	| HttpRouter.Request<RequestRequiresKind, Provided | HttpRouter.GlobalProvided>
>

// oxlint-disable-next-line @deslop/coding-standards/choices-are-schemas -- HttpRouter.Request kinds are type-only library markers; no runtime value is decoded or constructed.
export type RequestErrorKind = 'Error' | 'GlobalError'
// oxlint-disable-next-line @deslop/coding-standards/choices-are-schemas -- HttpRouter.Request kinds are type-only library markers; no runtime value is decoded or constructed.
export type RequestRequiresKind = 'Requires' | 'GlobalRequires'

export type App<A, E> = {
	readonly auth?: Layer.Layer<
		Auth | RpcAuth | RpcAdmin,
		E,
		Layer.Success<typeof layerPlatform> | Layer.Success<ReturnType<typeof layerDataStore>>
	>
	readonly icon: string
	readonly routes: Routes<A, E>
	readonly middleware?: <A, R>(
		app: Effect.Effect<HttpServerResponse.HttpServerResponse, A, R>
	) => Effect.Effect<HttpServerResponse.HttpServerResponse, A, R>
	readonly settings?: Record<string, Setting>
	// Scope receives telemetry, so it never exports its own.
	readonly telemetry?: false
}

function server<A, E>(app: App<A, E>, listener = layerNodeHttpServer) {
	const routes = pipe(
		Layer.mergeAll(app.routes, layerRoutes, layerIcon(app.icon), layerWeb),
		Layer.provide(layerProbeRouter),
		Layer.provide(
			Option.match(Option.fromUndefinedOr(app.middleware), {
				onNone: () => Layer.empty,
				onSome: middleware => HttpRouter.middleware()(middleware).layer
			})
		)
	)
	return pipe(
		HttpRouter.serve(
			pipe(
				Option.match(Option.fromUndefinedOr(app.auth), {
					onNone: () => Layer.provide(routes, Auth.layer),
					onSome: auth => Layer.provide(routes, auth)
				}),
				Layer.provideMerge(AiGateway.layer),
				Layer.provide(Layer.unwrap(Effect.map(dataDirectory, layerDataStore)))
			),
			{disableLogger: true, middleware: serverMiddleware}
		),
		Layer.provide(
			Layer.mergeAll(
				layerServerProtocol,
				Boolean.match(app.telemetry === false, {onFalse: () => layerTelemetry, onTrue: () => Layer.empty})
			)
		),
		Layer.provideMerge(listener),
		Layer.provide(layerPlatform)
	)
}

function output(text: string) {
	return Effect.flatMap(Stdio.Stdio, stdio => Stream.run(Stream.make(text), stdio.stdout()))
}

export function runApp<A, E>(app: App<A, E>) {
	const program = Effect.gen(function* () {
		const metadata = yield* packageMetadata
		const name = yield* appName
		const settings: Record<string, Setting> = {
			...SETTINGS,
			PORT: {description: `Listen port; defaults to ${metadata.config.port}`, flag: 'port', schema: Port},
			...app.settings
		}
		const root = Command.withSharedFlags(
			Command.make(name),
			Record.map(settings, (setting, key) => {
				const env = Boolean.match(key === 'DOMAIN', {onFalse: () => key, onTrue: Function.constant('DESLOP_DOMAIN')})
				return pipe(
					Flag.String(setting.flag),
					Flag.withSchema(setting.schema),
					Flag.withFallbackConfig(Config.schema(setting.schema, env)),
					Flag.withDescription(`${setting.description} [${env}]`),
					Flag.optional
				)
			})
		)
		const given = Effect.map(root, input => Record.getSomes(input))
		return yield* pipe(
			root,
			Command.withHandler(input =>
				Effect.provideServiceEffect(
					Layer.launch(server(app)),
					ConfigProvider.ConfigProvider,
					configProvider(Record.getSomes(input), metadata.config.port)
				)
			),
			Command.withSubcommands([
				Command.make('probe', {}, () => probeServer(auth => server({...app, auth}, layerProbeHttpServer))),
				Command.withSubcommands(Command.make('service'), [
					Command.make(
						'install',
						{},
						Effect.fnUntraced(function* () {
							const fs = yield* FileSystem.FileSystem
							const path = yield* Path.Path
							const flags = yield* given
							yield* configProvider(flags, metadata.config.port)
							// The unit runs whatever `current` links to: this package now, the updater's releases later.
							const entry = path.join(
								yield* activateRelease(name, yield* fs.realPath(packageRoot)),
								'dist',
								'server.js'
							)
							const args = Array.flatten(
								Record.collect(flags, (key, value) => [`--${settings[key]?.flag ?? key}`, value])
							)
							yield* output(yield* installService(name, [execPath, ...execArgv, entry, ...args]))
							yield* installUpdateService(name, [execPath, ...execArgv, entry, ...args, 'service', 'update'])
						})
					),
					Command.make('status', {}, () => Effect.flatMap(serviceStatus(name), output)),
					Command.make('uninstall', {}, () => Effect.flatMap(uninstallService(name), output)),
					Command.make(
						'update',
						{},
						Effect.fnUntraced(function* () {
							const flags = yield* given
							return yield* Effect.flatMap(
								updateRelease(name, `http://${flags['HOST'] ?? DEFAULT_HOST}:${flags['PORT'] ?? metadata.config.port}`),
								output
							)
						})
					)
				])
			]),
			Command.run({version: metadata.version})
		)
	})
	NodeRuntime.runMain(
		// oxlint-disable-next-line effecttsgo/strict-effect-provide -- This shared CLI owns the application entry point and platform lifetime.
		pipe(program, Effect.scoped, Effect.provide(layerPlatform), Effect.provideService(Logger.LogToStderr, true))
	)
}
