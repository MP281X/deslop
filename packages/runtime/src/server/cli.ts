import {execPath} from 'node:process'

import {NodeCrypto, NodeHttpClient, NodeRuntime, NodeServices} from '@effect/platform-node'

import {
	Array,
	Boolean,
	Config,
	ConfigProvider,
	Effect,
	FileSystem,
	Layer,
	Logger,
	Option,
	Path,
	Record,
	Schema,
	Stdio,
	Stream,
	pipe
} from 'effect'

import {Command, Flag} from 'effect/cli'
import type {HttpServerResponse} from 'effect/http'
import {HttpRouter} from 'effect/http'

import {AiGateway} from '#server/ai.ts'
import {Auth} from '#server/auth.ts'
import {
	crossSiteGuard,
	layerIcon,
	layerNodeHttpServer,
	layerServerProtocol,
	layerRoutes,
	layerTelemetry,
	layerWeb
} from '#server/http.ts'
import {appName, packageMetadata, packageRoot} from '#server/package.ts'
import {AppError} from '#server/process.ts'
import {installService, installUpdateService, serviceStatus, uninstallService} from '#server/services.ts'
import {Sessions} from '#server/sessions.ts'
import {layerSessionRoutes} from '#server/sign-in.ts'
import {dataDirectory, layerDataStore} from '#server/store.ts'
import {activateRelease, updateRelease} from '#server/update.ts'
import type {RpcAuth} from '#shared/auth.ts'
import {Origin, Port, SecureOrigin} from '#shared/schema.ts'

const DEFAULT_HOST = '127.0.0.1'

export type Setting = {
	readonly description: string
	readonly flag: string
	readonly schema: Schema.Codec<string, string>
}

const SETTINGS = {
	APP_URL: {description: 'Canonical origin, such as the HTTPS name a proxy serves', flag: 'url', schema: Origin},
	AUTH_URL: {
		description: 'Deslop Auth origin; without it there is no sign-in and every request is the developer',
		flag: 'auth',
		schema: SecureOrigin
	},
	GATEWAY_URL: {description: 'Deslop Gateway origin for AI calls', flag: 'gateway', schema: Origin},
	HOST: {description: `Listen address; defaults to ${DEFAULT_HOST}`, flag: 'host', schema: Schema.NonEmptyString},
	OTEL_URL: {description: 'Scope origin to export traces and logs to', flag: 'traces', schema: Origin}
} satisfies Record<string, Setting>

export const ADMINS = {
	description: 'GitHub user ids, comma-separated, who admit people and manage shared settings',
	flag: 'admins',
	schema: Schema.String.check(Schema.isPattern(/^\d+(?:,\d+)*$/u))
} satisfies Setting

const configProvider = Effect.fnUntraced(function* (given: Record<string, string>, defaultPort: number) {
	const port = given['PORT'] ?? `${defaultPort}`
	const url = given['APP_URL'] ?? `http://localhost:${port}`
	if (given['AUTH_URL'] !== undefined && new URL(url).protocol !== 'https:') {
		return yield* AppError.make({message: "With --auth, set --url to the app's HTTPS origin"})
	}
	return ConfigProvider.orElse(
		ConfigProvider.fromUnknown({HOST: DEFAULT_HOST, ...given, APP_URL: url, PORT: port}),
		ConfigProvider.fromEnv()
	)
})

const layerPlatform = Layer.mergeAll(NodeServices.layer, NodeHttpClient.layerFetch, NodeCrypto.layer)

export type Provided =
	| Layer.Success<typeof layerPlatform>
	| HttpRouter.HttpRouter
	| Auth
	| AiGateway
	| RpcAuth
	| Layer.Success<ReturnType<typeof layerDataStore>>
	| Layer.Success<typeof layerServerProtocol>

export type Routes<A, E> = Layer.Layer<
	A,
	E,
	| Provided
	| HttpRouter.Request<'Error' | 'GlobalError', unknown>
	| HttpRouter.Request<'Requires' | 'GlobalRequires', Provided | HttpRouter.GlobalProvided>
>

export type App<A, E> = {
	readonly auth?: Layer.Layer<
		Auth | RpcAuth,
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

function server<A, E>(app: App<A, E>) {
	const routes = Layer.provide(
		Layer.mergeAll(app.routes, layerRoutes, layerIcon(app.icon), layerWeb),
		Option.match(Option.fromUndefinedOr(app.middleware), {
			onNone: () => Layer.empty,
			onSome: middleware => HttpRouter.middleware()(middleware).layer
		})
	)
	return pipe(
		HttpRouter.serve(
			pipe(
				Option.match(Option.fromUndefinedOr(app.auth), {
					onNone: () => pipe(routes, Layer.merge(layerSessionRoutes), Layer.provide(Auth.layer)),
					onSome: auth => Layer.provide(routes, auth)
				}),
				Layer.provideMerge(AiGateway.layer),
				Layer.provide(Sessions.layer),
				Layer.provide(Layer.unwrap(Effect.map(dataDirectory, layerDataStore)))
			),
			{disableLogger: true, middleware: crossSiteGuard}
		),
		Layer.provide(
			Layer.mergeAll(
				layerServerProtocol,
				Boolean.match(app.telemetry === false, {onFalse: () => layerTelemetry, onTrue: () => Layer.empty})
			)
		),
		Layer.provide(layerNodeHttpServer),
		Layer.provide(layerPlatform),
		Layer.launch
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
			Record.map(settings, (setting, key) =>
				pipe(
					Flag.String(setting.flag),
					Flag.withSchema(setting.schema),
					Flag.withFallbackConfig(Config.schema(setting.schema, key)),
					Flag.withDescription(`${setting.description} [${key}]`),
					Flag.optional
				)
			)
		)
		const given = Effect.map(root, input => Record.getSomes(input))
		return yield* pipe(
			root,
			Command.withHandler(input =>
				Effect.flatMap(configProvider(Record.getSomes(input), metadata.config.port), values =>
					Effect.provideService(server(app), ConfigProvider.ConfigProvider, values)
				)
			),
			Command.withSubcommands([
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
							yield* output(yield* installService(name, [execPath, entry, ...args]))
							yield* installUpdateService(name, [execPath, entry, 'service', 'update'])
						})
					),
					Command.make('status', {}, () => Effect.flatMap(serviceStatus(name), output)),
					Command.make('uninstall', {}, () => Effect.flatMap(uninstallService(name), output)),
					Command.make('update', {}, () => Effect.flatMap(updateRelease(name), output))
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
