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

import {Origin, Port, SecureOrigin} from '#schema.ts'
import {
	appName,
	guard,
	layerAnnounce,
	layerDataStore,
	layerIcon,
	layerNodeHttpServer,
	layerProtocol,
	layerRoutes,
	layerSessionRoutes,
	layerTelemetry,
	layerWeb,
	packageMetadata,
	packageRoot
} from '#server.ts'

import {AiGateway} from '#ai/service.ts'
import type {RpcAuth} from '#auth/lib/utils.ts'
import {Auth} from '#auth/service.ts'
import {Sessions} from '#auth/sessions.ts'
import {AppError} from '#cli/schema.ts'
import {install, installUpdates, status, uninstall} from '#cli/service.ts'
import {activate, update} from '#cli/update.ts'

const DEFAULT_HOST = '127.0.0.1'

// A setting is a flag, or else the environment variable it names; app code reads either through `Config`.
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

function flagsOf(settings: Record<string, Setting>) {
	return Record.map(settings, (setting, key) =>
		pipe(
			Flag.String(setting.flag),
			Flag.withSchema(setting.schema),
			Flag.withFallbackConfig(Config.schema(setting.schema, key)),
			Flag.withDescription(`${setting.description} [${key}]`),
			Flag.optional
		)
	)
}

// The settings given, as the provider app code reads, with the listen address and canonical origin filled in.
const provider = Effect.fnUntraced(function* (given: Record<string, string>, defaultPort: number) {
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

// What every app's routes may use without providing it.
export type Provided =
	| Layer.Success<typeof layerPlatform>
	| HttpRouter.HttpRouter
	| Auth
	| AiGateway
	| RpcAuth
	| Layer.Success<typeof layerProtocol>

// Route handlers may fail with any error, which the server answers, and use the services the runtime provides.
export type Routes<A, E> = Layer.Layer<
	A,
	E,
	| Provided
	| HttpRouter.Request<'Error' | 'GlobalError', unknown>
	| HttpRouter.Request<'Requires' | 'GlobalRequires', Provided | HttpRouter.GlobalProvided>
>

export type App<A, E> = {
	// For the app that issues sign-ins, Auth: who sent each request, in place of the runtime's sessions and their routes.
	readonly auth?: Layer.Layer<Auth | RpcAuth, E, Layer.Success<typeof layerPlatform>>
	readonly icon: string
	// The app's RPC, HTTP routes and `ServerRuntime.layerMcp` tools, with its own services provided.
	readonly routes: Routes<A, E>
	// Runs around matched routes before the response is sent, so headers and bodies can be changed.
	readonly middleware?: <A, R>(
		app: Effect.Effect<HttpServerResponse.HttpServerResponse, A, R>
	) => Effect.Effect<HttpServerResponse.HttpServerResponse, A, R>
	readonly settings?: Record<string, Setting>
	// Scope receives telemetry, so it never exports its own.
	readonly telemetry?: false
}

function server<A, E>(app: App<A, E>) {
	const routes = pipe(
		Layer.mergeAll(app.routes, layerRoutes, layerIcon(app.icon), layerWeb, layerAnnounce),
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
					onNone: () => pipe(Layer.merge(routes, layerSessionRoutes), Layer.provide(Auth.layer)),
					onSome: auth => pipe(routes, Layer.provide(auth))
				}),
				Layer.provideMerge(AiGateway.layer),
				Layer.provide(Sessions.layer),
				Layer.provide(layerDataStore)
			),
			{disableLogger: true, middleware: guard}
		),
		Layer.provide(
			Layer.mergeAll(
				layerProtocol,
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

// The app's executable: the server in the foreground, or `service` to run it under systemd and keep it on npm's latest release.
export function runApp<A, E>(app: App<A, E>) {
	const program = Effect.gen(function* () {
		const metadata = yield* packageMetadata
		const name = yield* appName
		const settings: Record<string, Setting> = {
			...SETTINGS,
			PORT: {description: `Listen port; defaults to ${metadata.config.port}`, flag: 'port', schema: Port},
			...app.settings
		}
		const root = pipe(Command.make(name), Command.withSharedFlags(flagsOf(settings)))
		const given = Effect.map(root, input => Record.getSomes(input))
		return yield* pipe(
			root,
			Command.withHandler(input =>
				Effect.flatMap(provider(Record.getSomes(input), metadata.config.port), values =>
					Effect.provideService(server(app), ConfigProvider.ConfigProvider, values)
				)
			),
			Command.withSubcommands([
				pipe(
					Command.make('service'),
					Command.withSubcommands([
						Command.make(
							'install',
							{},
							Effect.fnUntraced(function* () {
								const fs = yield* FileSystem.FileSystem
								const path = yield* Path.Path
								const flags = yield* given
								yield* provider(flags, metadata.config.port)
								// The unit runs whatever `current` links to: this package now, the updater's releases later.
								const entry = path.join(yield* activate(name, yield* fs.realPath(packageRoot)), 'dist', 'server.js')
								const args = Array.flatten(
									Record.collect(flags, (key, value) => [`--${settings[key]?.flag ?? key}`, value])
								)
								yield* output(yield* install(name, [execPath, entry, ...args]))
								yield* installUpdates(name, [execPath, entry, 'service', 'update'])
							})
						),
						Command.make('status', {}, () => Effect.flatMap(status(name), output)),
						Command.make('uninstall', {}, () => Effect.flatMap(uninstall(name), output)),
						Command.make('update', {}, () => Effect.flatMap(update(name), output))
					])
				)
			]),
			Command.run({version: metadata.version})
		)
	})
	NodeRuntime.runMain(
		pipe(
			program,
			Effect.scoped,
			// oxlint-disable-next-line effecttsgo/strict-effect-provide -- This shared CLI owns the application entry point and platform lifetime.
			Effect.provide(layerPlatform),
			Effect.provideService(Logger.LogToStderr, true)
		)
	)
}
