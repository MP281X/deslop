import {userInfo} from 'node:os'

import {
	Array,
	Boolean,
	Context,
	DateTime,
	Duration,
	Effect,
	Fiber,
	FileSystem,
	Function,
	HashSet,
	Layer,
	Number,
	Option,
	Record,
	Ref,
	Schema,
	String,
	SubscriptionRef,
	pipe
} from 'effect'

import {HttpClient} from 'effect/http'
import {ChildProcessSpawner} from 'effect/process'
import {Reactivity} from 'effect/reactivity'

import type {Admin} from '@deslop/runtime/shared/auth'

import {APP_LIFECYCLE_MESSAGES, ExposureName, InventoryItem, ItemId, Timer} from './contract.ts'
import type {AppId, AppRequest, Process, RunJobInput, RunRequest, Snapshot} from './contract.ts'
import {processReadings, processes} from './processes.ts'
import {appDetails, appUnit, commandRunner, makeListeners, ownedProcess, restartTimes, units} from './sources.ts'
import type {AppAction, Command} from './sources.ts'
import {attachProcesses, processOwner, requestOf, workloads} from './workloads.ts'

import {DeployError} from '#machine/contract.ts'
import {Serve, TailnetStatus} from '#proxies/contract.ts'

function collect<E extends {readonly message: string}, R>(name: string, effect: Effect.Effect<InventoryItem[], E, R>) {
	return pipe(
		effect,
		Effect.timeout(Duration.seconds(10)),
		Effect.withSpan('Inventory.collect', {attributes: {source: name}}),
		Effect.match({
			onFailure: cause => ({items: Array.empty<InventoryItem>(), source: {error: Option.some(cause.message), name}}),
			onSuccess: items => ({items, source: {error: Option.none<string>(), name}})
		})
	)
}

type ContainerId = typeof ContainerId.Type
const ContainerId = Schema.brand('DeployContainerId')(Schema.String)

type Container = typeof Container.Type
const Container = Schema.Struct({
	ID: ContainerId,
	Labels: Schema.OptionFromOptionalKey(Schema.String),
	Names: Schema.String,
	Ports: Schema.String,
	State: Schema.String,
	Status: Schema.String
})

// One JSON container per line of `docker ps --format '{{json .}}'`.
function containerRows(listing: string) {
	return pipe(
		listing,
		String.split('\n'),
		Array.filter(String.isNonEmpty),
		Array.map(line => Schema.decodeOption(Schema.fromJsonString(Container))(line)),
		Array.getSomes
	)
}

