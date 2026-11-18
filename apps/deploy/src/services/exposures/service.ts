import {hostname} from 'node:os'
import {arch, platform} from 'node:process'

import {
	Array,
	Boolean,
	Context,
	Effect,
	Function,
	Layer,
	Option,
	Record,
	Ref,
	Result,
	Schema,
	Semaphore,
	Struct,
	pipe
} from 'effect'

import type {SqlError} from 'effect/sql'
import {Migrator, SqlClient, SqlSchema} from 'effect/sql'

import type {Admin} from '@deslop/runtime/shared/auth'

import {ownedConflict, refusal, restoreRefusal} from './lib/policy.ts'
import {makeReconciler} from './lib/reconciler.ts'
import {migrations} from './migrations.ts'

import {Exposure} from '#services/exposures/schema.ts'
import type {ExposeInput} from '#services/exposures/schema.ts'
import {portOwner} from '#services/inventory/lib/utils.ts'
import type {ExposureName, Serve, Snapshot} from '#services/inventory/schema.ts'
import {DeployError, InventoryItem, ItemId, WorkerId} from '#services/inventory/schema.ts'
import {Inventory} from '#services/inventory/service.ts'
import {Proxies} from '#services/proxies/service.ts'

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

function servesPort(status: Serve, port: number) {
	return Option.exists(status.TCP, ports => Record.has(ports, `${port}`))
}

function exposureUrl(row: Exposure) {
	if (row.kind === 'tailnet') return `https://${row.hostname}:${row.port}`
	return `https://${row.hostname}`
}

const asStorageDeployError = Effect.mapError((cause: SqlError.SqlError | Schema.SchemaError) =>
	DeployError.make({cause, message: 'The owned exposures could not be read or written.'})
)

function asDeployError<A, E, R>(effect: Effect.Effect<A, E, R>) {
	return Effect.mapError(effect, cause => {
		if (Schema.is(DeployError)(cause)) return cause
		return DeployError.make({cause, message: 'Exposure change failed; check permissions, target port and ownership'})
	})
}

