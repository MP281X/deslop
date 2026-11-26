import {
	Array,
	Boolean,
	DateTime,
	Duration,
	Function,
	HashSet,
	Number,
	Option,
	Record,
	Schema,
	String,
	pipe
} from 'effect'

import {
	arrivalClockOf,
	arrivalOf,
	boardsAt,
	byDeparture,
	cancelledOf,
	changeOf,
	cityOf,
	clockAt,
	departureOf,
	feederOf,
	HOUR,
	isStale,
	journeyOf,
	labelled,
	legIndexOf,
	line,
	spanLabel,
	stepOf,
	titleOf,
	travellersLine
} from '#services/flights/lib/utils.ts'
import type {Journey, Step} from '#services/flights/lib/utils.ts'
import type {Flight, FlightId, FlightList, TravelTime} from '#services/flights/schema.ts'
import {activityProps} from '#services/push/lib/utils.ts'

const HERO_PROBLEMS = {error: 'bad', warning: 'warn'} satisfies Record.ReadonlyRecord<ProblemStatus, RowProblem>

export type RowProblem = typeof RowProblem.Type
const RowProblem = Schema.Literals(['bad', 'warn'])
export type ProblemStatus = typeof ProblemStatus.Type
const ProblemStatus = Schema.Literals(['error', 'warning'])
export type ListProblem = {reason: string; status: ProblemStatus}

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
function upcomingOf(flights: FlightList, now: DateTime.Utc) {
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

// The coming flights of each date in order, leaving out the flights of `trip`; a connection follows the change to it, found among every flight saved so it keeps its row across a date and after the flight before it left the list.
export function datesOf(flights: FlightList, now: DateTime.Utc, trip: readonly Flight[]) {
	const held = HashSet.fromIterable(Array.map(trip, flight => flight.id))
	return pipe(
		upcomingOf(flights, now),
		Array.filter(flight => !HashSet.has(held, flight.id)),
		Array.groupBy(dateOf),
		Record.collect((date, rows) => ({
			date,
			rows: Array.map(rows, flight => ({feeder: feederOf(flight, flights), flight}))
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

// The change from the board's flight to the next of its day, which a laptop's board stands for above the fold.
function boardChangeOf(flights: FlightList, now: DateTime.Utc) {
	return Option.flatMap(nextJourney(flights, now), journey => {
		const index = legIndexOf(journey, now)
		return Option.all({feeder: Array.get(journey, index), next: Array.get(journey, index + 1)})
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

// Only a problem marks a row: a cancellation, a diversion, or live data that stopped updating, said as its reason.
export function troubleOf(flight: Flight, now: DateTime.Utc) {
	if (cancelledOf(flight)) return Option.some<ListProblem>({reason: 'Cancelled', status: 'error'})
	return Option.flatMap(flight.live, live => {
		if (live.state === 'diverted') return Option.some<ListProblem>({reason: 'Diverted', status: 'error'})
		return Option.liftPredicate<ListProblem>(
			{reason: `Updated ${clockAt(live.checkedAt, flight.from.timeZone)}`, status: 'warning'},
			() => isStale(flight, now)
		)
	})
}

// The plane flying in, while it is the cause of a delay and boarding has not begun.
function inboundOf(flight: Flight, now: DateTime.Utc) {
	return pipe(
		flight.live,
		Option.flatMap(live => live.inboundDelay),
		Option.map(Duration.toMinutes),
		Option.filter(late => late >= 15 && DateTime.isLessThan(now, boardsAt(flight))),
		Option.map(late => ({reason: `Plane flying in ${late} min late`, status: 'warning'}) satisfies ListProblem)
	)
}

// A step of a trip as a row: what happens and when, its muted line as stored, and the flight it opens. At the gate its `gate` and `brief` lead above a laptop's fold, where the line is the same without the gate.
type TripStep = {
	at: DateTime.Utc
	brief: Option.Option<string>
	date: string
	flight: Flight
	gate: Option.Option<string>
	key: string
	line: Option.Option<string>
	problem: Option.Option<ListProblem>
	time: string
	title: string
	was: Option.Option<string>
}

function wordsOrNone(parts: Option.Option<string>[]) {
	return pipe(line(parts), String.capitalize, Option.liftPredicate(String.isNonEmpty))
}

// A flight's boarding, departure and landing, with the change to the flight after it on its landing.
function stepsOfFlight(flight: Flight, next: Option.Option<Flight>, now: DateTime.Utc) {
	const date = dateOf(flight)
	const terminal = labelled(
		'Terminal',
		Option.flatMap(flight.live, live => live.departureTerminal)
	)
	const gate = Option.flatMap(flight.live, live => live.departureGate)
	const seat = labelled(
		'seat',
		travellersLine(flight, traveller => traveller.seat)
	)
	const group = labelled(
		'group',
		travellersLine(flight, traveller => traveller.boardingGroup)
	)
	const change = Option.map(next, found => ({
		...changeWords(flight, found),
		terminal: labelled(
			'Terminal',
			Option.flatMap(found.live, live => live.departureTerminal)
		)
	}))
	return [
		{
			at: boardsAt(flight),
			brief: wordsOrNone([terminal, seat, group]),
			date,
			flight,
			gate,
			key: `${flight.id} boards`,
			line: wordsOrNone([terminal, labelled('gate', gate), seat, group]),
			problem: Option.none<ListProblem>(),
			time: clockAt(boardsAt(flight), flight.from.timeZone),
			title: `${titleOf(flight)} boards`,
			was: Option.flatMap(flight.boardingAt, booked => movedFrom(booked, boardsAt(flight), flight.from.timeZone))
		},
		{
			at: departureOf(flight),
			brief: Option.none<string>(),
			date,
			flight,
			gate: Option.none<string>(),
			key: `${flight.id} departs`,
			line: Option.flatMap(flight.live, live => live.aircraft),
			problem: Option.orElse(troubleOf(flight, now), () => inboundOf(flight, now)),
			time: clockAt(departureOf(flight), flight.from.timeZone),
			title: `${titleOf(flight)} departs ${cityOf(flight.from)}`,
			was: movedFrom(flight.departs, departureOf(flight), flight.from.timeZone)
		},
		{
			at: arrivalOf(flight),
			brief: Option.none<string>(),
			date,
			flight,
			gate: Option.none<string>(),
			key: `${flight.id} lands`,
			line: Option.flatMap(change, found => wordsOrNone([found.terminal, Option.some(found.label)])),
			problem: Option.flatMap(change, found =>
				Option.liftPredicate<ListProblem>(
					{reason: line([found.terminal, Option.some(found.label), found.was]), status: 'warning'},
					() => found.tight
				)
			),
			time: arrivalClockOf(flight),
			title: `Lands in ${cityOf(flight.to)}`,
			was: movedFrom(flight.arrives, arrivalOf(flight), flight.to.timeZone)
		}
	] satisfies TripStep[]
}

// The steps of the day the first coming flight belongs to, boarding, departing and landing for each flight still ahead, in order under the date each leaves on.
export function tripOf(flights: FlightList, now: DateTime.Utc) {
	const coming = HashSet.fromIterable(Array.map(upcomingOf(flights, now), flight => flight.id))
	const journey = Option.getOrElse(nextJourney(flights, now), Array.empty<Flight>)
	const trip = Array.flatMap(journey, (flight, index) =>
		pipe(
			coming,
			HashSet.has(flight.id),
			Boolean.match({
				onFalse: Array.empty<TripStep>,
				onTrue: () => stepsOfFlight(flight, Array.get(journey, index + 1), now)
			})
		)
	)
	return {
		dates: pipe(
			trip,
			Array.groupBy(step => step.date),
			Record.collect((date, steps) => ({date, steps}))
		),
		flights: pipe(
			trip,
			Array.map(step => step.flight),
			Array.dedupeWith((left, right) => left.id === right.id)
		)
	}
}

// The next step said large with its small print under it.
export type NextBoard = {hero: Hero; line: Option.Option<string>}

// The next step above a laptop's fold in place of the change: its label large, its time with the gate for boarding, and its small print under it. Only a trip with a change to come has one.
export function nextBoardOf(flights: FlightList, now: DateTime.Utc) {
	if (Option.isNone(boardChangeOf(flights, now))) return Option.none<NextBoard>()
	const steps = Array.flatMap(tripOf(flights, now).dates, date => date.steps)
	return pipe(
		Array.findFirst(steps, step => DateTime.isGreaterThanOrEqualTo(step.at, now)),
		Option.orElse(() => Array.last(steps)),
		Option.map(
			step =>
				({
					hero: {
						label: step.title,
						pending: false,
						problem: Option.map(step.problem, found => HERO_PROBLEMS[found.status]),
						right: pipe(
							step.at,
							Option.liftPredicate(at => DateTime.isGreaterThan(at, now)),
							Option.match({onNone: Function.constant(''), onSome: at => inSpan(DateTime.distance(now, at))})
						),
						value: Option.match(step.gate, {onNone: () => step.time, onSome: gate => `${gate} · ${step.time}`}),
						was: step.was
					},
					line: pipe(
						step.problem,
						Option.map(found => found.reason),
						Option.orElse(() => step.brief)
					)
				}) satisfies NextBoard
		)
	)
}
