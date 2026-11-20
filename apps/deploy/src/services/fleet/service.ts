import {hostname} from 'node:os'

import {NodeSocket} from '@effect/platform-node'

import {
	Array,
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
	Result,
	Schema,
	String,
	Struct,
	pipe
} from 'effect'

import {ChildProcessSpawner} from 'effect/process'
import {Reactivity} from 'effect/reactivity'
import {RpcClient, RpcSerialization} from 'effect/rpc'

import {packageMetadata} from '@deslop/runtime/server/package'
import {executeProcess} from '@deslop/runtime/server/process'
import type {Admin} from '@deslop/runtime/shared/auth'
import {RpcStream, layerRpcStreamClient} from '@deslop/runtime/shared/rpc'
import {RPC_PATH, SecureOrigin} from '@deslop/runtime/shared/schema'

import {RpcContracts} from '#rpcs/contracts.ts'
import type {ExposeRequest, HideRequest} from '#services/exposures/schema.ts'
import {Exposures} from '#services/exposures/service.ts'
import {DeployError, ItemId, WorkerId} from '#services/inventory/schema.ts'
import type {RunRequest, Snapshot} from '#services/inventory/schema.ts'
import {Inventory} from '#services/inventory/service.ts'
import {peerHistory} from '#services/metrics/lib/utils.ts'
import type {PeerHistory} from '#services/metrics/lib/utils.ts'
import type {HistoryQuery, MachineHistory} from '#services/metrics/schema.ts'
import {Metrics} from '#services/metrics/service.ts'

const makeRemoteClient = RpcClient.make(RpcContracts.middleware(RpcStream), {flatten: true})

type RemoteClient = Effect.Success<typeof makeRemoteClient>

function asDeployError<A, E>(effect: Effect.Effect<A, E>) {
	return Effect.mapError(effect, cause => {
		if (Schema.is(DeployError)(cause)) return cause
		return DeployError.make({cause, message: 'Worker exposure change failed'})
	})
}

export class Fleet extends Context.Service<
	Fleet,
	{
		readonly expose: (input: ExposeRequest, admin: Admin) => Effect.Effect<string, DeployError>
		readonly hide: (input: HideRequest, admin: Admin) => Effect.Effect<void, DeployError>
		readonly run: (input: RunRequest, admin: Admin) => Effect.Effect<void, DeployError>
		readonly local: Effect.Effect<Snapshot>
		readonly history: (query: HistoryQuery) => Effect.Effect<MachineHistory, DeployError>
		readonly current: (query: HistoryQuery) => Effect.Effect<MachineHistory[], DeployError>
		readonly metrics: (query: HistoryQuery) => Effect.Effect<void>
		// One peer's history read into the shared view; a slow peer delays only itself.
		readonly peerMetrics: (worker: WorkerId, query: HistoryQuery) => Effect.Effect<void>
		// One peer's inventory read into the shared view.
		readonly peerSnapshot: (worker: WorkerId) => Effect.Effect<void>
		// The configured peers, without this worker.
		readonly peers: readonly WorkerId[]
		// This worker's inventory and each peer's last one, without waiting on any peer.
		readonly view: Effect.Effect<Snapshot>
		// Every peer read now, each within two seconds, then the view.
		readonly snapshot: Effect.Effect<Snapshot>
		// This worker and the configured peers: the names a command can target.
		readonly workers: readonly WorkerId[]
	}
