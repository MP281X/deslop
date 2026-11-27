import {Array, DateTime, Duration, Function, Option, pipe} from 'effect'

import type {RowData} from '@deslop/design/model'

import type {Flight, FlightId, FlightList, TravelTime} from '#contracts'
import {
	airportByOf,
	arrivalClockOf,
	arrivalOf,
	boardsAt,
	cityOf,
	clockAt,
	departureOf,
	journeyOf,
	labelled,
	line,
	routeOf,
	stepOf,
	titleOf,
	travelTo,
	travellersLine
} from '#journey'

import {
	changeHero,
	changeWords,
	datesOf,
	departureTimes,
	heroOf,
	movedFrom,
	nextHero,
	pastOf,
	tripOf,
	troubleOf
} from '#screens/itinerary.ts'
import type {Hero, ListProblem} from '#screens/itinerary.ts'
import {travelLabel} from '#screens/travel.ts'

export type FlightRow = {
	readonly item: RowData
	readonly target: FlightId | undefined
	readonly was: string | undefined
}

function row(
	id: string,
	title: string,
	muted: string,
	value?: string,
	options?: {problem?: ListProblem | undefined; target?: FlightId | undefined; was?: string | undefined}
): FlightRow {
	return {
		item: {id, line: muted, problem: options?.problem, title, trailing: value},
		target: options?.target,
		was: options?.was
	}
}

function bookedRow(flight: Flight, now: DateTime.Utc) {
	const times = departureTimes(flight)
	const date = DateTime.format(departureOf(flight), {
		day: 'numeric',
		locale: 'en-GB',
		month: 'short',
		timeZone: flight.from.timeZone
	})
	const today = DateTime.format(now, {day: 'numeric', locale: 'en-GB', month: 'short', timeZone: flight.from.timeZone})
	return row(
		flight.id,
		routeOf(flight),
		line([
			Option.some(titleOf(flight)),
			labelled(
				'gate',
				Option.flatMap(flight.live, live => live.departureGate)
			),
			Option.some(date === today ? `lands ${arrivalClockOf(flight)}` : date)
		]),
		Option.getOrUndefined(times.value),
		{problem: Option.getOrUndefined(troubleOf(flight, now)), target: flight.id, was: Option.getOrUndefined(times.was)}
	)
}

function changeRow(feeder: Flight, flight: Flight) {
	const change = changeWords(feeder, flight)
	const reason = Option.getOrUndefined(change.was)
	return row(`${flight.id}-change`, change.label, '', undefined, {
		problem: reason === undefined ? undefined : {reason, status: 'warning'}
	})
}

export type Itinerary = ReturnType<typeof itinerary>
export const PAST = 'past'

export function itinerary(flights: FlightList, now: DateTime.Utc, travel: readonly TravelTime[], pastOpen: boolean) {
	const trip = tripOf(flights, now)
	const past = pastOf(flights, now)
	function dates(omit: FlightList) {
		return Array.map(datesOf(flights, now, omit), group => ({
			date: group.date,
			rows: Array.flatMap(group.rows, ({feeder, flight}) => [
				...Option.toArray(Option.map(feeder, from => changeRow(from, flight))),
				bookedRow(flight, now)
			])
		}))
	}
	const compact = dates([])
	const timeline = [
		...Array.map(trip.dates, group => ({
			date: group.date,
			rows: Array.map(group.steps, step =>
				row(step.key, step.title, Option.getOrElse(step.line, Function.constant('')), step.time, {
					problem: Option.getOrUndefined(step.problem),
					target: step.flight.id,
					was: Option.getOrUndefined(step.was)
				})
			)
		})),
		...dates(trip.flights)
	]
	const first = Option.getOrUndefined(Array.head(trip.flights))
	return {
		airport: first !== undefined && dayAt(first, flights, now, travel).toAirport ? airportByRow(first) : undefined,
		compact,
		hero: Option.getOrUndefined(nextHero(flights, now, travel)),
		past: Array.isReadonlyArrayEmpty(past)
			? undefined
			: row(PAST, 'Past flights', past.length === 1 ? '1 flight' : `${past.length} flights`),
		pastOpen,
		pastRows: pastOpen ? Array.map(past, flight => bookedRow(flight, now)) : [],
		timeline
	}
}

function airportByRow(flight: Flight) {
	return row(
		'airport-by',
		'At the airport by',
		'An hour before departure',
		clockAt(airportByOf(flight), flight.from.timeZone)
	)
}

