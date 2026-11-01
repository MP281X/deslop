import {
	Array,
	Config,
	Context,
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
	SubscriptionRef,
	pipe
} from 'effect'

import {KeyValueStore} from 'effect/persistence'
import {ChildProcessSpawner} from 'effect/process'

import {nativeTool} from '@deslop/runtime/native'
import {layerKeyValueStore} from '@deslop/runtime/server'
import {execute, service} from '@deslop/runtime/service'

import {DeployError, Exposure, InventoryItem, Serve, Tailnet} from '#services/inventory/schema.ts'

function caddyConfig(rows: Exposure[], storage: string) {
	return `{\n\tadmin 127.0.0.1:20219\n\tpersist_config off\n\tstorage file_system {\n\t\troot ${Schema.encodeSync(Schema.fromJsonString(Schema.String))(storage)}\n\t}\n}\n\n${Array.join(
		Array.map(
			Array.filter(rows, row => row.kind === 'public'),
			row => `${row.hostname} {\n\treverse_proxy 127.0.0.1:${row.port}\n}\n`
		),
		'\n'
	)}`
}

function ownsMapping(status: Serve, row: Exposure) {
	return (
		status.AllowFunnel?.[`${row.hostname}:${row.port}`] !== true &&
		Option.exists(
			Record.get(status.Web ?? {}, `${row.hostname}:${row.port}`),
			value => Record.size(value.Handlers) === 1 && value.Handlers['/']?.Proxy === `http://127.0.0.1:${row.port}`
		)
	)
}

function exposureUrl(row: Exposure) {
	if (row.kind === 'tailnet') return `https://${row.hostname}:${row.port}`
	return `https://${row.hostname}`
}

function failed<A, E, R>(effect: Effect.Effect<A, E, R>) {
	return Effect.mapError(effect, cause => {
		if (Schema.is(DeployError)(cause)) return cause
		return DeployError.make({cause, message: 'Exposure change failed; check permissions, target port and ownership'})
	})
}

export class Exposures extends Context.Service<
	Exposures,
	{
		readonly expose: (input: Exposure) => Effect.Effect<string, DeployError>
		readonly hide: (name: string) => Effect.Effect<void, DeployError>
		readonly items: Effect.Effect<InventoryItem[]>
	}
