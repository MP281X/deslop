import {Array, Effect, Option, Schema, Stream, pipe} from 'effect'

import type {AtomRegistry} from 'effect/reactivity'
import {AsyncResult, Atom} from 'effect/reactivity'

import {isDeniedCause, keepValueThroughOutages, liveStream, reconnectOnDrop} from '@deslop/runtime/client/live-stream'
import {UserId} from '@deslop/runtime/shared/auth'
import {listReducer} from '@deslop/runtime/shared/list'

import {accountAtom, FLIGHTS_KEY, native, RpcClient} from '#lib/session.ts'
import {byDeparture} from '#services/flights/lib/utils.ts'
import {Flight, FlightsError, TravelTime} from '#services/flights/schema.ts'

const apply = listReducer(byDeparture, flight => flight.id)
type Cached = typeof Cached.Type
const Cached = Schema.fromJsonString(Schema.Struct({account: UserId, flights: Schema.Array(Flight.json)}))
export const ownerAtom = Atom.map(accountAtom, result =>
	Option.getOrUndefined(Option.map(AsyncResult.value(result), account => account.id))
)

const flightsByOwnerAtoms = Atom.family((account: UserId) =>
	RpcClient.runtime.atom(get => {
		const live = pipe(liveStream(RpcClient, 'flights.events'), Stream.scan(Array.empty<Flight>, apply), Stream.drop(1))
		const store = Stream.tap(live, flights =>
			pipe(
				Schema.encodeEffect(Cached)({account, flights}),
				Effect.flatMap(copy =>
					Effect.try({
						catch: cause => FlightsError.make({cause, message: 'The offline board could not be written.'}),
						try: () => localStorage.setItem(FLIGHTS_KEY, copy)
					})
				),
				Effect.ignore({log: 'Warn', message: 'The offline board could not be saved'})
			)
		)
		const hydrate = Stream.suspend(() =>
			pipe(
				Option.fromNullishOr(localStorage.getItem(FLIGHTS_KEY)),
				Option.flatMap(Schema.decodeOption(Cached)),
				Option.filter(copy => copy.account === account),
				Option.map(copy => copy.flights),
				Option.toArray,
				Stream.fromIterable
			)
		)
		if (!native) return keepValueThroughOutages(get, live, reconnectOnDrop)
		return Stream.concat(
			hydrate,
			keepValueThroughOutages(
				get,
				Stream.tapCause(store, cause =>
					Effect.sync(() => {
						if (isDeniedCause(cause)) localStorage.removeItem(FLIGHTS_KEY)
					})
				),
				reconnectOnDrop
			)
		)
	})
)

export const flightsAtom = Atom.make(get => {
	const account = get(ownerAtom)
	if (account === undefined) return AsyncResult.initial<readonly Flight[], unknown>()
	return get(flightsByOwnerAtoms(account))
})

export const travelAtom = RpcClient.runtime.atom(get => {
	if (get(ownerAtom) === undefined) return Effect.never
	return Effect.flatMap(RpcClient, call => call('travel.list', undefined))
})

type TravelList = typeof TravelList.Type
export const TravelList = Schema.Array(TravelTime)

export function refreshFlights(registry: AtomRegistry.AtomRegistry) {
	const account = registry.get(ownerAtom)
	if (account !== undefined) registry.refresh(flightsByOwnerAtoms(account))
}
