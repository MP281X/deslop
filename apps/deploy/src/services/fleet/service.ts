import {NodeSocket} from '@effect/platform-node'

import {
	Array,
	Clock,
	Config,
	Context,
	Effect,
	Layer,
	Option,
	Record,
	Redacted,
	Ref,
	Schema,
	String,
	Struct,
	pipe
} from 'effect'

import {Digest} from 'effect/crypto'
import type {Headers} from 'effect/http'
import {RpcClient, RpcSerialization} from 'effect/rpc'

import {Auth} from '@deslop/runtime/server/auth'
import type {User} from '@deslop/runtime/shared/auth'
import {RpcStream, layerRpcStreamClient} from '@deslop/runtime/shared/rpc'
import {RPC_PATH} from '@deslop/runtime/shared/schema'

import {RpcContracts} from '#rpcs/contracts.ts'
import type {ExposeRequest, HideRequest} from '#services/exposures/schema.ts'
import {Exposures} from '#services/exposures/service.ts'
import {DeployError, Snapshot, Worker} from '#services/inventory/schema.ts'
import type {RunRequest} from '#services/inventory/schema.ts'
import {Inventory} from '#services/inventory/service.ts'
import {history} from '#services/metrics/lib/utils.ts'
import type {HistoryQuery, MachineHistory} from '#services/metrics/schema.ts'
import {Metrics} from '#services/metrics/service.ts'

// Who another worker's Deploy acts as: its bearer is the shared key, never a person's sign-in.
const PEER = {id: 'deploy:peer', name: 'deploy'} satisfies User

const makeRemoteClient = RpcClient.make(RpcContracts.middleware(RpcStream), {flatten: true})

// Workers authorize each other with the DEPLOY_KEY their env files share, compared by digest; people sign in as on every app.
export const layerPeerAuth = Layer.effectContext(
	Effect.gen(function* () {
		const auth = yield* Auth
		const digest = yield* Digest.Digest
		function hash(text: string) {
			return digest.digestHex(Digest.sha256, new TextEncoder().encode(text))
		}
		const expected = yield* Effect.transposeOption(
			Option.map(yield* Config.option(Config.Redacted('DEPLOY_KEY')), key => hash(`Bearer ${Redacted.value(key)}`))
		)
		return Auth.makeContext(
			Auth.of({
				token: auth.token,
				user: Effect.fnUntraced(function* (headers: Headers.Headers) {
					if (Option.contains(expected, yield* hash(headers['authorization'] ?? ''))) return PEER
					return yield* auth.user(headers)
				})
			})
		)
	})
)
type RemoteClient = Effect.Success<typeof makeRemoteClient>

function changeFailed<A, E>(effect: Effect.Effect<A, E>) {
	return Effect.mapError(effect, cause => {
		if (Schema.is(DeployError)(cause)) return cause
		return DeployError.make({cause, message: 'Worker exposure change failed'})
	})
}

// A worker's last saved history, windowed to the range the page asked for.
function cachedHistory(query: HistoryQuery, time: number, saved?: MachineHistory) {
	return {
		...Record.getSomes({cpuModel: Option.fromUndefinedOr(saved?.cpuModel)}),
		disks: saved?.disks ?? [],
		load: saved?.load ?? [],
		samples: history(saved?.samples ?? [], query.minutes, time),
		time
	}
}

export class Fleet extends Context.Service<
	Fleet,
	{
		readonly expose: (input: ExposeRequest) => Effect.Effect<string, DeployError>
		readonly hide: (input: HideRequest) => Effect.Effect<void, DeployError>
		readonly run: (input: RunRequest) => Effect.Effect<void, DeployError>
		readonly local: Effect.Effect<Snapshot>
		readonly history: (query: HistoryQuery) => Effect.Effect<MachineHistory, DeployError>
		readonly current: (query: HistoryQuery) => Effect.Effect<MachineHistory[], DeployError>
		readonly metrics: (query: HistoryQuery) => Effect.Effect<MachineHistory[], DeployError>
		readonly snapshot: Effect.Effect<Snapshot>
	}