export function dayAt(flight: Flight, flights: FlightList, now: DateTime.Utc, travel: readonly TravelTime[]) {
	const journey = Option.getOrElse(journeyOf(flights, flight), () => [flight] as const)
	const index = Option.getOrElse(
		Array.findFirstIndex(journey, item => item.id === flight.id),
		Function.constant(0)
	)
	const current = stepOf(journey, now, travel)
	const feeder = Option.getOrUndefined(Array.get(journey, index - 1))
	function nextStep(): Hero {
		if (feeder !== undefined && index > current.index) return changeHero(feeder, flight)
		if (index >= current.index) return heroOf(journey, current, now, travel)
		return {
			label: 'Landed in',
			pending: false,
			problem: Option.none(),
			right: `at ${arrivalClockOf(flight)}`,
			value: cityOf(flight.to),
			was: Option.none()
		}
	}
	return {
		hero: nextStep(),
		next: Option.getOrUndefined(Array.get(journey, index + 1)),
		toAirport: index === 0 && current.index === 0 && (current.phase === 'leave' || current.phase === 'airport')
	}
}

export type BoardingPass = ReturnType<typeof boardingPass>

export function boardingPass(flight: Flight, flights: FlightList, now: DateTime.Utc, travel: readonly TravelTime[]) {
	const day = dayAt(flight, flights, now, travel)
	const gate = labelled(
		'gate',
		Option.flatMap(flight.live, live => live.departureGate)
	)
	const terminal = labelled(
		'Terminal',
		Option.flatMap(flight.live, live => live.departureTerminal)
	)
	const seats = labelled(
		'seat',
		travellersLine(flight, traveller => traveller.seat)
	)
	const groups = labelled(
		'group',
		travellersLine(flight, traveller => traveller.boardingGroup)
	)
	const boarded = Option.flatMap(flight.boardingAt, booked => movedFrom(booked, boardsAt(flight), flight.from.timeZone))
	const drive = travelTo(flight, travel)
	const late = pipe(
		flight.live,
		Option.flatMap(live => live.inboundDelay),
		Option.map(Duration.toMinutes),
		Option.filter(minutes => minutes >= 15 && day.toAirport)
	)
	const problem = troubleOf(flight, now)
	const times = departureTimes(flight)
	const next = day.next
	const travellers = Array.flatMap(flight.travellers, (traveller, index) => {
		const detail = line([labelled('Group', traveller.boardingGroup), traveller.confirmation])
		if (
			flight.travellers.length === 1 &&
			Option.isNone(traveller.name) &&
			detail === '' &&
			traveller.status !== 'cancelled'
		) {
			return []
		}
		return [
			row(
				`traveller-${index}`,
				Option.getOrElse(traveller.name, Function.constant('Traveller')),
				detail,
				Option.getOrUndefined(traveller.seat),
				{
					problem:
						traveller.status === 'cancelled'
							? {
									reason: line([Option.some('Cancelled'), Option.liftPredicate(detail, text => text !== '')]),
									status: 'error'
								}
							: undefined
				}
			)
		]
	})
	return {
		context: `${titleOf(flight)} · ${routeOf(flight)}`,
		hero: day.hero,
		note: Option.getOrUndefined(
			pipe(
				drive,
				Option.filter(() => day.toAirport),
				Option.map(minutes => `${flight.from.name} in ${travelLabel(Duration.toMinutes(minutes))} by car`)
			)
		),
		rows: [
			row(
				'boards',
				'Boarding',
				line([terminal, gate, seats, groups]),
				clockAt(boardsAt(flight), flight.from.timeZone),
				{was: Option.getOrUndefined(boarded)}
			),
			row('departs', 'Departs', flight.from.name, Option.getOrUndefined(times.value), {
				was: Option.getOrUndefined(times.was)
			}),
			row('lands', 'Lands', flight.to.name, arrivalClockOf(flight), {
				was: Option.getOrUndefined(movedFrom(flight.arrives, arrivalOf(flight), flight.to.timeZone))
			}),
			...Array.getSomes([
				Option.liftPredicate(airportByRow(flight), () => day.toAirport),
				Option.map(problem, issue => row('flight-problem', titleOf(flight), '', undefined, {problem: issue})),
				Option.map(late, minutes =>
					row('inbound', 'Inbound flight', '', undefined, {
						problem: {reason: `Plane flying in ${minutes} min late`, status: 'warning'}
					})
				)
			]),
			...Array.getSomes([
				Option.map(Option.fromUndefinedOr(next), to => {
					const change = changeWords(flight, to)
					const target = `${titleOf(to)} to ${cityOf(to.to)}`
					return row('connection', change.label, target, clockAt(departureOf(to), to.from.timeZone), {
						problem: change.tight ? {reason: line([Option.some(target), change.was]), status: 'warning'} : undefined,
						target: to.id
					})
				})
			])
		],
		travellers
	}
}
