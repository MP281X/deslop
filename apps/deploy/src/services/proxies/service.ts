import {
	Array,
	Boolean,
	Context,
	Duration,
	Effect,
	FileSystem,
	Function,
	Layer,
	Option,
	Path,
	Schedule,
	Schema,
	String,
	pipe
} from 'effect'

import {HttpClient, HttpClientResponse} from 'effect/http'
import {ChildProcessSpawner} from 'effect/process'

import {AppError, ToolPath, executeProcess} from '@deslop/runtime/server/process'
import {installService} from '@deslop/runtime/server/services'
import {RUNTIME_PATH, RuntimeConfig} from '@deslop/runtime/shared/schema'

import type {Exposure} from '#services/exposures/schema.ts'
import {DeployError, Serve, TailnetStatus} from '#services/inventory/schema.ts'

// The Caddyfile binds Caddy's management listener here, on loopback.
export const CADDY_ADMIN_PORT = 20_219

// A stop waits at most ten seconds for open connections such as WebSockets, never forever.
function caddyConfig(rows: readonly Exposure[], storage: string) {
	return `{\n\tadmin 127.0.0.1:${CADDY_ADMIN_PORT}\n\tgrace_period 10s\n\tpersist_config off\n\tstorage file_system {\n\t\troot ${Schema.encodeSync(Schema.fromJsonString(Schema.String))(storage)}\n\t}\n}\n\n${pipe(
		rows,
		Array.filter(row => row.kind === 'public'),
		Array.map(row => `${row.hostname} {\n\tencode\n\treverse_proxy 127.0.0.1:${row.port}\n}\n`),
		Array.join('\n')
	)}`
}

function asDeployError<A, E, R>(effect: Effect.Effect<A, E, R>) {
	return Effect.mapError(effect, cause =>
		DeployError.make({cause, message: 'Tailscale Serve could not be read or changed; check permissions and its status'})
	)
}

// This worker's HTTPS front: Caddy for public hostnames, Tailscale Serve for tailnet ports, and what a port's server says it is.
export class Proxies extends Context.Service<
	Proxies,
	{
		// Caddy accepts these public rows; nothing changes.
		readonly validate: (rows: readonly Exposure[]) => Effect.Effect<void, DeployError>
		// Caddy serves exactly these public rows.
		readonly apply: (rows: readonly Exposure[]) => Effect.Effect<void, DeployError>
		readonly serveStatus: Effect.Effect<Serve, DeployError>
		// This worker's Tailscale DNS name, without its trailing dot.
		readonly tailnetName: Effect.Effect<Option.Option<string>, DeployError>
		readonly serve: (port: number) => Effect.Effect<void, DeployError>
		readonly unserve: (port: number) => Effect.Effect<void, DeployError>
		// The Deslop runtime a port's server reports, if it answers as one.
		readonly runtime: (port: number) => Effect.Effect<Option.Option<RuntimeConfig>>
	}