// fallow-ignore-next-line unused-export -- Tests call this directly.
export function containers(command: Command) {
	return pipe(
		command('docker', ['ps', '--all', '--format', '{{json .}}']),
		Effect.map(containerRows),
		Effect.map(rows =>
			Array.map(rows, row =>
				InventoryItem.make({
					active: Array.contains(['running', 'restarting', 'paused'], row.State),
					bindings: Option.some(
						Array.filter(
							[
								...Array.map(
									Array.fromIterable(
										String.matchAll(/traefik\.http\.services\.[^=,]+\.loadbalancer\.server\.port=([0-9]+)/gu)(
											Option.getOrElse(row.Labels, Function.constant(''))
										)
									),
									match => ({
										address: 'container',
										port: Option.getOrElse(Number.parse(match[1] ?? ''), Function.constant(0)),
										protocol: 'tcp' as const
									})
								),
								...Array.map(
									Array.fromIterable(
										String.matchAll(/((?:[0-9.]+|\[[0-9a-f:]+\])):([0-9]+)->[0-9]+\/(tcp|udp)/giu)(row.Ports)
									),
									match => ({
										address: `${match[1]}:${match[2]}`,
										port: Option.getOrElse(Number.parse(match[2] ?? ''), Function.constant(0)),
										protocol: Boolean.match(match[3] === 'udp', {
											onFalse: Function.constant('tcp' as const),
											onTrue: Function.constant('udp' as const)
										})
									})
								)
							],
							binding => binding.port > 0 && binding.port <= 65_535
						)
					),
					detail: row.Status,
					health: Boolean.match(
						String.includes('unhealthy')(row.Status) || Option.isSome(String.match(/Exited \([1-9]/u)(row.Status)),
						{
							onFalse: () =>
								Boolean.match(row.State === 'restarting', {
									onFalse: Function.constant('quiet' as const),
									onTrue: Function.constant('warning' as const)
								}),
							onTrue: Function.constant('error' as const)
						}
					),
					id: ItemId.make(`docker:${row.ID}`),
					kind: 'container',
					links: Option.some(
						Array.dedupe(
							Array.map(
								Array.fromIterable(
									String.matchAll(/Host\(`([^`]+)`\)/gu)(Option.getOrElse(row.Labels, Function.constant('')))
								),
								match => `https://${match[1]}`
							)
						)
					),
					name: row.Names,
					state: Boolean.match(String.includes('unhealthy')(row.Status), {
						onFalse: () => row.State,
						onTrue: Function.constant('unhealthy')
					}),
					url: Option.none()
				})
			)
		)
	)
}

// This machine's Tailscale node.
// fallow-ignore-next-line unused-export -- Tests call this directly.
export function tailnetPeers(command: Command) {
	return pipe(
		command('tailscale', ['status', '--json']),
		Effect.flatMap(Schema.decodeEffect(Schema.fromJsonString(TailnetStatus))),
		Effect.map(status =>
			Array.map(Option.toArray(status.Self), peer =>
				InventoryItem.make({
					detail: `${peer.OS} · ${Array.join(peer.TailscaleIPs, ', ')}`,
					hostname: Option.some(String.replace(/\.$/u, '')(peer.DNSName)),
					id: ItemId.make(`peer:${peer.DNSName}`),
					kind: 'peer',
					name: peer.HostName,
					self: Option.some(true),
					state: Boolean.match(peer.Online, {
						onFalse: Function.constant('offline'),
						onTrue: Function.constant('online')
					}),
					url: Option.none()
				})
			)
		)
	)
}

// Each site Tailscale Serve maps, whoever configured it.
// fallow-ignore-next-line unused-export -- Tests call this directly.
export function tailnetSites(command: Command) {
	return pipe(
		command('tailscale', ['serve', 'status', '--json']),
		Effect.flatMap(Schema.decodeEffect(Schema.fromJsonString(Serve))),
		Effect.map(status =>
			Array.flatMap(Record.toEntries(Option.getOrElse(status.Web, () => ({}))), site =>
				Array.map(Record.toEntries(site[1].Handlers), handler =>
					InventoryItem.make({
						detail: `${pipe(
							status.AllowFunnel,
							Option.exists(permissions => permissions[site[0]] === true),
							Boolean.match({
								onFalse: Function.constant('tailnet'),
								onTrue: Function.constant('Funnel permitted (public)')
							})
						)} → ${Option.getOrElse(handler[1].Proxy, Function.constant('non-proxy handler'))}`,
						health: pipe(
							status.AllowFunnel,
							Option.exists(permissions => permissions[site[0]] === true),
							Boolean.match({
								onFalse: Function.constant('quiet' as const),
								onTrue: Function.constant('warning' as const)
							})
						),
						id: ItemId.make(`tailscale:${site[0]}:${handler[0]}`),
						kind: 'exposure',
						name: ExposureName.make(`${site[0]}${handler[0]}`),
						owned: Option.some(false),
						port: pipe(
							handler[1].Proxy,
							Option.flatMap(String.match(/^http:\/\/(?:127\.0\.0\.1|localhost):([0-9]+)/u)),
							Option.flatMap(match => Number.parse(match[1] ?? ''))
						),
						publicAccess: Option.some(Option.exists(status.AllowFunnel, permissions => permissions[site[0]] === true)),
						state: 'observed',
						// A root handler's address is the site's own, as an owned exposure writes it, so a row shows the two as one.
						url: Option.some(`https://${site[0]}${String.replace(/^\/$/u, '')(handler[0])}`)
					})
				)
			)
		)
	)
}

export class Inventory extends Context.Service<
	Inventory,
	{
		readonly appProcesses: Effect.Effect<
			{readonly readings: readonly {app: AppId; process: Process}[]; readonly time: DateTime.Utc},
			DeployError
		>
		readonly refresh: Effect.Effect<void>
		readonly ensureFresh: Effect.Effect<void>
		readonly logs: (input: AppRequest, admin: Admin) => Effect.Effect<string, DeployError>
		readonly restart: (input: AppRequest, admin: Admin) => Effect.Effect<void, DeployError>
		readonly restarts: (input: AppRequest, time: DateTime.Utc) => Effect.Effect<readonly DateTime.Utc[], DeployError>
		readonly run: (input: RunRequest, admin: Admin) => Effect.Effect<void, DeployError>
		readonly snapshot: Effect.Effect<Snapshot>
		readonly stop: (input: AppRequest, admin: Admin) => Effect.Effect<void, DeployError>
	}
>()('@deslop/deploy/inventory/server/Inventory') {
	static readonly layer = Layer.effect(
		this,
		Effect.gen(function* () {
			const fs = yield* FileSystem.FileSystem
			const http = yield* HttpClient.HttpClient
			const reactivity = yield* Reactivity.Reactivity
			const layerScope = yield* Effect.scope

			const command = commandRunner(yield* ChildProcessSpawner.ChildProcessSpawner)
			const processState = yield* Ref.make(Option.none<ReturnType<typeof processReadings>>())
			const uid = userInfo().uid
			const requireOwnedUnit = Effect.fnUntraced(function* (input: AppRequest) {
				const denied = DeployError.make({message: `${input.id} is not an owned app`})
				const name = yield* pipe(
					appUnit(input.id),
					Effect.fromOption,
					Effect.mapError(() => denied)
				)
				if (!HashSet.has(yield* appDetails(command, [name]), name)) return yield* denied
				return name
			})
			const listeners = yield* makeListeners(command, fs, http)
			// This machine's processes from /proc, each owned by its cgroup, and its systemd units, containers and listeners.
			const processTable = pipe(
				processes(processOwner),
				Effect.provideService(FileSystem.FileSystem, fs),
				Effect.mapError(cause => DeployError.make({cause, message: 'The processes could not be read.'}))
			)
			const previousAppProcesses = yield* Ref.make(Option.none<ReturnType<typeof processReadings>>())
			// The metrics sampler only labels managed apps' processes and doesn't refresh the inventory.
			const appProcesses = Effect.gen(function* () {
				const current = yield* pipe(
					processes(cgroup => ownedProcess(uid, cgroup)),
					Effect.provideService(FileSystem.FileSystem, fs),
					Effect.timeout(Duration.seconds(3)),
					Effect.mapError(cause => DeployError.make({cause, message: 'The app processes could not be read.'}))
				)
				const next = yield* Ref.modify(previousAppProcesses, previous => {
					const reading = processReadings(current, previous)
					return [reading, Option.some(reading)]
				})
				return {
					readings: Array.flatMap(next.readings, reading =>
						Option.toArray(Option.map(reading.owner, app => ({app, process: reading.process})))
					),
					time: current.time
				}
			})
			const machineSources = [
				collect('User services', units(command, false)),
				collect('System services', units(command, true)),
				collect('Docker', containers(command)),
				collect('Listening ports', listeners)
			]
			// Only a service a timer starts, so the page can't start arbitrary units; system ones go through the machine's passwordless sudo.
			const start = Effect.fnUntraced(
				function* (input: RunRequest) {
					yield* Effect.annotateCurrentSpan({job: input.name, scope: input.scope})
					const timers = yield* Effect.flatMap(
						command('systemctl', [
							...Boolean.match(input.scope === 'system', {onFalse: () => ['--user'], onTrue: () => []}),
							'list-timers',
							'--all',
							'--output=json',
							'--no-pager'
						]),
						Schema.decodeUnknownEffect(Schema.fromJsonString(Schema.Array(Timer)))
					)
					if (!Array.some(timers, timer => Option.contains(timer.activates, input.name))) {
						return yield* DeployError.make({message: `${input.name} is not started by a timer`})
					}
					yield* Boolean.match(input.scope === 'system', {
						onFalse: () => command('systemctl', ['--user', 'start', '--no-block', input.name]),
						onTrue: () => command('sudo', ['-n', 'systemctl', 'start', '--no-block', input.name])
					})
				},
				Effect.scoped,
				Effect.mapError(cause => {
					if (Schema.is(DeployError)(cause)) return cause
					return DeployError.make({cause, message: 'Cannot start the job'})
				})
			)
			const collectSnapshot = Effect.withSpan(
				Effect.scoped(
					Effect.gen(function* () {
						// The process table is read while the sources' commands run, not after them.
						const processing = yield* pipe(
							processTable,
							Effect.flatMap(current =>
								Ref.modify(processState, previous => {
									const next = processReadings(current, previous)
									return [next.readings, Option.some(next)]
								})
							),
							Effect.timeout(Duration.seconds(3)),
							Effect.match({
								onFailure: cause => ({error: Option.some(cause.message), records: []}),
								onSuccess: records => ({error: Option.none<string>(), records})
							}),
							Effect.forkScoped
						)
						const sources = yield* Effect.all(
							[
								...machineSources,
								collect('Tailnet', tailnetPeers(command)),
								collect('Tailscale Serve', tailnetSites(command))
							],
							{concurrency: 'unbounded'}
						)
						const collected = yield* Fiber.join(processing)
						return {
							items: attachProcesses(
								Array.flatMap(sources, source => source.items),
								collected.records
							),
							sources: [...Array.map(sources, source => source.source), {error: collected.error, name: 'Processes'}],
							time: yield* DateTime.now
						} satisfies Snapshot
					})
				),
				'Inventory.snapshot'
			)
			const snapshot = yield* SubscriptionRef.make(yield* collectSnapshot)
			const [ensureFresh, invalidate] = yield* Effect.cachedInvalidateWithTTL(
				pipe(
					snapshot,
					SubscriptionRef.updateEffect(() => collectSnapshot),
					Effect.withSpan('Inventory.refresh')
				),
				Duration.seconds(5)
			)
			const refresh = Effect.andThen(invalidate, ensureFresh)
			function wakeInventory<A>(effect: Effect.Effect<A, DeployError>) {
				return Effect.onExit(effect, () =>
					pipe(refresh, Effect.andThen(reactivity.invalidate(['deployInventory'])), Effect.forkIn(layerScope))
				)
			}
			function changeApp(action: AppAction, input: AppRequest) {
				return Effect.flatMap(requireOwnedUnit(input), name =>
					wakeInventory(Effect.asVoid(command('systemctl', ['--user', action, '--no-block', '--', name])))
				)
			}
			return {
				appProcesses,
				ensureFresh,
				logs: Effect.fn('Inventory.logs')(function* (input) {
					return yield* command('journalctl', [
						'--quiet',
						'--no-pager',
						'--output=short-iso',
						'--lines=200',
						`--user-unit=${yield* requireOwnedUnit(input)}`
					])
				}),
				refresh,
				restart: Effect.fn('Inventory.restart')(input => changeApp('restart', input)),
				restarts: Effect.fn('Inventory.restarts')(function* (input, time) {
					return yield* Option.match(appUnit(input.id), {
						onNone: () => Effect.succeed(Array.empty<DateTime.Utc>()),
						onSome: Effect.fnUntraced(function* (name) {
							const text = yield* command('journalctl', [
								'--quiet',
								'--no-pager',
								'--output=json',
								'--output-fields=MESSAGE_ID,USER_INVOCATION_ID',
								'--lines=512',
								`USER_UNIT=${name}`,
								`_UID=${uid}`,
								'_SYSTEMD_USER_UNIT=init.scope',
								...Array.map(APP_LIFECYCLE_MESSAGES, id => `MESSAGE_ID=${id}`)
							])
							return restartTimes(text, DateTime.subtractDuration(time, Duration.hours(1)), time)
						})
					})
				}),
				// The caller gets the start's answer at once; the refresh that follows wakes viewers when it lands, so a deadline never waits on it.
				run: Effect.fn('Inventory.run')(input => wakeInventory(start(input))),
				snapshot: SubscriptionRef.get(snapshot),
				stop: Effect.fn('Inventory.stop')(input => changeApp('stop', input))
			}
		})
	)
}

declare module 'effect/reactivity/Reactivity' {
	interface Keys {
		readonly deployInventory: never
	}
}

// The run request for a scheduled job the page shows, by its id: names repeat across scopes and units.
export const jobRequest = Effect.fnUntraced(function* (snapshot: Snapshot, input: RunJobInput) {
	return yield* pipe(
		workloads(snapshot.items),
		Array.findFirst(row => Option.contains(row.item.scheduled, true) && row.item.id === input.id),
		Option.match({
			onNone: () =>
				Effect.fail(DeployError.make({message: `No scheduled job has the id ${input.id}; list_apps shows the jobs.`})),
			onSome: row => Effect.succeed(requestOf(row.item))
		})
	)
})
