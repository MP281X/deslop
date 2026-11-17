import {hostname} from 'node:os'

import {NodeSocket} from '@effect/platform-node'

import {
	Array,
	Boolean,
	DateTime,
	Duration,
	Config,
	Context,
	Effect,
	Function,
	HashMap,
	Layer,
	Option,
	Record,
	Ref,
	Schema,
	Struct,
	pipe
} from 'effect'

import {Reactivity} from 'effect/reactivity'
import {RpcClient, RpcSerialization} from 'effect/rpc'

import {Auth, requireAdmin} from '@deslop/runtime/server/auth'
import {packageMetadata} from '@deslop/runtime/server/package'
import {executeProcess} from '@deslop/runtime/server/process'
import {RpcStream, layerRpcStreamClient} from '@deslop/runtime/shared/rpc'
import {RPC_PATH} from '@deslop/runtime/shared/schema'

import {PeerRpcAuth, RpcContracts} from '#rpcs/contracts.ts'
import type {ExposeRequest, HideRequest} from '#services/exposures/schema.ts'
import {Exposures} from '#services/exposures/service.ts'
import {DeployError, ItemId, Worker} from '#services/inventory/schema.ts'
import type {RunRequest, WorkerId, Snapshot} from '#services/inventory/schema.ts'
import {Inventory} from '#services/inventory/service.ts'
import {history} from '#services/metrics/lib/utils.ts'
import type {HistoryQuery, MachineHistory} from '#services/metrics/schema.ts'
import {Metrics} from '#services/metrics/service.ts'

const makeRemoteClient = RpcClient.make(RpcContracts.middleware(RpcStream), {flatten: true})

export const layerPeerAuth = Layer.effect(
	PeerRpcAuth,
	Effect.gen(function* () {
		const auth = yield* Auth
		return PeerRpcAuth.of((effect, request) =>
			Effect.gen(function* () {
				yield* requireAdmin(yield* auth.user(request.headers), 'Only an admin may issue a local command')
				return yield* effect
			})
		)
	})
)
type RemoteClient = Effect.Success<typeof makeRemoteClient>

function asDeployError<A, E>(effect: Effect.Effect<A, E>) {
	return Effect.mapError(effect, cause => {
		if (Schema.is(DeployError)(cause)) return cause
		return DeployError.make({cause, message: 'Worker exposure change failed'})
	})
}