>()('@deslop/deploy/services/exposures/service/Exposures') {
	static readonly layer = Layer.unwrap(
		Effect.gen(function* () {
			const path = yield* Path.Path
			const directory = yield* pipe(
				Config.String('DEPLOY_DATA'),
				Config.withDefault(path.join(yield* Config.String('HOME'), '.deslop', 'deploy'))
			)
			return pipe(
				Layer.effect(
					Exposures,
					Effect.gen(function* () {
						const fs = yield* FileSystem.FileSystem
						yield* fs.makeDirectory(directory, {mode: 0o700, recursive: true})
						const store = KeyValueStore.toSchemaStore(
							yield* KeyValueStore.KeyValueStore,
							Schema.Record(Schema.String, Exposure)
						)
						const state = yield* SubscriptionRef.make(Option.getOrElse(yield* store.get('exposures'), () => ({})))
						const lock = yield* Semaphore.make(1)
						const spawner = yield* ChildProcessSpawner.ChildProcessSpawner
						const worker = String.trim(yield* fs.readFileString('/proc/sys/kernel/hostname'))
						const caddy = yield* pipe(Config.String('CADDY_BINARY'), Config.withDefault(yield* nativeTool('caddy')))
						const configFile = path.join(directory, 'Caddyfile')
						function run(program: string, args: string[]) {
							return pipe(
								execute(program, args),
								Effect.provideService(ChildProcessSpawner.ChildProcessSpawner, spawner),
								Effect.timeout('30 seconds')
							)
						}
						const status = pipe(
							run('tailscale', ['serve', 'status', '--json']),
							Effect.flatMap(Schema.decodeUnknownEffect(Schema.fromJsonString(Serve)))
						)
						const checkTailnet = Effect.fnUntraced(function* (input: Exposure) {
							const current = yield* status
							if (
								Record.has(current.TCP ?? {}, `${input.port}`) ||
								current.AllowFunnel?.[`${input.hostname}:${input.port}`] === true
							) {
								return yield* DeployError.make({
									message: 'This Tailscale port or Funnel permission already exists and is not owned by Deploy'
								})
							}
							const tailnet = yield* pipe(
								run('tailscale', ['status', '--json']),
								Effect.flatMap(Schema.decodeEffect(Schema.fromJsonString(Tailnet)))
							)
							if (String.replace(/\.$/u, '')(tailnet.Self?.DNSName ?? '') !== input.hostname) {
								return yield* DeployError.make({
									message: 'Use this worker’s Tailscale DNS name; Deploy never publishes another worker’s hostname'
								})
							}
						})
						const caddyApply = Effect.fnUntraced(function* (rows: Record<string, Exposure>) {
							yield* fs.makeDirectory(path.join(directory, 'caddy'), {mode: 0o700, recursive: true})
							yield* fs.writeFileString(
								`${configFile}.next`,
								caddyConfig(Record.values(rows), path.join(directory, 'caddy')),
								{mode: 0o600}
							)
							yield* run(caddy, ['validate', '--config', `${configFile}.next`, '--adapter', 'caddyfile'])
							yield* fs.rename(`${configFile}.next`, configFile)
							yield* pipe(
								service('deploy-caddy', 'install', caddy, 'run', ['--config', configFile, '--adapter', 'caddyfile']),
								Effect.provideService(ChildProcessSpawner.ChildProcessSpawner, spawner),
								Effect.provideService(FileSystem.FileSystem, fs),
								Effect.provideService(Path.Path, path)
							)
							yield* pipe(
								run(caddy, [
									'reload',
									'--address',
									'127.0.0.1:20219',
									'--config',
									configFile,
									'--adapter',
									'caddyfile'
								]),
								Effect.retry({schedule: Schedule.spaced('200 millis'), times: 10})
							)
						})
						if (Array.some(Record.values(yield* SubscriptionRef.get(state)), row => row.kind === 'public')) {
							yield* pipe(
								caddyApply(yield* SubscriptionRef.get(state)),
								Effect.scoped,
								Effect.ignore({
									log: 'Warn',
									message:
										'Could not reconcile owned Caddy configuration; inspect its service and owned exposure records'
								})
							)
						}
						function save(rows: Record<string, Exposure>) {
							return pipe(store.set('exposures', rows), Effect.andThen(SubscriptionRef.set(state, rows)))
						}
						return Exposures.of({
							expose: Effect.fnUntraced(
								function* (input: Exposure) {
									const rows = yield* SubscriptionRef.get(state)
									if (Record.has(rows, input.name)) {
										return yield* DeployError.make({message: 'Remove the existing owned exposure before changing it'})
									}
									if (
										Array.some(
											Record.values(rows),
											row => row.hostname === input.hostname && (row.kind === 'public' || row.port === input.port)
										)
									) {
										return yield* DeployError.make({message: 'This hostname or port already has an owned exposure'})
									}
									if (input.kind === 'public' && !input.publicAccess) {
										return yield* DeployError.make({
											message: 'Explicitly confirm public access before publishing a port'
										})
									}
									if (input.kind === 'tailnet') {
										yield* checkTailnet(input)
									}
									const next = Record.set(rows, input.name, input)
									// Persist ownership before changing an external process; an interrupted apply remains inspectable/removable.
									yield* save(next)
									if (input.kind === 'public') {
										yield* caddyApply(next)
									} else {
										yield* run('tailscale', [
											'serve',
											'--bg',
											`--https=${input.port}`,
											`http://127.0.0.1:${input.port}`
										])
										if (!ownsMapping(yield* status, input)) {
											return yield* DeployError.make({
												message: 'Tailscale configured a different hostname or target; inspect before retrying'
											})
										}
									}
									return exposureUrl(input)
								},
								Effect.scoped,
								Semaphore.withPermit(lock),
								failed
							),
							hide: Effect.fnUntraced(
								function* (name: string) {
									const rows = yield* SubscriptionRef.get(state)
									const owned = yield* pipe(
										Effect.fromOption(Record.get(rows, name)),
										Effect.mapError(cause => DeployError.make({cause, message: 'Deploy does not own this exposure'}))
									)
									const next = Record.remove(rows, name)
									if (owned.kind === 'tailnet') {
										const current = yield* status
										if (Record.has(current.TCP ?? {}, `${owned.port}`)) {
											if (!ownsMapping(current, owned)) {
												return yield* DeployError.make({
													message: 'This mapping was changed outside Deploy; refusing to remove it'
												})
											}
											yield* run('tailscale', ['serve', `--https=${owned.port}`, 'off'])
										}
									} else {
										yield* caddyApply(next)
									}
									yield* save(next)
								},
								Effect.scoped,
								Semaphore.withPermit(lock),
								failed
							),
							items: Effect.map(SubscriptionRef.get(state), rows =>
								Array.map(Record.values(rows), row =>
									InventoryItem.make({
										detail: `${row.kind} → 127.0.0.1:${row.port}`,
										id: `${worker}:exposure:${row.name}`,
										kind: 'exposure',
										name: row.name,
										owned: true,
										port: row.port,
										publicAccess: row.kind === 'public',
										state: 'configured; check backend',
										url: exposureUrl(row),
										worker
									})
								)
							)
						})
					})
				),
				Layer.provide(layerKeyValueStore(directory))
			)
		})
	)
}
