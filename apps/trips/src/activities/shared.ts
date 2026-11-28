import {Array, Boolean, DateTime, Duration, Function, Option, String, pipe} from 'effect'

import {ActivityProps} from './contract.ts'

import type {Flight, TravelTime} from '#flights/contract.ts'
import {
	airportByOf,
	arrivalOf,
	arrivalClockOf,
	boardsAt,
	changeOf,
	cancelledOf,
	cityOf,
	clockAt,
	delayOf,
	departureOf,
	labelled,
	leaveByOf,
	line,
	routeOf,
	spanLabel,
	titleOf,
	travelTo,
	travellersLine
} from '#flights/shared.ts'
import type {Journey, Step} from '#flights/shared.ts'

// The change to the next flight while it is tight, in words: "1h 15m to change in London".
function changeLine(journey: Journey, index: number) {
	return pipe(
		Option.all({feeder: Array.get(journey, index), next: Array.get(journey, index + 1)}),
		Option.filter(found => changeOf(found.feeder, found.next).tight && !cancelledOf(found.next)),
		Option.map(found => {
			const change = changeOf(found.feeder, found.next).now
			if (Duration.isLessThanOrEqualTo(change, Duration.zero)) {
				return `${titleOf(found.next)} may leave before ${titleOf(found.feeder)} lands`
			}
			return `${spanLabel(change)} to change in ${cityOf(found.feeder.to)}`
		})
	)
}

// A delay of a quarter of an hour or more, with its cause when the plane flying in is as late.
function delayLine(flight: Flight) {
	return pipe(
		flight.live,
		Option.flatMap(live => live.inboundDelay),
		Option.map(Duration.toMinutes),
		Option.filter(late => late >= 15),
		Option.match({
			onNone: () => `${delayOf(flight)} min late`,
			onSome: late => `${delayOf(flight)} min late: the plane flying in is ${late} min late`
		}),
		Option.liftPredicate(() => delayOf(flight) >= 15 && Option.isSome(flight.live))
	)
}

// The zones differ at that moment, so a clock in the destination's zone says so.
function otherZone(flight: Flight) {
	return (
		DateTime.zonedOffset(DateTime.makeZonedUnsafe(arrivalOf(flight), {timeZone: flight.from.timeZone})) !==
		DateTime.zonedOffset(DateTime.makeZonedUnsafe(arrivalOf(flight), {timeZone: flight.to.timeZone}))
	)
}

// Who flies and where they sit, by first name: "Matteo 14C · Anna 14D", or the seats alone for a ticket without names.
function seatsLine(flight: Flight) {
	return pipe(
		flight.travellers,
		Array.map(traveller =>
			Option.map(
				Option.all({name: traveller.name, seat: traveller.seat}),
				found => `${Array.headNonEmpty(String.split(found.name, ' '))} ${found.seat}`
			)
		),
		Array.getSomes,
		Array.match({
			onEmpty: () =>
				labelled(
					'Seats',
					travellersLine(flight, traveller => traveller.seat)
				),
			onNonEmpty: seats => Option.some(Array.join(seats, ' · '))
		})
	)
}

const QUIET = {gate: Option.none(), noteWas: Option.none(), pending: false, untilValue: '', was: Option.none()}

function departsNote(flight: Flight) {
	const late = delayOf(flight) >= 5
	return {
		note: `Departs ${clockAt(departureOf(flight), flight.from.timeZone)}`,
		noteTone: Boolean.match(late, {
			onFalse: Function.constant('plain' as const),
			onTrue: Function.constant('warn' as const)
		}),
		noteWas: Option.liftPredicate(clockAt(flight.departs, flight.from.timeZone), () => late)
	}
}

function gateOf(flight: Flight) {
	return Option.flatMap(flight.live, live => live.departureGate)
}

// The gate it left, struck through beside the gate it moved to.
function movedFrom(flight: Flight) {
	return pipe(
		flight.live,
		Option.flatMap(live => live.previousGate),
		Option.filter(() => Option.isSome(gateOf(flight)))
	)
}