>()('@deslop/deploy/services/fleet/service/Fleet') {
	static readonly layer = Layer.effect(
		this,
		Effect.gen(function* () {
			const inventory = yield* Inventory
			const reactivity = yield* Reactivity.Reactivity
			const spawner = yield* ChildProcessSpawner.ChildProcessSpawner
			const layerScope = yield* Effect.scope
			const localWorker = yield* Schema.decodeEffect(WorkerId)(hostname())
			const metrics = yield* Metrics
			const lastMetrics = yield* Ref.make(HashMap.empty<readonly [WorkerId, Duration.Duration], PeerHistory>())
			const exposures = yield* Exposures
			const names = yield* Config.withDefault(Config.Array(WorkerId.check(Schema.isNonEmpty()), 'DEPLOY_WORKERS'), [])
			const suffix = pipe(
				executeProcess('tailscale', ['status', '--json'], {timeout: '5 seconds'}),
				Effect.flatMap(
					Schema.decodeEffect(Schema.fromJsonString(Schema.Struct({MagicDNSSuffix: Schema.NonEmptyString})))
				),
				Effect.map(status => status.MagicDNSSuffix),
				Effect.provideService(ChildProcessSpawner.ChildProcessSpawner, spawner)
			)
			const port = (yield* packageMetadata).config.port
			const workers = Array.map(names, name => ({name}))
			const clients = yield* Effect.forEach(
				workers,
				worker =>
					Effect.gen(function* () {
						const connected = yield* Ref.make(false)
						const url = pipe(
							suffix,
							Effect.flatMap(value => Schema.decodeEffect(SecureOrigin)(`https://${worker.name}.${value}:${port}`)),
							Effect.map(origin => `${String.replace('https:', 'wss:')(origin)}${RPC_PATH}`),
							Effect.tapError(error =>
								Effect.andThen(
									Effect.logWarning('Peer address is unavailable; retrying in five seconds', error),
									Effect.sleep('5 seconds')
								)
							),
							Effect.eventually
						)
						const protocol = yield* Layer.build(
							pipe(
								RpcClient.layerProtocolSocket({pingTimeout: Duration.seconds(15)}),
								Layer.provide(
									Layer.succeed(RpcClient.ConnectionHooks, {
										onConnect: Ref.set(connected, true),
										onDisconnect: Ref.set(connected, false)
									})
								),
								Layer.provide(NodeSocket.layerWebSocket(url)),
								Layer.provide(RpcSerialization.layerSchemaBinary()),
								Layer.provideMerge(layerRpcStreamClient)
							)
						)
						return [worker.name, {client: yield* Effect.provideContext(makeRemoteClient, protocol), connected}] as const
					}),
				{concurrency: 'unbounded'}
			)
			const peers = Record.fromEntries(clients)
			// Each peer's last inventory as the view shows it: its items, and its error when the latest read failed.
			const peerViews = yield* Ref.make<Record<WorkerId, {items: Snapshot['items']; sources: Snapshot['sources']}>>({})
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
				worker: {name: WorkerId},
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
			const peerSnapshot = Effect.fn('Fleet.peerSnapshot')(function* (name: WorkerId) {
				const worker = {name}
				const read = yield* pipe(
					remote(worker, client => client('inventory.snapshot', undefined)),
					Effect.timeout(Duration.seconds(2)),
					Effect.map(snapshot => ({
						items: Array.map(snapshot.items, item => ({
							...item,
							id: ItemId.make(`${worker.name}:${item.id}`),
							worker: worker.name
						})),
						sources: Array.map(snapshot.sources, source => ({...source, name: `${worker.name} · ${source.name}`}))
					})),
					Effect.result
				)
				yield* Ref.update(peerViews, views =>
					Record.set(
						views,
						worker.name,
						Result.match(read, {
							onFailure: cause => ({
								items: views[worker.name]?.items ?? [],
								sources: [{error: Option.some(cause.message), name: `${worker.name} · Snapshot`}]
							}),
							onSuccess: Function.identity
						})
					)
				)
			})
			const view = Effect.withSpan(
				Effect.gen(function* () {
					const own = yield* local
					const views = yield* Ref.get(peerViews)
					const others = Array.getSomes(Array.map(workers, worker => Record.get(views, worker.name)))
					return {
						items: [...own.items, ...Array.flatMap(others, value => value.items)],
						sources: [...own.sources, ...Array.flatMap(others, value => value.sources)],
						time: yield* DateTime.now,
						workers: own.workers
					} satisfies Snapshot
				}),
				'Fleet.view'
			)
			const peerMetrics = Effect.fn('Fleet.peerMetrics')(function* (name: WorkerId, query: HistoryQuery) {
				const worker = {name}
				const read = yield* pipe(
					remote(worker, client => client('metrics.history', query)),
					Effect.timeout(Duration.seconds(2)),
					Effect.tapError(cause => Effect.logWarning('A worker history could not be read', cause)),
					Effect.result
				)
				const received = yield* DateTime.now
				// A failed read keeps the last answer and only records why it failed.
				yield* Ref.update(lastMetrics, all =>
					HashMap.set(
						all,
						[worker.name, query.minutes],
						Result.match(read, {
							onFailure: cause => ({
								error: Option.some(cause.message),
								saved: pipe(
									all,
									HashMap.get([worker.name, query.minutes]),
									Option.flatMap(peer => peer.saved)
								)
							}),
							onSuccess: value => ({
								error: Option.none(),
								saved: Option.some({history: {...value, worker: worker.name}, received})
							})
						})
					)
				)
			})
			// A command on a peer answers once the peer does; its next inventory reaches viewers when it arrives.
			function refreshPeer(name: WorkerId) {
				return pipe(
					peerSnapshot(name),
					Effect.andThen(reactivity.invalidate(['deployInventory'])),
					Effect.forkIn(layerScope),
					Effect.asVoid
				)
			}
			// A command on a peer refreshes that peer however it ends, since a failed one may have changed it.
			function onPeer<A, E>(name: WorkerId, use: (client: RemoteClient) => Effect.Effect<A, E>) {
				return pipe(
					workers,
					Array.findFirst(worker => worker.name === name),
					Effect.fromOption,
					Effect.mapError(cause =>
						DeployError.make({cause, message: 'This worker is not configured on the control plane'})
					),
					Effect.flatMap(worker => Effect.onExit(remote(worker, use), () => refreshPeer(name)))
				)
			}
			// Wake inventory viewers after commands even on failure, since a failed command may have changed the worker.
			return Fleet.of({
				current: Effect.fn('Fleet.current')(function* (query) {
					yield* Effect.annotateCurrentSpan({minutes: Duration.toMinutes(query.minutes), workers: workers.length + 1})
					const own = yield* metrics.read(query)
					const time = yield* DateTime.now
					const cached = yield* Ref.get(lastMetrics)
					return [
						own,
						...Array.map(workers, worker =>
							peerHistory(query.minutes, time, worker.name, HashMap.get(cached, [worker.name, query.minutes]))
						)
					]
				}),
				expose: Effect.fn('Fleet.expose')(
					function* (input, admin) {
						yield* Effect.annotateCurrentSpan({exposure: input.name, worker: input.worker})
						if (input.worker === localWorker) {
							return yield* Effect.onExit(
								exposures.expose(Struct.omit(input, ['worker']), admin),
								() => inventory.refresh
							)
						}
						return yield* onPeer(input.worker, client => client('exposures.apply', Struct.omit(input, ['worker'])))
					},
					Effect.onExit(() => reactivity.invalidate(['deployInventory'])),
					asDeployError
				),
				hide: Effect.fn('Fleet.hide')(
					function* (input, admin) {
						yield* Effect.annotateCurrentSpan({exposure: input.name, worker: input.worker})
						if (input.worker === localWorker) {
							return yield* Effect.onExit(exposures.hide(input.name, admin), () => inventory.refresh)
						}
						return yield* onPeer(input.worker, client => client('exposures.remove', {name: input.name}))
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
					yield* Effect.forEach(workers, worker => peerMetrics(worker.name, query), {concurrency: 'unbounded'})
				}),
				peerMetrics,
				peerSnapshot,
				peers: Array.map(workers, worker => worker.name),
				run: Effect.fn('Fleet.run')(
					function* (input, admin) {
						yield* Effect.annotateCurrentSpan({job: input.name, worker: input.worker})
						if (input.worker === localWorker) {
							return yield* inventory.run(Struct.omit(input, ['worker']), admin)
						}
						return yield* onPeer(input.worker, client => client('inventory.start', Struct.omit(input, ['worker'])))
					},
					Effect.onExit(() => reactivity.invalidate(['deployInventory'])),
					Effect.mapError(cause => {
						if (Schema.is(DeployError)(cause)) return cause
						return DeployError.make({cause, message: 'Worker could not start the job'})
					})
				),
				snapshot: pipe(
					Effect.all(
						[
							inventory.ensureFresh,
							Effect.forEach(workers, worker => peerSnapshot(worker.name), {concurrency: 'unbounded'})
						],
						{concurrency: 'unbounded'}
					),
					Effect.andThen(view),
					Effect.withSpan('Fleet.snapshot', {attributes: {workers: workers.length + 1}})
				),
				view,
				workers: [localWorker, ...Array.map(workers, worker => worker.name)]
			})
		})
	)
}
