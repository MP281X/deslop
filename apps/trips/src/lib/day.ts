import {Array, DateTime, Duration, Function, Number, Option, Record, String, pipe} from 'effect'

import type {RowProblem} from '#lib/rows.tsx'
import {
	arrivalOf,
	byDeparture,
	changeOf,
	cityOf,
	clockAt,
	departureOf,
	feederOf,
	HOUR,
	isStale,
	journeyOf,
	legIndexOf,
	spanLabel,
	stepOf
} from '#services/flights/lib/utils.ts'
import type {Journey, Step} from '#services/flights/lib/utils.ts'
import type {Flight, FlightId, FlightList, TravelTime} from '#services/flights/schema.ts'
import {activityProps} from '#services/push/lib/utils.ts'

// "in 25 min", "in 1h 15m", or "in 3 days" from a day out.
function inSpan(span: Duration.Duration) {
	const hours = Duration.toHours(span)
	if (hours >= 24) {
		const days = Number.round(hours / 24, 0)
		if (days === 1) return 'in a day'
		return `in ${days} days`
	}
	return `in ${spanLabel(span)}`
}

// Flights not yet an hour past their landing, soonest first.
export function upcomingOf(flights: FlightList, now: DateTime.Utc) {
	return pipe(
		flights,
		Array.filter(flight => pipe(arrivalOf(flight), DateTime.addDuration(HOUR), DateTime.isGreaterThanOrEqualTo(now))),
		Array.sort(byDeparture)
	)
}

// Flights that landed in the last thirty days, latest first.
export function pastOf(flights: FlightList, now: DateTime.Utc) {
	return pipe(
		flights,
		Array.filter(
			flight =>
				pipe(arrivalOf(flight), DateTime.addDuration(HOUR), DateTime.isLessThan(now)) &&
				DateTime.isGreaterThan(arrivalOf(flight), DateTime.subtractDuration(now, Duration.days(30)))
		),
		Array.sort(byDeparture),
		Array.reverse
	)
}

// "Monday 23 November", the date the flight leaves on where it leaves.
function dateOf(flight: Flight) {
	return DateTime.format(departureOf(flight), {
		day: 'numeric',
		locale: 'en-GB',
		month: 'long',
		timeZone: flight.from.timeZone,
		weekday: 'long'
	})
}

// The change between two flights of a day.
export type Change = {feeder: Flight; next: Flight}

// The coming flights of each date in order; a connection follows the change to it, found among every flight saved so it keeps its row across a date and after the flight before it left the list, except the change `shown` already stands above the list.
export function datesOf(flights: FlightList, now: DateTime.Utc, shown: Option.Option<Change>) {
	return pipe(
		upcomingOf(flights, now),
		Array.groupBy(dateOf),
		Record.collect((date, rows) => ({
			date,
			rows: Array.map(rows, flight => ({
				feeder: Option.filter(
					feederOf(flight, flights),
					feeder => !Option.exists(shown, change => change.feeder.id === feeder.id && change.next.id === flight.id)
				),
				flight
			}))
		}))
	)
}

// The day of the next flight not yet an hour past its landing, from every flight saved, so a connection still has the flight before it.
function nextJourney(flights: FlightList, now: DateTime.Utc) {
	return pipe(
		upcomingOf(flights, now),
		Array.head,
		Option.flatMap(flight => journeyOf(flights, flight))
	)
}

// The flight under way or next, the one the board shows: the flight its day is at, so a landing hands the board to the connection.
export function boardOf(flights: FlightList, now: DateTime.Utc) {
	return Option.flatMap(nextJourney(flights, now), journey => Array.get(journey, legIndexOf(journey, now)))
}

// The change from the board's flight to the next of its day, which a laptop's board shows above the fold.
export function boardChangeOf(flights: FlightList, now: DateTime.Utc) {
	return Option.flatMap(nextJourney(flights, now), journey => {
		const index = legIndexOf(journey, now)
		return Option.map(
			Option.all({feeder: Array.get(journey, index), next: Array.get(journey, index + 1)}),
			found => found satisfies Change
		)
	})
}