>('@deslop/deploy/services/fleet/service/Fleet') {
	static readonly layer = Layer.effect(
		this,
		Effect.gen(function* () {
			const inventory = yield* Inventory
			const metrics = yield* Metrics
			const lastMetrics = yield* Ref.make<Record<string, MachineHistory>>({})
			const exposures = yield* Exposures
			const workers = yield* Effect.forEach(
				yield* Config.withDefault(Config.Array(Schema.String, 'DEPLOY_WORKERS'), []),
				entry => {
					const [name, url] = String.split(entry, '=')
					return Schema.decodeUnknownEffect(Worker)({name, url})
				},
				{concurrency: 1}
			)
			// Each worker's Deploy accepts the others by the key all their env files hold, on any network.
			const peerHeaders = Option.match(yield* Config.option(Config.Redacted('DEPLOY_KEY')), {
				onNone: () => ({}),
				onSome: key => ({authorization: `Bearer ${Redacted.value(key)}`})
			})
			const previous = yield* Ref.make<Record<string, Snapshot>>({})
			const local = Effect.gen(function* () {
				const snapshot = yield* inventory.snapshot
				// Owned exposures are one more source: a failed read shows as its error, as an inventory source's does.
				const owned = yield* Effect.match(exposures.items, {
					onFailure: cause => ({items: [], sources: [{error: cause.message, name: 'Exposures'}]}),
					onSuccess: items => ({items, sources: []})
				})
				return Snapshot.make({
					...snapshot,
					items: [...snapshot.items, ...owned.items],
					sources: [...snapshot.sources, ...owned.sources],
					workers: Array.dedupe([
						...(snapshot.workers ?? Array.map(snapshot.items, item => item.worker)),
						...Array.map(workers, worker => worker.name)
					])
				})
			})
			const remote = Effect.fnUntraced(
				function* <A, E>(worker: Worker, use: (client: RemoteClient, headers: Headers.Input) => Effect.Effect<A, E>) {
					const url = new URL(RPC_PATH, worker.url)
					url.protocol = 'wss:'
					if (new URL(worker.url).protocol === 'http:') url.protocol = 'ws:'
					return yield* pipe(makeRemoteClient, Effect.flatMap(client => use(client, peerHeaders)), pipelineSubject5527 => Effect.provide(pipelineSubject5527, pipe(
								RpcClient.layerProtocolSocket({pingTimeout: '15 seconds'}),
								Layer.provide(NodeSocket.layerWebSocket(url.href)),
								Layer.provide(RpcSerialization.layerSchemaBinary()),
								Layer.provideMerge(layerRpcStreamClient)
							)))
				},
				Effect.scoped,
				Effect.timeout('15 seconds')
			)
			function selectedWorker(target: string) {
				return Effect.mapError(Effect.fromOption(Array.findFirst(workers, worker => worker.name === target)), cause =>
						DeployError.make({cause, message: 'This worker is not configured on the control plane'}))
			}
			return Fleet.of({
				current: Effect.fnUntraced(function* (query) {
					const own = yield* metrics.read(query)
					const time = yield* Clock.currentTimeMillis
					const cached = yield* Ref.get(lastMetrics)
					return [
						own,
						...Array.map(workers, worker => {
							const saved = cached[`${worker.name}:${query.minutes}`]
							return {
								...cachedHistory(query, time, saved),
								error: saved?.error ?? 'Waiting for worker',
								stale: saved === undefined || saved.stale || time - saved.time > 90_000,
								worker: worker.name
							}
						})
					]
				}),
				expose: Effect.fnUntraced(function* (input) {
					if (input.target === undefined || input.target === '') {
						return yield* exposures.expose(Struct.omit(input, ['target']))
					}
					return yield* remote(yield* selectedWorker(input.target), (client, headers) =>
						client('exposures.expose', Struct.omit(input, ['target']), {headers})
					)
				}, changeFailed),
				hide: Effect.fnUntraced(function* (input) {
					if (input.target === undefined || input.target === '') return yield* exposures.hide(input.name)
					return yield* remote(yield* selectedWorker(input.target), (client, headers) =>
						client('exposures.hide', {name: input.name}, {headers})
					)
				}, changeFailed),
				history: metrics.read,
				local,
				metrics: Effect.fnUntraced(function* (query) {
					const own = yield* metrics.read(query)
					const others = yield* Effect.forEach(
						workers,
						worker =>
							pipe(
								remote(worker, (client, headers) => client('metrics.history', query, {headers})),
								Effect.timeout('2 seconds'),
								Effect.map(value => ({...value, worker: worker.name})),
								Effect.catch(
									Effect.fnUntraced(function* (cause) {
										return {
											...cachedHistory(
												query,
												yield* Clock.currentTimeMillis,
												(yield* Ref.get(lastMetrics))[`${worker.name}:${query.minutes}`]
											),
											error: cause.message,
											stale: true,
											worker: worker.name
										}
									})
								),
								Effect.tap(value =>
									Ref.update(lastMetrics, all => Record.set(all, `${worker.name}:${query.minutes}`, value))
								)
							),
						{concurrency: 'unbounded'}
					)
					return [own, ...others]
				}),
				run: Effect.fnUntraced(
					function* (input) {
						if (input.target === undefined || input.target === '') {
							return yield* inventory.run(Struct.omit(input, ['target']))
						}
						return yield* remote(yield* selectedWorker(input.target), (client, headers) =>
							client('inventory.run', Struct.omit(input, ['target']), {headers})
						)
					},
					Effect.mapError(cause => {
						if (Schema.is(DeployError)(cause)) return cause
						return DeployError.make({cause, message: 'Worker could not start the job'})
					})
				),
				snapshot: Effect.gen(function* () {
					const own = yield* local
					const others = yield* Effect.forEach(
						workers,
						worker =>
							pipe(
								remote(worker, (client, headers) => client('inventory.snapshot', undefined, {headers})),
								Effect.timeout('2 seconds'),
								Effect.map(snapshot =>
									Snapshot.make({
										...snapshot,
										items: Array.map(snapshot.items, item => ({
											...item,
											id: `remote:${worker.name}:${item.id}`,
											worker: worker.name
										})),
										sources: Array.map(snapshot.sources, source => ({
											...source,
											name: `${worker.name} · ${source.name}`
										}))
									})
								),
								Effect.tap(snapshot => Ref.update(previous, rows => Record.set(rows, worker.name, snapshot))),
								Effect.matchEffect({
									onFailure: cause =>
										Effect.map(Ref.get(previous), rows =>
											Snapshot.make({
												items: Array.map(rows[worker.name]?.items ?? [], item => ({
													...item,
													detail: `${item.detail}\nLast successful sample: ${rows[worker.name]?.time}`,
													state: `stale · ${item.state}`
												})),
												sources: [{error: cause.message, name: `${worker.name} · Snapshot`}],
												time: 0
											})
										),
									onSuccess: Effect.succeed
								})
							),
						{concurrency: 'unbounded'}
					)
					return Snapshot.make({
						items: [...own.items, ...Array.flatMap(others, value => value.items)],
						sources: [...own.sources, ...Array.flatMap(others, value => value.sources)],
						time: yield* Clock.currentTimeMillis,
						workers: Array.dedupe([...(own.workers ?? []), ...Array.map(workers, worker => worker.name)])
					})
				})
			})
		})
	)
}
