import {Array, DateTime, Effect, MutableHashSet, Number, Option, pipe} from 'effect'

import {AsyncResult, Atom} from 'effect/reactivity'
import {Alert} from 'react-native'

import {alertFailure} from '@deslop/components-mobile/lib/alerts'
import {provideRuntimeOnce} from '@deslop/runtime/mobile/session'

import {flightsAtom, nowAtom} from '#lib/flights.ts'
import {RpcClient} from '#lib/session.ts'
import {airportByOf, cancelledOf, travelTo} from '#services/flights/lib/utils.ts'
import type {PlaceCode, TravelMinutes, TravelTime} from '#services/flights/schema.ts'
import {feederOf} from '#services/push/lib/utils.ts'

// The trips offered for the way to an airport, in minutes.
export const TRAVEL_CHOICES: readonly TravelMinutes[] = [30, 45, 60, 90, 120, 150, 180]

export function travelLabel(minutes: number) {
	const hours = Math.floor(minutes / 60)
	const rest = Number.remainder(minutes, 60)
	if (hours === 0) return `${rest} min`
	if (rest === 0) return `${hours} h`
	return `${hours} h ${rest} min`
}

export const travelAtom = RpcClient.runtime.atom(Effect.flatMap(RpcClient, client => client('travel.list', undefined)))

export const setTravelAtom = Atom.fn((row: TravelTime, get) =>
	pipe(
		provideRuntimeOnce(
			get,
			RpcClient.runtime,
			Effect.flatMap(RpcClient, client => client('travel.set', row))
		),
		Effect.andThen(Effect.sync(() => get.refresh(travelAtom))),
		alertFailure('Not Saved')
	)
)

// Airports already asked about since launch, so Not Now waits for the next launch.
const asked = MutableHashSet.empty<PlaceCode>()

// The first time a coming flight leaves from an airport with no saved trip, a system alert asks for it, since when to leave hangs on it; a flight he connects to is no trip from home.
export const travelPromptAtom = Atom.make(get => {
	const now = get(nowAtom)
	pipe(
		Option.all({flights: AsyncResult.value(get(flightsAtom)), travel: AsyncResult.value(get(travelAtom))}),
		Option.flatMap(known =>
			Array.findFirst(known.flights, flight =>
				pipe(
					flight.from.code,
					Option.filter(
						code =>
							!MutableHashSet.has(asked, code) &&
							!cancelledOf(flight) &&
							Option.isNone(feederOf(flight, known.flights)) &&
							DateTime.isLessThan(now, airportByOf(flight)) &&
							Option.isNone(travelTo(flight, known.travel))
					),
					Option.map(code => ({code, flight}))
				)
			)
		),
		Option.map(found => {
			MutableHashSet.add(asked, found.code)
			Alert.alert(
				`How long does it take to get to ${Option.getOrElse(found.flight.from.city, () => found.flight.from.name)} airport?`,
				`Trips tells you when to leave for flights from ${found.code}: an hour before departure at the airport, less this trip.`,
				[
					...Array.map(TRAVEL_CHOICES, minutes => ({
						onPress: () => get.registry.set(setTravelAtom, {airport: found.code, minutes}),
						text: travelLabel(minutes)
					})),
					{style: 'cancel', text: 'Not Now'}
				]
			)
		})
	)
})