// The flight a link opens: that one, or for the Live Activity's day link the flight the day is at.
export function openedFlight(flights: FlightList, target: {day: boolean; id: FlightId}, now: DateTime.Utc) {
	if (!target.day) return target.id
	return pipe(
		flights,
		Array.findFirst(flight => flight.id === target.id),
		Option.flatMap(flight => journeyOf(flights, flight)),
		Option.flatMap(journey => Array.get(journey, legIndexOf(journey, now))),
		Option.match({onNone: () => target.id, onSome: flight => flight.id})
	)
}

// The change from one flight to the next in words: "1h 15m to change", tight with what it was booked as.
export function changeWords(feeder: Flight, flight: Flight) {
	const change = changeOf(feeder, flight)
	return {
		label: `${spanLabel(change.now)} to change`,
		tight: change.tight,
		was: Option.liftPredicate(`was ${spanLabel(change.booked)}`, () => change.tight)
	}
}

// What the step's time large is counted to, in words: "in 25 min", "boards in 45 min", "at 15:02".
function timeLeft(props: ReturnType<typeof activityProps>, now: DateTime.Utc) {
	return Option.match(props.deadline, {
		onNone: () => `${String.toLowerCase(props.until)} ${props.untilValue}`,
		onSome: at => {
			const left = inSpan(DateTime.distance(now, at))
			if (props.phase === 'gate') return `boards ${left}`
			if (props.phase === 'boarding') return `departs ${left}`
			return left
		}
	})
}

// The next step large, as the Live Activity words it: "Airport by", "09:30", "in 50 min".
export function heroOf(journey: Journey, current: Step, now: DateTime.Utc, travel: readonly TravelTime[]) {
	const props = activityProps(journey, current, travel, isStale(current.flight, now))
	return {
		label: props.label,
		pending: props.pending,
		problem: Option.liftPredicate<RowProblem>('bad', () => props.phase === 'cancelled' || props.phase === 'diverted'),
		right: timeLeft(props, now),
		value: props.value,
		was: props.was
	} satisfies Hero
}

// A step said large: its label, its value with what it was struck through, and how long is left.
export type Hero = {
	label: string
	pending: boolean
	problem: Option.Option<RowProblem>
	right: string
	value: string
	was: Option.Option<string>
}

// The change to a connection still ahead, said large: "To change in London", "1h 15m", "was 2h 05m".
export function changeHero(feeder: Flight, flight: Flight) {
	const change = changeWords(feeder, flight)
	return {
		label: `To change in ${cityOf(feeder.to)}`,
		pending: false,
		problem: Option.liftPredicate<RowProblem>('warn', () => change.tight),
		right: Option.getOrElse(change.was, Function.constant('')),
		value: spanLabel(changeOf(feeder, flight).now),
		was: Option.none()
	} satisfies Hero
}

// The next step of the day the first coming flight belongs to, the whole day counted, so a connection never asks to leave for its airport.
export function nextHero(flights: FlightList, now: DateTime.Utc, travel: readonly TravelTime[]) {
	return Option.map(nextJourney(flights, now), journey => heroOf(journey, stepOf(journey, now, travel), now, travel))
}

// A time worth striking through: it moved five minutes or more from the one booked.
export function movedFrom(booked: DateTime.Utc, now: DateTime.Utc, timeZone: string) {
	return Option.liftPredicate(clockAt(booked, timeZone), () =>
		pipe(DateTime.distance(booked, now), Duration.abs, Duration.isGreaterThanOrEqualTo(Duration.minutes(5)))
	)
}

// The departure's time as it stands, with the booked time struck through once it moved.
export function departureTimes(flight: Flight) {
	return {
		value: Option.some(clockAt(departureOf(flight), flight.from.timeZone)),
		was: movedFrom(flight.departs, departureOf(flight), flight.from.timeZone)
	}
}
