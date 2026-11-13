import {hostname} from 'node:os'
import {platform} from 'node:process'

import {
	Array,
	Context,
	Duration,
	Effect,
	FileSystem,
	Layer,
	Option,
	Path,
	Record,
	Schedule,
	Schema,
	Semaphore,
	String,
	Struct,
	pipe
} from 'effect'

import {ChildProcessSpawner} from 'effect/process'
import {Migrator, SqlClient, SqlSchema} from 'effect/sql'

import {ToolPath, executeProcess} from '@deslop/runtime/server/process'
import {installService} from '@deslop/runtime/server/services'

import {Exposure} from '#services/exposures/schema.ts'
import type {ExposeInput} from '#services/exposures/schema.ts'
import type {ExposureName} from '#services/inventory/schema.ts'
import {DeployError, InventoryItem, ItemId, Serve, Tailnet, WorkerId} from '#services/inventory/schema.ts'

// A stop waits at most ten seconds for open connections such as WebSockets, never forever.
function caddyConfig(rows: readonly Exposure[], storage: string) {
	return `{\n\tadmin 127.0.0.1:20219\n\tgrace_period 10s\n\tpersist_config off\n\tstorage file_system {\n\t\troot ${Schema.encodeSync(Schema.fromJsonString(Schema.String))(storage)}\n\t}\n}\n\n${pipe(
		rows,
		Array.filter(row => row.kind === 'public'),
		Array.map(row => `${row.hostname} {\n\tencode\n\treverse_proxy 127.0.0.1:${row.port}\n}\n`),
		Array.join('\n')
	)}`
}

function ownsMapping(status: Serve, row: Exposure) {
	return (
		!Option.exists(status.AllowFunnel, permissions => permissions[`${row.hostname}:${row.port}`] === true) &&
		pipe(
			status.Web,
			Option.flatMap(Record.get(`${row.hostname}:${row.port}`)),
			Option.exists(
				value =>
					Record.size(value.Handlers) === 1 &&
					pipe(
						value.Handlers,
						Record.get('/'),
						Option.flatMap(handler => handler.Proxy),
						Option.exists(proxy => proxy === `http://127.0.0.1:${row.port}`)
					)
			)
		)
	)
}

function exposureUrl(row: Exposure) {
	if (row.kind === 'tailnet') return `https://${row.hostname}:${row.port}`
	return `https://${row.hostname}`
}

const asStorageDeployError = Effect.mapError((cause: unknown) =>
	DeployError.make({cause, message: 'The owned exposures could not be read or written.'})
)

function asDeployError<A, E, R>(effect: Effect.Effect<A, E, R>) {
	return Effect.mapError(effect, cause => {
		if (Schema.is(DeployError)(cause)) return cause
		return DeployError.make({cause, message: 'Exposure change failed; check permissions, target port and ownership'})
	})
}

