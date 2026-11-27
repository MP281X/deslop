import {Array, Effect, Option, Redacted, Schema, Stream, pipe} from 'effect'

import {AsyncResult, Atom, AtomRegistry, AtomRpc} from 'effect/reactivity'

import {isDeniedCause, keepValueThroughOutages, reconnectOnDrop} from '@deslop/runtime/client/live-stream'
import {writeOutcome} from '@deslop/runtime/client/protocol'
import {registerPushToken} from '@deslop/runtime/client/push'
import {ApnsToken} from '@deslop/runtime/shared/apns'
import type {Device} from '@deslop/runtime/shared/apns'
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

export type PushPhone = typeof PushPhone.Type
export const PushPhone = Schema.Struct({bundle: PushBundle, phone: PhoneId})
export type PushSource = {
	readonly alerts: Stream.Stream<string, FlightsError>
	readonly device: Effect.Effect<PushPhone, FlightsError | Schema.SchemaError>
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

	const ownerAtom = Atom.map(options.account, result =>
		Option.getOrUndefined(Option.map(AsyncResult.value(result), user => user.id))
	)
	const flightsByOwnerAtoms = Atom.family((account: UserId) =>
		Client.runtime.atom(get => {
			const live = pipe(
				Client.use(call => Effect.succeed(call('flights.events', undefined))),
				Stream.unwrap,
				Stream.scan(Array.empty<Flight>, reduce),
				Stream.drop(1)
			)
			const cache = options.cache
			if (cache === undefined) return keepValueThroughOutages(get, live, reconnectOnDrop)
			return Stream.concat(
				pipe(
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
				),
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
	const flightsAtom = Atom.make(get => {
		const account = get(ownerAtom)
		if (account === undefined) return AsyncResult.initial<readonly Flight[], unknown>()
		return get(flightsByOwnerAtoms(account))
	})
	const travelAtom = Client.runtime.atom(get => {
		if (get(ownerAtom) === undefined) return Effect.never
		return Client.use(call => call('travel.list', undefined))
	})
	const pushAtom = Client.runtime.atom(get => {
		const source = options.push
		if (source === undefined || get(ownerAtom) === undefined) return Effect.void
		return Effect.ignore(
			Effect.gen(function* () {
				const phone = yield* source.device
				const call = yield* Client
				function register(stream: PushSource['alerts'], kind: Device['kind']) {
					return pipe(
						stream,
						Stream.changes,
						Stream.switchMap(value =>
							Stream.fromEffectDrain(
								Effect.flatMap(Schema.decodeEffect(ApnsToken)(value), token =>
									registerPushToken(call('push.register', {...phone, kind, token: Redacted.make(token)}))
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
		const account = registry.get(ownerAtom)
		if (account !== undefined) registry.refresh(flightsByOwnerAtoms(account))
		registry.refresh(travelAtom)
	}
	function write<E>(registry: AtomRegistry.AtomRegistry, effect: Effect.Effect<void, E, Client>) {
		return pipe(
			registry,
			AtomRegistry.getResult(Client.runtime, {suspendOnWaiting: true}),
			Effect.flatMap(context => writeOutcome(Effect.provideContext(effect, context)))
		)
	}
	return {
		accountAtom: options.account,
		flightsAtom,
		ownerAtom,
		pushAtom,
		refresh,
		save: (registry: AtomRegistry.AtomRegistry, ticket: TicketSource) =>
			write(
				registry,
				Client.use(call => call('flights.save', ticket))
			),
		setTravel: (registry: AtomRegistry.AtomRegistry, row: TravelTime) =>
			write(
				registry,
				Client.use(call => call('travel.set', row))
			),
		travelAtom
	}
}

export type TripsData = ReturnType<typeof tripsData>