>()('@deslop/deploy/services/proxies/service/Proxies') {
	// The Caddyfile and Caddy's certificates live in `directory`.
	static readonly layer = (directory: string) =>
		Layer.effect(
			this,
			Effect.gen(function* () {
				const fs = yield* FileSystem.FileSystem
				const spawner = yield* ChildProcessSpawner.ChildProcessSpawner
				const path = yield* Path.Path
				const http = yield* HttpClient.HttpClient
				yield* fs.makeDirectory(directory, {mode: 0o700, recursive: true})
				// Unpacked on the first public exposure, not on every start.
				const caddy = pipe(
					(yield* ToolPath)('caddy'),
					Effect.provideService(FileSystem.FileSystem, fs),
					Effect.provideService(Path.Path, path)
				)
				const configFile = path.join(directory, 'Caddyfile')
				function run(program: string, args: string[]) {
					return pipe(
						executeProcess(program, args),
						Effect.provideService(ChildProcessSpawner.ChildProcessSpawner, spawner),
						Effect.timeout(Duration.seconds(30))
					)
				}
				const written = Effect.fnUntraced(function* (rows: readonly Exposure[]) {
					const binary = yield* caddy
					yield* fs.makeDirectory(path.join(directory, 'caddy'), {mode: 0o700, recursive: true})
					yield* fs.writeFileString(`${configFile}.next`, caddyConfig(rows, path.join(directory, 'caddy')), {
						mode: 0o600
					})
					yield* run(binary, ['validate', '--config', `${configFile}.next`, '--adapter', 'caddyfile'])
					return binary
				})
				return Proxies.of({
					apply: Effect.fn('Proxies.apply')(
						function* (rows) {
							const binary = yield* written(rows)
							yield* fs.rename(`${configFile}.next`, configFile)
							// A reload keeps Caddy's process, so one still running an earlier release's binary restarts onto this one.
							const running = yield* pipe(
								run('systemctl', ['--user', 'show', '--property=MainPID', '--value', 'deslop-deploy-caddy.service']),
								Effect.map(String.trim),
								Effect.flatMap(pid =>
									Boolean.match(pid === '0', {
										onFalse: () => fs.readLink(`/proc/${pid}/exe`),
										onTrue: () => Effect.succeed('')
									})
								),
								Effect.option
							)
							yield* pipe(
								installService(
									'deploy-caddy',
									[binary, 'run', '--config', configFile, '--adapter', 'caddyfile'],
									pipe(
										running,
										Option.filter(current => current === binary),
										Option.match({onNone: Function.constUndefined, onSome: () => ({restart: false as const})})
									)
								),
								Effect.provideService(ChildProcessSpawner.ChildProcessSpawner, spawner),
								Effect.provideService(FileSystem.FileSystem, fs),
								Effect.provideService(Path.Path, path)
							)
							yield* Effect.retry(
								run(binary, [
									'reload',
									'--address',
									`127.0.0.1:${CADDY_ADMIN_PORT}`,
									'--config',
									configFile,
									'--adapter',
									'caddyfile'
								]),
								{schedule: Schedule.spaced(Duration.millis(200)), times: 10, while: Schema.is(AppError)}
							)
						},
						Effect.scoped,
						Effect.mapError(cause =>
							DeployError.make({cause, message: 'Caddy did not load the owned public exposures'})
						)
					),
					runtime: Effect.fn('Proxies.runtime')(function* (port) {
						return yield* pipe(
							http.get(`http://127.0.0.1:${port}${RUNTIME_PATH}`),
							Effect.flatMap(HttpClientResponse.schemaBodyJson(RuntimeConfig)),
							Effect.timeout(Duration.seconds(2)),
							Effect.option
						)
					}),
					serve: Effect.fn('Proxies.serve')(function* (port) {
						yield* asDeployError(run('tailscale', ['serve', '--bg', `--https=${port}`, `http://127.0.0.1:${port}`]))
					}),
					serveStatus: pipe(
						run('tailscale', ['serve', 'status', '--json']),
						Effect.flatMap(Schema.decodeUnknownEffect(Schema.fromJsonString(Serve))),
						asDeployError
					),
					tailnetName: pipe(
						run('tailscale', ['status', '--json']),
						Effect.flatMap(Schema.decodeEffect(Schema.fromJsonString(TailnetStatus))),
						Effect.map(status => Option.map(status.Self, self => String.replace(/\.$/u, '')(self.DNSName))),
						asDeployError
					),
					unserve: Effect.fn('Proxies.unserve')(function* (port) {
						yield* asDeployError(run('tailscale', ['serve', `--https=${port}`, 'off']))
					}),
					validate: Effect.fn('Proxies.validate')(
						function* (rows) {
							yield* written(rows)
						},
						Effect.scoped,
						Effect.mapError(cause => DeployError.make({cause, message: 'Caddy refused this public exposure'}))
					)
				})
			})
		)
}