function homeWords(flight: Flight, leave: boolean, travel: readonly TravelTime[]) {
	return {
		...QUIET,
		...departsNote(flight),
		label: Boolean.match(leave, {onFalse: Function.constant('Airport by'), onTrue: Function.constant('Leave by')}),
		small: `${titleOf(flight)} · ${routeOf(flight)}`,
		symbol: 'car.fill' as const,
		until: 'Time left',
		value: clockAt(
			pipe(
				leaveByOf(flight, travel),
				Option.filter(() => leave),
				Option.getOrElse(() => airportByOf(flight))
			),
			flight.from.timeZone
		)
	}
}

// The gate, or for a connection the gate of the flight he changes to, with the route since it is a new flight; its number is in the label then. The seats follow bare, so the line fits beside the departure in the Duo's island.
function gateWords(flight: Flight, connection: boolean) {
	const seats = travellersLine(flight, traveller => traveller.seat)
	return {
		...QUIET,
		...departsNote(flight),
		gate: gateOf(flight),
		label: Boolean.match(connection, {onFalse: Function.constant('Gate'), onTrue: () => `Gate for ${titleOf(flight)}`}),
		pending: Option.isNone(gateOf(flight)),
		small: line([
			Option.some(Boolean.match(connection, {onFalse: () => titleOf(flight), onTrue: () => routeOf(flight)})),
			seats
		]),
		symbol: 'airplane.departure' as const,
		until: `Boards ${clockAt(boardsAt(flight), flight.from.timeZone)}`,
		value: Option.getOrElse(gateOf(flight), Function.constant('Not yet')),
		was: movedFrom(flight)
	}
}

function boardingWords(flight: Flight) {
	return {
		...QUIET,
		gate: gateOf(flight),
		label: Option.match(gateOf(flight), {
			onNone: Function.constant('Boarding'),
			onSome: Function.constant('Boarding at gate')
		}),
		note: `Lands ${arrivalClockOf(flight)}`,
		noteTone: 'plain' as const,
		small: line([Option.some(titleOf(flight)), seatsLine(flight)]),
		symbol: 'airplane.departure' as const,
		until: `Departs ${clockAt(departureOf(flight), flight.from.timeZone)}`,
		value: Option.getOrElse(gateOf(flight), Function.constant('Now')),
		was: movedFrom(flight)
	}
}

// Away from the gate, waiting to take off: when it left, and when it lands.
function taxiWords(flight: Flight) {
	return {
		...QUIET,
		label: 'Left the gate at',
		note: '',
		noteTone: 'plain' as const,
		small: line([Option.some(titleOf(flight)), seatsLine(flight)]),
		symbol: 'airplane.departure' as const,
		until: 'Lands',
		untilValue: arrivalClockOf(flight),
		value: clockAt(departureOf(flight), flight.from.timeZone)
	}
}

// The landing in the destination's clock; landing in another zone the small print says so in place of the route, since the label fits the Duo's island only on one line.
function airborneWords(flight: Flight, next: Option.Option<Flight>) {
	return {
		...QUIET,
		label: `Lands in ${cityOf(flight.to)}`,
		note: Option.match(next, {
			onNone: () => `Departed ${clockAt(departureOf(flight), flight.from.timeZone)}`,
			onSome: found => `${titleOf(found)} at ${clockAt(departureOf(found), found.from.timeZone)}`
		}),
		noteTone: 'plain' as const,
		small: Boolean.match(otherZone(flight), {
			onFalse: () => `${titleOf(flight)} · ${routeOf(flight)}`,
			onTrue: () => `${titleOf(flight)} · ${cityOf(flight.to)} time`
		}),
		symbol: 'airplane' as const,
		until: 'Time left',
		value: arrivalClockOf(flight)
	}
}

function landedWords(flight: Flight) {
	return {
		...QUIET,
		label: 'Landed in',
		note: '',
		noteTone: 'plain' as const,
		small: `${titleOf(flight)} · ${routeOf(flight)}`,
		symbol: 'airplane.arrival' as const,
		until: 'At',
		untilValue: arrivalClockOf(flight),
		value: cityOf(flight.to)
	}
}

function stoppedWords(flight: Flight, cancelled: boolean) {
	return {
		...QUIET,
		label: titleOf(flight),
		note: '',
		noteTone: 'plain' as const,
		small: routeOf(flight),
		symbol: 'exclamationmark.triangle.fill' as const,
		until: Boolean.match(cancelled, {
			onFalse: Function.constant('Was to land'),
			onTrue: Function.constant('Was to depart')
		}),
		untilValue: Boolean.match(cancelled, {
			onFalse: () => clockAt(flight.arrives, flight.to.timeZone),
			onTrue: () => clockAt(flight.departs, flight.from.timeZone)
		}),
		value: Boolean.match(cancelled, {onFalse: Function.constant('Diverted'), onTrue: Function.constant('Cancelled')})
	}
}