// A worker's last saved history, windowed to the range the page asked for.
function cachedHistory(query: HistoryQuery, time: DateTime.Utc, saved: Option.Option<MachineHistory>) {
	return {
		disks: Option.match(saved, {onNone: () => [], onSome: machine => machine.disks}),
		load: Option.match(saved, {onNone: () => [], onSome: machine => machine.load}),
		platform: Option.flatMap(saved, machine => machine.platform),
		samples: history(Option.match(saved, {onNone: () => [], onSome: machine => machine.samples}), query.minutes, time),
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
		readonly metrics: (query: HistoryQuery) => Effect.Effect<void>
		readonly snapshot: Effect.Effect<Snapshot>
	}
>()('@deslop/deploy/services/fleet/service/Fleet') {
	static readonly layer = Layer.effect(
		this,
		Effect.gen(function* () {
			const inventory = yield* Inventory
			const reactivity = yield* Reactivity.Reactivity
			const localWorker = hostname()
			const metrics = yield* Metrics
			const lastMetrics = yield* Ref.make(HashMap.empty<readonly [WorkerId, Duration.Duration], MachineHistory>())
			const exposures = yield* Exposures
			const names = yield* Config.withDefault(Config.Array(Schema.String, 'DEPLOY_WORKERS'), [])
			const suffix = yield* Boolean.match(Array.isReadonlyArrayEmpty(names), {
				onFalse: () =>
					pipe(
						executeProcess('tailscale', ['status', '--json']),
						Effect.flatMap(
							Schema.decodeEffect(Schema.fromJsonString(Schema.Struct({MagicDNSSuffix: Schema.NonEmptyString})))
						),
						Effect.map(status => status.MagicDNSSuffix)
					),
				onTrue: () => Effect.succeed('')
			})
			const port = (yield* packageMetadata).config.port
			const workers = yield* Effect.forEach(
				names,
				name => Schema.decodeEffect(Worker)({name, url: `https://${name}.${suffix}:${port}`}),
				{concurrency: 1}
			)
			// Peer requests share the fleet's reconnecting transport, never a request's lifetime.
			const clients = yield* Effect.forEach(
				workers,
				worker =>
					Effect.gen(function* () {
						const connected = yield* Ref.make(false)
						const url = new URL(RPC_PATH, worker.url)
						url.protocol = Boolean.match(new URL(worker.url).protocol === 'http:', {
							onFalse: Function.constant('wss:'),
							onTrue: Function.constant('ws:')
						})
						const protocol = yield* Layer.build(
							pipe(
								RpcClient.layerProtocolSocket({pingTimeout: Duration.seconds(15)}),
								Layer.provide(
									Layer.succeed(RpcClient.ConnectionHooks, {
										onConnect: Ref.set(connected, true),
										onDisconnect: Ref.set(connected, false)
									})
								),
								Layer.provide(NodeSocket.layerWebSocket(url.href)),
								Layer.provide(RpcSerialization.layerSchemaBinary()),
								Layer.provideMerge(layerRpcStreamClient)
							)
						)
						return [worker.name, {client: yield* Effect.provideContext(makeRemoteClient, protocol), connected}] as const
					}),
				{concurrency: 'unbounded'}
			)
			const peers = Record.fromEntries(clients)
			const previous = yield* Ref.make<Record<WorkerId, Snapshot>>({})
			const local = Effect.withSpan(
				Effect.gen(function* () {
					const snapshot = yield* inventory.snapshot
					// Owned exposures are one more source: a failed read shows as its error, as an inventory source's does.
					const owned = yield* Effect.match(exposures.items, {
						onFailure: cause => ({items: [], sources: [{error: Option.some(cause.message), name: 'Exposures'}]}),
						onSuccess: items => ({items, sources: []})
					})
					return {
						...snapshot,
						items: [...snapshot.items, ...owned.items],
						sources: [...snapshot.sources, ...owned.sources],
						workers: Array.dedupe([...snapshot.workers, ...Array.map(workers, worker => worker.name)])
					} satisfies Snapshot
				}),
				'Fleet.local'
			)
			// Disconnected transports reconnect in the background. Do not start a traced RPC until one is open.
			const remote = Effect.fnUntraced(function* <A, E>(
				worker: Worker,
				use: (client: RemoteClient) => Effect.Effect<A, E>
			) {
				const peer = yield* pipe(
					peers,
					Record.get(worker.name),
					Option.match({
						onNone: () => DeployError.make({message: `Worker ${worker.name} is not configured.`}),
						onSome: Effect.succeed
					})
				)
				if (!(yield* Ref.get(peer.connected))) {
					return yield* DeployError.make({message: 'Worker is unreachable'})
				}
				return yield* pipe(
					use(peer.client),
					Effect.timeout(Duration.seconds(15)),
					Effect.withSpan('Fleet.remote', {attributes: {worker: worker.name}})
				)
			})
			function selectedWorker(target: WorkerId) {
				return pipe(
					workers,
					Array.findFirst(worker => worker.name === target),
					Effect.fromOption,
					Effect.mapError(cause =>
						DeployError.make({cause, message: 'This worker is not configured on the control plane'})
					)
				)
			}
			return Fleet.of({
				current: Effect.fn('Fleet.current')(function* (query) {
					yield* Effect.annotateCurrentSpan({minutes: Duration.toMinutes(query.minutes), workers: workers.length + 1})
					const own = yield* metrics.read(query)
					const time = yield* DateTime.now
					const cached = yield* Ref.get(lastMetrics)
					return [
						own,
						...Array.map(workers, worker => {
							const saved = HashMap.get(cached, [worker.name, query.minutes])
							return {
								...cachedHistory(query, time, saved),
								error: Option.match(saved, {
									onNone: () => Option.some('Waiting for worker'),
									onSome: machine => machine.error
								}),
								stale: Option.match(saved, {
									onNone: Function.constTrue,
									onSome: machine =>
										machine.stale ||
										pipe(machine.time, DateTime.distance(time), Duration.isGreaterThan(Duration.seconds(90)))
								}),
								worker: worker.name
							}
						})
					]
				}),
				expose: Effect.fn('Fleet.expose')(
					function* (input) {
						yield* Effect.annotateCurrentSpan({exposure: input.name, worker: input.worker})
						if (input.worker === localWorker) {
							return yield* Effect.onExit(exposures.expose(Struct.omit(input, ['worker'])), () => inventory.refresh)
						}
						return yield* remote(yield* selectedWorker(input.worker), client =>
							client('exposures.apply', Struct.omit(input, ['worker']))
						)
					},
					Effect.onExit(() => reactivity.invalidate(['deployInventory'])),
					asDeployError
				),
				hide: Effect.fn('Fleet.hide')(
					function* (input) {
						yield* Effect.annotateCurrentSpan({exposure: input.name, worker: input.worker})
						if (input.worker === localWorker) {
							return yield* Effect.onExit(exposures.hide(input.name), () => inventory.refresh)
						}
						return yield* remote(yield* selectedWorker(input.worker), client =>
							client('exposures.remove', {name: input.name})
						)
					},
					Effect.onExit(() => reactivity.invalidate(['deployInventory'])),
					asDeployError
				),
				history: Effect.fn('Fleet.history')(function* (query) {
					yield* Effect.annotateCurrentSpan('minutes', Duration.toMinutes(query.minutes))
					return yield* metrics.read(query)
				}),
				local,
				metrics: Effect.fn('Fleet.metrics')(function* (query) {
					yield* Effect.annotateCurrentSpan({minutes: Duration.toMinutes(query.minutes), workers: workers.length + 1})
					yield* Effect.forEach(
						workers,
						worker =>
							pipe(
								remote(worker, client => client('metrics.history', query)),
								Effect.timeout(Duration.seconds(2)),
								Effect.map(value => ({...value, worker: worker.name})),
								Effect.tapError(cause => Effect.logWarning('A worker history could not be read', cause)),
								Effect.catch(
									Effect.fnUntraced(function* (cause) {
										return {
											...cachedHistory(
												query,
												yield* DateTime.now,
												HashMap.get(yield* Ref.get(lastMetrics), [worker.name, query.minutes])
											),
											error: Option.some(cause.message),
											stale: true,
											worker: worker.name
										}
									})
								),
								Effect.tap(value =>
									Ref.update(lastMetrics, all => HashMap.set(all, [worker.name, query.minutes], value))
								)
							),
						{concurrency: 'unbounded'}
					)
				}),
				run: Effect.fn('Fleet.run')(
					function* (input) {
						yield* Effect.annotateCurrentSpan({job: input.name, worker: input.worker})
						if (input.worker === localWorker) {
							return yield* inventory.run(Struct.omit(input, ['worker']))
						}
						return yield* remote(yield* selectedWorker(input.worker), client =>
							client('inventory.start', Struct.omit(input, ['worker']))
						)
					},
					Effect.onExit(() => reactivity.invalidate(['deployInventory'])),
					Effect.mapError(cause => {
						if (Schema.is(DeployError)(cause)) return cause
						return DeployError.make({cause, message: 'Worker could not start the job'})
					})
				),
				snapshot: Effect.withSpan(
					Effect.gen(function* () {
						const own = yield* local
						const others = yield* Effect.forEach(
							workers,
							worker =>
								pipe(
									remote(worker, client => client('inventory.snapshot', undefined)),
									Effect.timeout(Duration.seconds(2)),
									Effect.map(
										snapshot =>
											({
												...snapshot,
												items: Array.map(snapshot.items, item => ({
													...item,
													id: ItemId.make(`${worker.name}:${item.id}`),
													worker: worker.name
												})),
												sources: Array.map(snapshot.sources, source => ({
													...source,
													name: `${worker.name} · ${source.name}`
												}))
											}) satisfies Snapshot
									),
									Effect.tap(snapshot => Ref.update(previous, rows => Record.set(rows, worker.name, snapshot))),
									Effect.matchEffect({
										onFailure: cause =>
											Effect.map(Ref.get(previous), rows => ({
												items: rows[worker.name]?.items ?? [],
												sources: [{error: Option.some(cause.message), name: `${worker.name} · Snapshot`}]
											})),
										onSuccess: Effect.succeed
									})
								),
							{concurrency: 'unbounded'}
						)
						return {
							items: [...own.items, ...Array.flatMap(others, value => value.items)],
							sources: [...own.sources, ...Array.flatMap(others, value => value.sources)],
							time: yield* DateTime.now,
							workers: Array.dedupe([...own.workers, ...Array.map(workers, worker => worker.name)])
						} satisfies Snapshot
					}),
					'Fleet.snapshot',
					{attributes: {workers: workers.length + 1}}
				)
			})
		})
	)
}
