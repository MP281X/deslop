import {Array, Cause, Effect, Option, Schema, Stream, pipe} from 'effect'

import {Atom, AtomRpc} from 'effect/reactivity'

import {isDenied, withoutDeniedData} from '@deslop/runtime/auth/utils'
import * as WebRuntime from '@deslop/runtime/web'

import {RpcContracts} from '#rpcs/contracts.ts'
import type {ExposeRequest, InventoryItem, RunRequest} from '#services/inventory/schema.ts'
import {HistoryQuery} from '#services/metrics/schema.ts'

class RpcClient extends AtomRpc.Service<RpcClient>()('@deslop/deploy/lib/utils/RpcClient', {
	group: RpcContracts,
	protocol: WebRuntime.layer('@deslop/deploy')
}) {}

// The port whose Expose dialog is open, from a click on its badge on the app's row.
export const exposeTargetAtom = Atom.make(Option.none<InventoryItem>())

export const inventoryAtom = Atom.keepAlive(
	RpcClient.runtime.atom(get =>
		withoutDeniedData(
			get,
			pipe(
				RpcClient,
				Effect.map(client => client('deploy.inventory', undefined)),
				Stream.unwrap,
				Stream.tapCause(cause =>
					Effect.sync(() => {
						if (Array.some(cause.reasons, reason => Cause.isFailReason(reason) && isDenied(reason.error))) {
							get.set(exposeTargetAtom, Option.none())
						}
					})
				)
			),
			WebRuntime.reconnecting
		)
	)
)

// A port exposed closes the dialog: its endpoint replaces the port's badge.
export const exposeAtom = RpcClient.runtime.fn((input: ExposeRequest, get) =>
	pipe(
		Effect.flatMap(RpcClient, client => client('deploy.expose', input)),
		Effect.tap(() => Effect.sync(() => get.set(exposeTargetAtom, Option.none())))
	)
)

// Removes an endpoint this app exposed, on its own worker when it is remote.
export const hideAtom = Atom.family((target: string) =>
	Atom.family((name: string) =>
		RpcClient.runtime.fn(() => Effect.flatMap(RpcClient, client => client('deploy.hide', {name, target})))
	)
)

// Starts a timer's job now; keyed by the job's row, so its failure shows there.
export const runAtom = Atom.family((_id: string) =>
	RpcClient.runtime.fn((input: RunRequest) => Effect.flatMap(RpcClient, client => client('deploy.run', input)))
)

// The page's view lives in the URL, so a reload, Back or a shared link reopens the same machine, app, pane and range.
const rangeParam = Atom.searchParam('range', {
	schema: pipe(HistoryQuery.fields.minutes, Schema.encodeTo(Schema.FiniteFromString))
})
export const machineParam = Atom.searchParam('machine')
export const appParam = Atom.searchParam('app')
// A phone shows one pane at a time; a wide screen shows all three and ignores it.
export const paneParam = Atom.searchParam('pane', {schema: Schema.Literals(['apps', 'machine', 'process'])})

export const minutesAtom = Atom.writable(
	get => Option.getOrElse(get(rangeParam), () => 60 as const),
	(ctx, minutes: HistoryQuery['minutes']) => ctx.set(rangeParam, Option.some(minutes))
)

// One reader retains the last range and its samples while a newer request connects.
export const metricsAtom = RpcClient.runtime.atom(get => {
	const minutes = get(minutesAtom)
	return withoutDeniedData(
		get,
		pipe(
			RpcClient,
			Effect.map(client => client('deploy.metrics', {minutes})),
			Stream.unwrap,
			Stream.map(histories => ({histories, minutes}))
		),
		WebRuntime.reconnecting
	)
})