export class Exposures extends Context.Service<Exposures>()('@deslop/deploy/services/exposures/service/Exposures', {
	make: Effect.gen(function* () {
		const sql = yield* SqlClient.SqlClient
		const proxies = yield* Proxies
		const inventory = yield* Inventory
		const worker = yield* Schema.decodeEffect(WorkerId)(hostname())

		const listExposures = SqlSchema.findAll({
			Request: Schema.Void,
			Result: Exposure,
			execute: () => sql`SELECT * FROM ${sql(Exposure.table)} ORDER BY name`
		})
		const insertExposure = SqlSchema.void({
			Request: Exposure.insert,
			execute: row => sql`INSERT INTO ${sql(Exposure.table)} ${sql.insert(row)}`
		})
		const markRemoving = SqlSchema.void({
			Request: Exposure.fields.name,
			execute: name => sql`UPDATE ${sql(Exposure.table)} SET state = 'removing' WHERE name = ${name}`
		})
		const deleteRemoved = SqlSchema.void({
			Request: Exposure.fields.name,
			execute: name => sql`DELETE FROM ${sql(Exposure.table)} WHERE name = ${name} AND state = 'removing'`
		})
		const recordOwner = SqlSchema.void({
			Request: Schema.Struct({name: Exposure.fields.name, owner: Schema.String}),
			execute: row => sql`UPDATE ${sql(Exposure.table)} SET owner = ${row.owner} WHERE name = ${row.name}`
		})
		const owned = asStorageDeployError(listExposures())
		const lock = yield* Semaphore.make(1)
		// A pass reads the rows and changes the proxies inside one hold, and a removal is saved inside another, so no pass publishes a row from before its removal was saved.
		const passLock = yield* Semaphore.make(1)
		// The public sites Caddy last loaded in this process; none until the first pass loads them, so Caddy restarts onto this release's binary.
		const loaded = yield* Ref.make(Option.none<string>())
		// Why each exposure is not yet as saved, from the last pass.
		const problems = yield* Ref.make<Record<ExposureName, string>>({})

		const listener = Effect.fnUntraced(function* (items: Snapshot['items'], port: number) {
			return {owner: portOwner(items, port), runtime: yield* proxies.runtime(port)}
		})

		// Caddy loads the public rows to publish when they differ from what it last loaded; a removal's row goes only once Caddy no longer serves it.
		const reconcileCaddy = Effect.fnUntraced(function* (
			rows: readonly {held: Option.Option<string>; publish: boolean; row: Exposure}[]
		) {
			const sites = pipe(
				rows,
				Array.filter(entry => entry.publish),
				Array.map(entry => entry.row)
			)
			const key = pipe(
				sites,
				Array.map(row => `${row.hostname} ${row.port}`),
				Array.join('\n')
			)
			const failure = yield* pipe(
				Ref.get(loaded),
				Effect.map(Option.match({onNone: () => Array.isReadonlyArrayNonEmpty(rows), onSome: last => last !== key})),
				Effect.flatMap(
					Boolean.match({
						onFalse: () => Effect.succeedNone,
						onTrue: () =>
							pipe(proxies.apply(sites), Effect.andThen(Ref.set(loaded, Option.some(key))), Effect.flip, Effect.option)
					})
				)
			)
			if (Option.isNone(failure)) {
				yield* pipe(
					rows,
					Array.filter(entry => entry.row.state === 'removing'),
					Effect.forEach(entry => asStorageDeployError(deleteRemoved(entry.row.name)), {concurrency: 1, discard: true})
				)
			}
			return Option.match(failure, {
				onNone: () => Record.empty<ExposureName, string>(),
				onSome: cause =>
					pipe(
						rows,
						Array.filter(entry => Option.isNone(entry.held)),
						Record.fromIterableWith(entry => [entry.row.name, cause.message] as const)
					)
			})
		})

		// Tailscale Serve maps each tailnet row to publish and drops Deploy's own mapping of the rest; a mapping changed outside Deploy is left alone. The status is read right before each row's command and the CLI has no conditional removal, so a change landing during that one command can still be overwritten.
		const reconcileTailnet = Effect.fnUntraced(function* (
			rows: readonly {held: Option.Option<string>; publish: boolean; row: Exposure}[]
		) {
			if (!Array.isReadonlyArrayNonEmpty(rows)) return Record.empty<ExposureName, string>()
			const outcomes = yield* Effect.forEach(
				rows,
				Effect.fnUntraced(function* (entry) {
					const current = yield* proxies.serveStatus
					const present = servesPort(current, entry.row.port)
					if (entry.publish && present && !ownsMapping(current, entry.row)) {
						return yield* DeployError.make({
							message: 'This Tailscale mapping was changed outside Deploy, so Deploy leaves it alone'
						})
					}
					if (entry.publish && !present) {
						yield* proxies.serve(entry.row.port)
						if (!ownsMapping(yield* proxies.serveStatus, entry.row)) {
							return yield* DeployError.make({message: 'Tailscale configured a different hostname or target'})
						}
					}
					if (!entry.publish && present && ownsMapping(current, entry.row)) yield* proxies.unserve(entry.row.port)
					if (entry.row.state === 'removing') yield* asStorageDeployError(deleteRemoved(entry.row.name))
				}, Effect.result),
				{concurrency: 1}
			)
			return Record.fromIterableWith(
				Array.getSomes(
					Array.zipWith(rows, outcomes, (entry, outcome) =>
						Option.map(Result.getFailure(outcome), cause => [entry.row.name, cause.message] as const)
					)
				),
				Function.identity
			)
		})

		// Makes the worker match the rows: active rows whose port still belongs to their owner are published, the rest are not, and a removal's row goes once nothing serves it.
		const reconciler = yield* makeReconciler(
			Semaphore.withPermit(
				passLock,
				Effect.withSpan(
					Effect.gen(function* () {
						const rows = yield* owned
						// Read after the rows, so a row saved just before this pass is judged on what listens once it was saved.
						yield* inventory.refresh
						const items = (yield* inventory.snapshot).items
						const decided = yield* Effect.forEach(
							rows,
							Effect.fnUntraced(function* (row) {
								if (row.state === 'removing') return {held: Option.none<string>(), publish: false, row}
								const found = yield* listener(items, row.port)
								// A row saved before Deploy recorded owners takes the owner it first finds.
								yield* Effect.forEach(
									Option.toArray(Option.filter(found.owner, () => Option.isNone(row.owner))),
									owner => asStorageDeployError(recordOwner({name: row.name, owner})),
									{concurrency: 1, discard: true}
								)
								const held = restoreRefusal(row, found)
								return {held, publish: Option.isNone(held), row}
							}),
							{concurrency: 'unbounded'}
						)
						const found = {
							...Record.fromIterableWith(
								Array.getSomes(
									Array.map(decided, entry => Option.map(entry.held, reason => [entry.row.name, reason] as const))
								),
								Function.identity
							),
							...(yield* reconcileCaddy(Array.filter(decided, entry => entry.row.kind === 'public'))),
							...(yield* reconcileTailnet(Array.filter(decided, entry => entry.row.kind === 'tailnet')))
						}
						yield* Ref.set(problems, found)
						if (!Record.isEmptyRecord(found)) {
							yield* Effect.logWarning('Owned exposures are not yet as saved; Deploy tries again', found)
						}
						return found
					}),
					'Exposures.reconcile',
					{attributes: {worker}}
				)
			),
			Record.isEmptyRecord
		)
		// Pending removals finish and saved exposures return before Deploy serves.
		yield* Effect.ignore(reconciler.request, {
			log: 'Warn',
			message: 'Could not reconcile owned exposures; inspect the Caddy service and the owned exposure records'
		})

		// Answers once the pass after a change finishes, failing with what kept `name` from its saved state.
		const settle = Effect.fnUntraced(function* (name: ExposureName, message: string) {
			yield* pipe(
				yield* reconciler.request,
				Record.get(name),
				Option.match({
					onNone: () => Effect.void,
					onSome: problem => DeployError.make({message: `${message}: ${problem}`})
				})
			)
		})

		return {
			// Each change takes the caller's admin capability, so no route reaches it on a declaration alone.
			expose: Effect.fn('Exposures.expose')(
				function* (input: ExposeInput, _admin: Admin) {
					yield* Effect.annotateCurrentSpan({exposure: input.name, kind: input.kind, port: input.port, worker})
					if (input.kind === 'public' && !input.publicAccess) {
						return yield* DeployError.make({message: 'Explicitly confirm public access before publishing a port'})
					}
					// Public exposure runs the bundled Caddy, a Linux x64 build.
					if (input.kind === 'public' && (platform !== 'linux' || arch !== 'x64')) {
						return yield* DeployError.make({
							message: 'Public exposure needs a Linux x64 worker; expose this port to the tailnet'
						})
					}
					yield* inventory.refresh
					const found = yield* listener((yield* inventory.snapshot).items, input.port)
					yield* Option.match(refusal(input, found), {
						onNone: () => Effect.void,
						onSome: message => DeployError.make({message})
					})
					// The owner is what a restore compares against, so a port nothing listens on is not published.
					if (Option.isNone(found.owner)) {
						return yield* DeployError.make({
							message: `Nothing listens on 127.0.0.1:${input.port}; start it before publishing it`
						})
					}
					const exposure = Exposure.make({...Struct.omit(input, ['publicAccess']), owner: found.owner, state: 'active'})
					const current = yield* owned
					yield* Option.match(ownedConflict(current, exposure), {
						onNone: () => Effect.void,
						onSome: message => DeployError.make({message})
					})
					if (exposure.kind === 'tailnet') {
						const status = yield* proxies.serveStatus
						if (
							servesPort(status, exposure.port) ||
							Option.exists(
								status.AllowFunnel,
								permissions => permissions[`${exposure.hostname}:${exposure.port}`] === true
							)
						) {
							return yield* DeployError.make({
								message: 'This Tailscale port or Funnel permission already exists and is not owned by Deploy'
							})
						}
						if (!Option.contains(yield* proxies.tailnetName, exposure.hostname)) {
							return yield* DeployError.make({
								message: 'Use this worker’s Tailscale DNS name; Deploy never publishes another worker’s hostname'
							})
						}
					} else {
						yield* proxies.validate([
							...Array.filter(current, row => row.kind === 'public' && row.state === 'active'),
							exposure
						])
					}
					// Ownership is saved before an external process changes, so an interrupted change stays inspectable and the next pass finishes it.
					yield* asStorageDeployError(insertExposure(exposure))
					yield* settle(exposure.name, 'The exposure is saved and Deploy keeps applying it')
					return exposureUrl(exposure)
				},
				Semaphore.withPermit(lock),
				asDeployError
			),
			hide: Effect.fn('Exposures.hide')(
				function* (name: ExposureName, _admin: Admin) {
					yield* Effect.annotateCurrentSpan({exposure: name, worker})
					const exposure = yield* pipe(
						yield* owned,
						Array.findFirst(row => row.name === name),
						Effect.fromOption,
						Effect.mapError(cause => DeployError.make({cause, message: 'Deploy does not own this exposure'}))
					)
					if (exposure.kind === 'tailnet' && exposure.state === 'active') {
						const status = yield* proxies.serveStatus
						if (servesPort(status, exposure.port) && !ownsMapping(status, exposure)) {
							return yield* DeployError.make({
								message: 'This mapping was changed outside Deploy; refusing to remove it'
							})
						}
					}
					// The intent is saved before anything external changes, and a saved removal is never published again.
					yield* Semaphore.withPermit(passLock, asStorageDeployError(markRemoving(name)))
					yield* settle(name, 'The removal is saved and Deploy finishes it on its own')
				},
				Semaphore.withPermit(lock),
				asDeployError
			),
			items: pipe(
				Effect.all({current: owned, failing: Ref.get(problems)}, {concurrency: 'unbounded'}),
				Effect.map(read =>
					Array.map(read.current, row => {
						const problem = Record.get(read.failing, row.name)
						return InventoryItem.make({
							detail: `${row.kind} → 127.0.0.1:${row.port}`,
							failure: Option.map(problem, reason => ({at: Option.none(), reason})),
							health: Boolean.match(Option.isSome(problem), {
								onFalse: Function.constant('quiet' as const),
								onTrue: Function.constant('warning' as const)
							}),
							id: ItemId.make(`${worker}:exposure:${row.name}`),
							kind: 'exposure',
							name: row.name,
							owned: Option.some(true),
							port: Option.some(row.port),
							publicAccess: Option.some(row.kind === 'public'),
							state: Boolean.match(row.state === 'removing', {
								onFalse: Function.constant('configured; check backend'),
								onTrue: Function.constant('removing')
							}),
							url: Option.some(exposureUrl(row)),
							worker
						})
					})
				),
				Effect.withSpan('Exposures.items', {attributes: {worker}})
			)
		}
	})
}) {
	// The table this service owns, made and changed at start in one transaction; one statement per `sql` call, since SQLite runs only the first statement of a string.
	static readonly migrations = Layer.effectDiscard(
		Migrator.make({})({loader: Migrator.fromRecord(migrations), table: 'exposures_migrations'})
	)

	static readonly layer = (directory: string) =>
		pipe(Layer.effect(this, this.make), Layer.provide(Proxies.layer(directory)), Layer.provide(this.migrations))
}