function wordsOf(journey: Journey, current: Step, travel: readonly TravelTime[]) {
	if (current.phase === 'leave' || current.phase === 'airport') {
		return homeWords(current.flight, current.phase === 'leave', travel)
	}
	if (current.phase === 'gate') return gateWords(current.flight, current.index > 0)
	if (current.phase === 'boarding') return boardingWords(current.flight)
	if (current.phase === 'taxiing') return taxiWords(current.flight)
	if (current.phase === 'airborne') return airborneWords(current.flight, Array.get(journey, current.index + 1))
	if (current.phase === 'landed') return landedWords(current.flight)
	return stoppedWords(current.flight, current.phase === 'cancelled')
}

// An old answer says when it was read, so it never reads as the current gate; on the way to the airport a delay leads, after it a tight change.
function problemOf(journey: Journey, current: Step, stale: boolean) {
	if (current.phase === 'landed' || current.phase === 'cancelled' || current.phase === 'diverted') {
		return Option.none<string>()
	}
	const late = Option.filter(delayLine(current.flight), () => current.phase === 'leave' || current.phase === 'airport')
	return pipe(
		current.flight.live,
		Option.filter(() => stale),
		Option.map(live => `Updated ${clockAt(live.checkedAt, current.flight.from.timeZone)}`),
		Option.orElse(() => late),
		Option.orElse(() => changeLine(journey, current.index))
	)
}

function toneOf(current: Step, problem: Option.Option<string>) {
	if (current.phase === 'cancelled' || current.phase === 'diverted') return 'bad'
	if (Option.isSome(problem)) return 'warn'
	return 'plain'
}

// What the day's activity shows at `current`, worded for the widget.
export function activityProps(journey: Journey, current: Step, travel: readonly TravelTime[], stale: boolean) {
	const problem = problemOf(journey, current, stale)
	return ActivityProps.make({
		...wordsOf(journey, current, travel),
		deadline: current.deadline,
		delay: Duration.minutes(delayOf(current.flight)),
		phase: current.phase,
		problem,
		segment: current.segment,
		segmentSince: current.segmentSince,
		segmentUntil: current.segmentUntil,
		since: current.since,
		tone: toneOf(current, problem)
	})
}

export function islandOf(flight: Flight, props: ActivityProps, travel: readonly TravelTime[], stale: boolean) {
	const boards = clockAt(boardsAt(flight), flight.from.timeZone)
	if (props.phase === 'leave' || props.phase === 'airport') {
		const airport = Option.getOrElse(flight.from.code, () => flight.from.name)
		const heading = Boolean.match(props.phase === 'leave', {
			onFalse: () => `${airport} by`,
			onTrue: () => `Leave for ${airport} by`
		})
		return {
			...Option.match(travelTo(flight, travel), {
				onNone: () => ({}),
				onSome: time => ({detail: `${spanLabel(time)} by car`})
			}),
			footer: `${titleOf(flight)} · boards ${boards}`,
			title: `${heading} ${props.value}`,
			value: props.value,
			warning: false
		}
	}
	if (props.phase !== 'gate' && props.phase !== 'boarding') return undefined

	const gate = Option.filter(props.gate, () => !stale)
	const changed = Option.filter(gate, () => Option.isSome(props.was))
	const route = Option.all({from: flight.from.code, to: flight.to.code})
	const seats = labelled(
		'seat',
		travellersLine(flight, traveller => traveller.seat)
	)
	return {
		detail: `Boards ${boards}`,
		footer: line([Option.filter(labelled('Gate', gate), () => Option.isNone(changed)), seats]),
		title: Option.match(changed, {
			onNone: () => line([Option.some(titleOf(flight)), Option.map(route, place => `${place.from} → ${place.to}`)]),
			onSome: moved => `Gate changed to ${moved}`
		}),
		value: Option.getOrElse(gate, () => boards),
		warning: Option.isSome(changed)
	}
}
