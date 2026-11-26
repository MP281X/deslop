import type {Html} from '@effect/ui/html'

import type {DateTime} from 'effect'
import {Array, Duration, Function, Number, Option, String, pipe} from 'effect'

import {Glass} from '@deslop/ui/glass'

import {changeHero, changeWords, departureTimes, heroOf, movedFrom, troubleOf} from '#lib/day.ts'
import type {Hero} from '#lib/day.ts'
import {directionsTo, rideTo} from '#lib/rides.ts'
import {TRAVEL_CHOICES, travelLabel} from '#lib/travel.ts'
import {Message} from '#routes/(home)/-model.ts'
import {
	airportByOf,
	arrivalClockOf,
	arrivalOf,
	boardsAt,
	bookedOf,
	cityOf,
	clockAt,
	departureOf,
	journeyOf,
	labelled,
	line,
	stepOf,
	titleOf,
	travelTo,
	travellersLine
} from '#services/flights/lib/utils.ts'
import type {Journey} from '#services/flights/lib/utils.ts'
import {TravelTime} from '#services/flights/schema.ts'
import type {Flight, FlightList, Place} from '#services/flights/schema.ts'

export type H = Html.H<Message>

function Time(h: H, value?: string, was?: string) {
	return h.span.class('axis-value').children(was !== undefined && h.s.children(was), value)
}

export function Row(
	h: H,
	row: {
		line?: string
		problem?: Option.Option<string>
		title: string
		value?: Option.Option<string>
		was?: Option.Option<string>
	}
) {
	return [
		h.div
			.class('trips-copy')
			.children(
				h.div
					.class('axis-title')
					.children(Option.isSome(row.problem ?? Option.none()) && h.span.class('axis-dot'), row.title),
				h.div.class('axis-muted').children(Option.getOrUndefined(row.problem ?? Option.none()) ?? row.line)
			),
		Time(h, Option.getOrUndefined(row.value ?? Option.none()), Option.getOrUndefined(row.was ?? Option.none()))
	]
}

export function NextStep(h: H, hero: Hero, sub?: string) {
	return h.div
		.class('trips-next')
		.children(
			h.div
				.class('axis-title')
				.children(
					Option.isSome(hero.problem) && h.span.class('axis-dot'),
					hero.label,
					' ',
					h.span
						.attr('data-pending', Option.getOrUndefined(Option.liftPredicate('', () => hero.pending)))
						.children(hero.value),
					Option.getOrUndefined(Option.map(hero.was, was => h.s.children(was)))
				),
			h.div
				.class('axis-muted')
				.children(line([Option.liftPredicate(hero.right, String.isNonEmpty), Option.fromUndefinedOr(sub)]))
		)
}

function Airport(h: H, place: Place) {
	return h.div.children(
		h.div.children(Option.getOrElse(place.code, () => cityOf(place))),
		h.span.class('axis-muted').children(place.name)
	)
}

function field(label: string, value: string, was?: string) {
	return {label, value, was}
}

function Ticket(h: H, flight: Flight) {
	const departs = departureTimes(flight)
	const gate = Option.flatMap(flight.live, live => live.departureGate)
	const terminal = Option.flatMap(flight.live, live => live.departureTerminal)
	const boards = clockAt(boardsAt(flight), flight.from.timeZone)
	const boarded = Option.flatMap(flight.boardingAt, booked => movedFrom(booked, boardsAt(flight), flight.from.timeZone))
	const seats = travellersLine(flight, traveller => traveller.seat)
	const groups = travellersLine(flight, traveller => traveller.boardingGroup)
	const values = [
		field('Flight', titleOf(flight)),
		field('Gate', Option.getOrElse(gate, Function.constant('—'))),
		field('Boarding', boards, Option.getOrUndefined(boarded)),
		field('Seat', Option.getOrElse(seats, Function.constant('—'))),
		field('Departs', Option.getOrElse(departs.value, Function.constant('—')), Option.getOrUndefined(departs.was)),
		field(
			'Lands',
			arrivalClockOf(flight),
			Option.getOrUndefined(movedFrom(flight.arrives, arrivalOf(flight), flight.to.timeZone))
		),
		...Option.toArray(Option.map(terminal, value => field('Terminal', value))),
		...Option.toArray(Option.map(groups, value => field('Group', value)))
	]
	return [
		h.div
			.class('trips-route')
			.children(Airport(h, flight.from), h.span.attr('aria-hidden', 'true').children('→'), Airport(h, flight.to)),
		h.dl
			.class('trips-ticket')
			.children(
				Array.map(values, item =>
					h.div
						.key(item.label)
						.children(h.dt.class('axis-muted').children(item.label), h.dd.children(Time(h, item.value, item.was)))
				)
			)
	]
}

function Connection(h: H, from: Flight, to: Flight) {
	const change = changeWords(from, to)
	return h.a
		.class('axis-row')
		.attr('href', `/flight/${to.id}`)
		.on('click', () => Message.Select({id: to.id}), {preventDefault: true})
		.children(
			Row(h, {
				line: line([
					labelled(
						'Gate',
						Option.flatMap(to.live, live => live.departureGate)
					),
					Option.some('connection')
				]),
				problem: Option.liftPredicate(line([Option.some(change.label), change.was]), () => change.tight),
				title: `Then ${titleOf(to)} to ${cityOf(to.to)}`,
				value: Option.some(clockAt(departureOf(to), to.from.timeZone))
			})
		)
}