export class Exposures extends Context.Service<Exposures>()('@deslop/deploy/services/exposures/service/Exposures', {
	// The Caddyfile and Caddy's certificates live in `directory`.
	make: Effect.fnUntraced(function* (directory: string) {
		const fs = yield* FileSystem.FileSystem
		const sql = yield* SqlClient.SqlClient
		const spawner = yield* ChildProcessSpawner.ChildProcessSpawner
		const path = yield* Path.Path
		const worker = yield* Schema.decodeEffect(WorkerId)(hostname())
		yield* fs.makeDirectory(directory, {mode: 0o700, recursive: true})

		const listExposures = SqlSchema.findAll({
			Request: Schema.Void,
			Result: Exposure,
			execute: () => sql`SELECT * FROM ${sql(Exposure.table)} ORDER BY name`
		})
		const insertExposure = SqlSchema.void({
			Request: Exposure.insert,
			execute: row => sql`INSERT INTO ${sql(Exposure.table)} ${sql.insert(row)}`
		})
		const deleteExposure = SqlSchema.void({
			Request: Exposure.fields.name,
			execute: name => sql`DELETE FROM ${sql(Exposure.table)} WHERE name = ${name}`
		})
		const owned = asStorageDeployError(listExposures())
		const lock = yield* Semaphore.make(1)
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
		const status = Effect.flatMap(
			run('tailscale', ['serve', 'status', '--json']),
			Schema.decodeUnknownEffect(Schema.fromJsonString(Serve))
		)
		const checkTailnet = Effect.fnUntraced(function* (input: Exposure) {
			const current = yield* status
			if (
				Option.exists(current.TCP, ports => Record.has(ports, `${input.port}`)) ||
				Option.exists(current.AllowFunnel, permissions => permissions[`${input.hostname}:${input.port}`] === true)
			) {
				return yield* DeployError.make({
					message: 'This Tailscale port or Funnel permission already exists and is not owned by Deploy'
				})
			}
			const tailnet = yield* Effect.flatMap(
				run('tailscale', ['status', '--json']),
				Schema.decodeEffect(Schema.fromJsonString(Tailnet))
			)
			if (!Option.exists(tailnet.Self, self => String.replace(/\.$/u, '')(self.DNSName) === input.hostname)) {
				return yield* DeployError.make({
					message: 'Use this worker’s Tailscale DNS name; Deploy never publishes another worker’s hostname'
				})
			}
		})
		const caddyApply = Effect.fnUntraced(function* (rows: readonly Exposure[]) {
			const binary = yield* caddy
			yield* fs.makeDirectory(path.join(directory, 'caddy'), {mode: 0o700, recursive: true})
			yield* fs.writeFileString(`${configFile}.next`, caddyConfig(rows, path.join(directory, 'caddy')), {mode: 0o600})
			yield* run(binary, ['validate', '--config', `${configFile}.next`, '--adapter', 'caddyfile'])
			yield* fs.rename(`${configFile}.next`, configFile)
			yield* pipe(
				installService('deploy-caddy', [binary, 'run', '--config', configFile, '--adapter', 'caddyfile'], {
					restart: false
				}),
				Effect.provideService(ChildProcessSpawner.ChildProcessSpawner, spawner),
				Effect.provideService(FileSystem.FileSystem, fs),
				Effect.provideService(Path.Path, path)
			)
			yield* Effect.retry(
				run(binary, ['reload', '--address', '127.0.0.1:20219', '--config', configFile, '--adapter', 'caddyfile']),
				{schedule: Schedule.spaced(Duration.millis(200)), times: 10}
			)
		})

		const rows = yield* owned
		if (Array.some(rows, row => row.kind === 'public')) {
			yield* pipe(
				caddyApply(rows),
				Effect.scoped,
				Effect.ignore({
					log: 'Warn',
					message: 'Could not reconcile owned Caddy configuration; inspect its service and owned exposure records'
				})
			)
		}

		return {
			expose: Effect.fn('Exposures.expose')(
				function* (input: ExposeInput) {
					yield* Effect.annotateCurrentSpan({exposure: input.name, kind: input.kind, port: input.port, worker})
					const current = yield* owned
					if (Array.some(current, row => row.name === input.name)) {
						return yield* DeployError.make({message: 'Remove the existing owned exposure before changing it'})
					}
					if (
						Array.some(
							current,
							row => row.hostname === input.hostname && (row.kind === 'public' || row.port === input.port)
						)
					) {
						return yield* DeployError.make({message: 'This hostname or port already has an owned exposure'})
					}
					if (input.kind === 'public' && !input.publicAccess) {
						return yield* DeployError.make({message: 'Explicitly confirm public access before publishing a port'})
					}
					// Public exposure runs the bundled Caddy, a Linux x64 build.
					if (input.kind === 'public' && platform !== 'linux') {
						return yield* DeployError.make({
							message: 'Public exposure needs a Linux worker; expose this port to the tailnet'
						})
					}
					const exposure = Exposure.make(Struct.omit(input, ['publicAccess']))
					if (exposure.kind === 'tailnet') {
						yield* checkTailnet(exposure)
					}
					// Ownership is kept before an external process changes, so an interrupted apply stays inspectable and removable.
					yield* asStorageDeployError(insertExposure(exposure))
					if (exposure.kind === 'public') {
						yield* caddyApply([...current, exposure])
					} else {
						yield* run('tailscale', ['serve', '--bg', `--https=${exposure.port}`, `http://127.0.0.1:${exposure.port}`])
						if (!ownsMapping(yield* status, exposure)) {
							return yield* DeployError.make({
								message: 'Tailscale configured a different hostname or target; inspect before retrying'
							})
						}
					}
					return exposureUrl(exposure)
				},
				Effect.scoped,
				Semaphore.withPermit(lock),
				asDeployError
			),
			hide: Effect.fn('Exposures.hide')(
				function* (name: ExposureName) {
					yield* Effect.annotateCurrentSpan({exposure: name, worker})
					const current = yield* owned
					const exposure = yield* pipe(
						current,
						Array.findFirst(row => row.name === name),
						Effect.fromOption,
						Effect.mapError(cause => DeployError.make({cause, message: 'Deploy does not own this exposure'}))
					)
					if (exposure.kind === 'tailnet') {
						const mappings = yield* status
						if (Option.exists(mappings.TCP, ports => Record.has(ports, `${exposure.port}`))) {
							if (!ownsMapping(mappings, exposure)) {
								return yield* DeployError.make({
									message: 'This mapping was changed outside Deploy; refusing to remove it'
								})
							}
							yield* run('tailscale', ['serve', `--https=${exposure.port}`, 'off'])
						}
					} else {
						yield* caddyApply(Array.filter(current, row => row.name !== name))
					}
					yield* asStorageDeployError(deleteExposure(name))
				},
				Effect.scoped,
				Semaphore.withPermit(lock),
				asDeployError
			),
			items: pipe(
				owned,
				Effect.map(current =>
					Array.map(current, row =>
						InventoryItem.make({
							detail: `${row.kind} → 127.0.0.1:${row.port}`,
							id: ItemId.make(`${worker}:exposure:${row.name}`),
							kind: 'exposure',
							name: row.name,
							owned: Option.some(true),
							port: Option.some(row.port),
							publicAccess: Option.some(row.kind === 'public'),
							state: 'configured; check backend',
							url: Option.some(exposureUrl(row)),
							worker
						})
					)
				),
				Effect.withSpan('Exposures.items', {attributes: {worker}})
			)
		}
	})
}) {
	// The table this service owns, made and changed at start in one transaction; one statement per `sql` call, since SQLite runs only the first statement of a string.
	static readonly migrations = Layer.effectDiscard(
		Migrator.make({})({
			loader: Migrator.fromRecord({
				'0001_exposures': Effect.flatMap(
					SqlClient.SqlClient,
					sql => sql`
						CREATE TABLE exposures (
							name TEXT PRIMARY KEY,
							kind TEXT NOT NULL,
							hostname TEXT NOT NULL,
							port INTEGER NOT NULL
						) STRICT
					`
				)
			}),
			table: 'exposures_migrations'
		})
	)

	static readonly layer = (directory: string) =>
		Layer.provide(Layer.effect(this, this.make(directory)), this.migrations)
}
