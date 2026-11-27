import {Array, Effect, Option, Redacted, Schema, Stream, pipe} from 'effect'

import {AsyncResult, Atom, AtomRpc} from 'effect/reactivity'
import type {AtomRegistry} from 'effect/reactivity'

import {isDeniedCause, keepValueThroughOutages, reconnectOnDrop} from '@deslop/runtime/client/live-stream'
import {registerPushToken} from '@deslop/runtime/client/push'
import {ApnsToken} from '@deslop/runtime/shared/apns'
import {UserId} from '@deslop/runtime/shared/auth'
import type {AuthError} from '@deslop/runtime/shared/auth'
import {listReducer} from '@deslop/runtime/shared/list'
import {RpcStream} from '@deslop/runtime/shared/rpc'
import type {Account} from '@deslop/runtime/shared/schema'
import type {layerPageProtocol} from '@deslop/runtime/web/client'

import {Flight, PhoneId, PushBundle, TripsRpcs} from '#contracts'
import type {FlightsError, TicketSource, TravelTime} from '#contracts'
import {byDeparture} from '#journey'

type Cached = typeof Cached.Type
const Cached = Schema.fromJsonString(Schema.Struct({account: UserId, flights: Schema.Array(Flight.json)}))
const reduce = listReducer(byDeparture, flight => flight.id)

export type BoardCache = {
	readonly clear: Effect.Effect<void>
	readonly read: Effect.Effect<Option.Option<string>>
	readonly write: (text: string) => Effect.Effect<void>
}

export const PushPhone = Schema.Struct({bundle: PushBundle, phone: PhoneId})
export type PushSource = {
	readonly alerts: Stream.Stream<string, FlightsError>
	readonly device: Effect.Effect<typeof PushPhone.Type, FlightsError | Schema.SchemaError>
	readonly starts: Stream.Stream<string, FlightsError>
}

export type DataOptions = {
	readonly account: Atom.Atom<AsyncResult.AsyncResult<Account, AuthError>>
	readonly cache?: BoardCache
	readonly protocol: typeof layerPageProtocol
	readonly push?: PushSource
	readonly refreshAccount: (registry: AtomRegistry.AtomRegistry) => void
}

export function tripsData(options: DataOptions) {
	class Client extends AtomRpc.Service<Client>()('Trips/RpcClient', {
		group: TripsRpcs.middleware(RpcStream),
		protocol: options.protocol
	}) {}

	const owner = Atom.map(options.account, result =>
		Option.getOrUndefined(Option.map(AsyncResult.value(result), user => user.id))
	)
	const byOwner = Atom.family((account: UserId) =>
		Client.runtime.atom(get => {
			const live = pipe(
				Client.use(call => Effect.succeed(call('flights.events', undefined))),
				Stream.unwrap,
				Stream.scan(Array.empty<Flight>, reduce),
				Stream.drop(1)
			)
			const cache = options.cache
			if (cache === undefined) return keepValueThroughOutages(get, live, reconnectOnDrop)
			const saved = pipe(
				cache.read,
				Effect.map(text =>
					pipe(
						text,
						Option.flatMap(Schema.decodeOption(Cached)),
						Option.filter(copy => copy.account === account),
						Option.map(copy => copy.flights),
						Option.toArray
					)
				),
				Stream.fromEffect,
				Stream.flattenIterable
			)
			return Stream.concat(
				saved,
				keepValueThroughOutages(
					get,
					pipe(
						live,
						Stream.tap(flights =>
							pipe(
								Schema.encodeEffect(Cached)({account, flights}),
								Effect.flatMap(cache.write),
								Effect.ignore({log: 'Warn', message: 'The offline board could not be saved'})
							)
						),
						Stream.tapCause(cause => {
							if (isDeniedCause(cause)) return cache.clear
							return Effect.void
						})
					),
					reconnectOnDrop
				)
			)
		})
	)
	const flights = Atom.make(get => {
		const account = get(owner)
		if (account === undefined) return AsyncResult.initial<readonly Flight[], unknown>()
		return get(byOwner(account))
	})
	const travel = Client.runtime.atom(get => {
		if (get(owner) === undefined) return Effect.never
		return Client.use(call => call('travel.list', undefined))
	})
	const push = Client.runtime.atom(get => {
		const source = options.push
		if (source === undefined || get(owner) === undefined) return Effect.void
		return Effect.ignore(
			Effect.gen(function* () {
				const phone = yield* source.device
				const call = yield* Client
				function register(stream: PushSource['alerts'], kind: 'alert' | 'start') {
					return pipe(
						stream,
						Stream.changes,
						Stream.switchMap(value =>
							Stream.fromEffectDrain(
								pipe(
									Schema.decodeEffect(ApnsToken)(value),
									Effect.flatMap(token =>
										registerPushToken(call('push.register', {...phone, kind, token: Redacted.make(token)}))
									)
								)
							)
						),
						Stream.runDrain,
						Effect.ignore({log: 'Warn', message: `The ${kind} token could not be read`})
					)
				}
				yield* Effect.all([register(source.alerts, 'alert'), register(source.starts, 'start')], {
					concurrency: 'unbounded',
					discard: true
				})
			}),
			{log: 'Warn', message: 'Trips could not register this iPhone'}
		)
	})
	function refresh(registry: AtomRegistry.AtomRegistry, accountOnly: boolean) {
		options.refreshAccount(registry)
		if (accountOnly) return
		const account = registry.get(owner)
		if (account !== undefined) registry.refresh(byOwner(account))
		registry.refresh(travel)
	}
	return {
		account: options.account,
		flights,
		owner,
		push,
		refresh,
		runtime: Client.runtime,
		save: (ticket: TicketSource) => Client.use(call => call('flights.save', ticket)),
		setTravel: (row: TravelTime) => Client.use(call => call('travel.set', row)),
		travel
	}
}

export type TripsData = ReturnType<typeof tripsData>