function Travellers(h: H, flight: Flight) {
	// A single seat is already printed on the pass; keep each distinct booking's detail with it.
	return Array.flatMap(flight.travellers, (traveller, index) => {
		const detail = line([
			Option.liftPredicate('Cancelled', () => traveller.status === 'cancelled'),
			labelled('Group', traveller.boardingGroup),
			traveller.confirmation
		])
		if (flight.travellers.length === 1 && Option.isNone(traveller.name) && String.isEmpty(detail)) return []
		return [
			h.div
				.key(`${index}`)
				.class('axis-row')
				.children(
					Row(h, {
						line: detail,
						title: Option.getOrElse(traveller.name, Function.constant('Traveller')),
						value: Option.filter(traveller.seat, () => traveller.status === 'confirmed'),
						was: Option.filter(traveller.seat, () => traveller.status === 'cancelled')
					})
				)
		]
	})
}

export function dayAt(flight: Flight, flights: FlightList, now: DateTime.Utc, travel: readonly TravelTime[]) {
	const journey = Option.getOrElse(journeyOf(flights, flight), () => Array.of(flight) satisfies Journey)
	const index = pipe(
		journey,
		Array.findFirstIndex(item => item.id === flight.id),
		Option.getOrElse(Function.constant(0))
	)
	const current = stepOf(journey, now, travel)
	return {
		hero: Option.match(
			pipe(
				journey,
				Array.get(index - 1),
				Option.filter(() => index > current.index)
			),
			{
				onNone: () => {
					if (index >= current.index) return heroOf(journey, current, now, travel)
					return {
						label: 'Landed in',
						pending: false,
						problem: Option.none(),
						right: `at ${arrivalClockOf(flight)}`,
						value: cityOf(flight.to),
						was: Option.none()
					} satisfies Hero
				},
				onSome: feeder => changeHero(feeder, flight)
			}
		),
		next: Array.get(journey, index + 1),
		toAirport: index === 0 && current.index === 0 && (current.phase === 'leave' || current.phase === 'airport')
	}
}

function Travel(h: H, flight: Flight, saved: Option.Option<Duration.Duration>, pending: boolean) {
	return Option.map(flight.from.code, airport =>
		h.label.class('trips-travel').children(
			h.span.class('axis-muted').children(`Time to ${cityOf(flight.from)} airport`),
			h.select
				.attr('disabled', Option.getOrUndefined(Option.liftPredicate('', () => pending)))
				.value(Option.match(saved, {onNone: Function.constant(''), onSome: value => `${Duration.toMinutes(value)}`}))
				.on('change', event =>
					Option.getOrUndefined(
						Option.map(Number.parse(event.value), minutes =>
							Message.TripTime({row: TravelTime.make({airport, minutes})})
						)
					)
				)
				.children(
					Option.isNone(saved) && h.option.attr('value', '').attr('disabled', '').children('Set time'),
					pipe(
						Array.dedupe([...TRAVEL_CHOICES, ...Option.toArray(Option.map(saved, Duration.toMinutes))]),
						Array.sort(Number.Order),
						Array.map(minutes => h.option.key(`${minutes}`).attr('value', `${minutes}`).children(travelLabel(minutes)))
					)
				)
		)
	)
}

export function Board(
	h: H,
	flight: Flight,
	flights: FlightList,
	now: DateTime.Utc,
	travel: readonly TravelTime[],
	pending: boolean
) {
	const day = dayAt(flight, flights, now, travel)
	const drive = travelTo(flight, travel)
	const ride = rideTo(flight.from)
	const trouble = troubleOf(flight, now)
	const late = pipe(
		flight.live,
		Option.flatMap(live => live.inboundDelay),
		Option.map(Duration.toMinutes),
		Option.filter(minutes => minutes >= 15 && day.toAirport),
		Option.map(minutes => `Plane flying in ${minutes} min late`)
	)
	return [
		h.div.class('trips-board').children(
			NextStep(
				h,
				day.hero,
				pipe(
					drive,
					Option.filter(() => day.toAirport),
					Option.map(minutes => `${flight.from.name} in ${travelLabel(Duration.toMinutes(minutes))} by car`),
					Option.getOrUndefined
				)
			),
			Ticket(h, flight)
		),
		Option.getOrUndefined(Option.map(day.next, next => Connection(h, flight, next))),
		Option.getOrUndefined(
			Option.map(trouble, issue =>
				h.div.class('axis-row').children(Row(h, {problem: Option.some(issue.reason), title: titleOf(flight)}))
			)
		),
		Option.getOrUndefined(
			Option.map(late, reason =>
				h.div.class('axis-row').children(Row(h, {problem: Option.some(reason), title: 'Inbound flight'}))
			)
		),
		Travellers(h, flight),
		day.toAirport && Option.getOrUndefined(Travel(h, flight, drive, pending)),
		day.toAirport &&
			bookedOf(flight) &&
			h.div
				.class('trips-dock')
				.children(
					Glass(h).children(
						h.a.class('trips-control').attr('href', directionsTo(flight.from)).children('Directions'),
						Option.getOrUndefined(
							Option.map(ride, url => h.a.class('trips-control').attr('href', url).children('Ride'))
						)
					)
				)
	]
}

export function AirportBy(h: H, flight: Flight) {
	return h.div
		.class('axis-row')
		.children(
			Row(h, {
				line: 'An hour before departure',
				title: 'At the airport by',
				value: Option.some(clockAt(airportByOf(flight), flight.from.timeZone))
			})
		)
}
