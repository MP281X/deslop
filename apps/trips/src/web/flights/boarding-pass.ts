import type {Html} from '@effect/ui/html'

import {Array, Boolean, Duration, Function, Number, Option, String, pipe} from 'effect'
import type {DateTime} from 'effect'

import type {ShellMenuGroup} from '@deslop/ui/app-shell'
import {Loading, Row, RowContent} from '@deslop/ui/axis'
import {Button, PopoverPanel} from '@deslop/ui/control'
import {SymbolIcon} from '@deslop/ui/symbol'

import {TravelTime} from '#contracts'
import type {Flight, FlightList, Place} from '#contracts'
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
} from '#journey'
import type {Journey} from '#journey'

import {directionsTo, rideTo} from '#web/flights/directions.ts'
import {changeHero, changeWords, departureTimes, heroOf, movedFrom, troubleOf} from '#web/flights/itinerary.ts'
import type {Hero} from '#web/flights/itinerary.ts'
import {Message} from '#web/flights/model.ts'
import {TRAVEL_CHOICES, travelLabel} from '#web/flights/travel.ts'

function Time(h: Html.H<Message>, value?: string, was?: string) {
	return h.span.class('axis-value').children(was !== undefined && h.s.children(was), value)
}

export function BoardSkeleton(h: Html.H<Message>) {
	return Loading(h, 'Loading boarding pass', h.div.class('trips-skeleton-board').attr('aria-hidden', 'true'))
}

export function NextStep(h: Html.H<Message>, hero: Hero, sub?: string) {
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

function Airport(h: Html.H<Message>, place: Place) {
	return h.div.children(
		h.div.children(Option.getOrElse(place.code, () => cityOf(place))),
		h.span.class('axis-muted').children(place.name)
	)
}

function field(label: string, value: string, was?: string) {
	return {label, value, was}
}

function Ticket(h: Html.H<Message>, flight: Flight) {
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

function Connection(h: Html.H<Message>, from: Flight, to: Flight) {
	const change = changeWords(from, to)
	return Row(h, {
		current: false,
		id: to.id,
		line: Boolean.match(change.tight, {
			onFalse: () =>
				line([
					labelled(
						'Gate',
						Option.flatMap(to.live, live => live.departureGate)
					),
					Option.some('connection')
				]),
			onTrue: () => line([Option.some(change.label), change.was])
		}),
		open: Message.Select({id: to.id}),
		problem: change.tight,
		title: `Then ${titleOf(to)} to ${cityOf(to.to)}`,
		value: clockAt(departureOf(to), to.from.timeZone)
	})
}

function Travellers(h: Html.H<Message>, flight: Flight) {
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
					RowContent(h, {
						line: detail,
						problem: traveller.status === 'cancelled',
						title: Option.getOrElse(traveller.name, Function.constant('Traveller')),
						value: Option.getOrUndefined(
							Option.map(traveller.seat, seat =>
								Boolean.match(traveller.status === 'cancelled', {onFalse: () => seat, onTrue: () => h.s.children(seat)})
							)
						)
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

export function AirportOptions(flight: Flight, travel: readonly TravelTime[], pending: boolean) {
	const saved = Option.map(travelTo(flight, travel), Duration.toMinutes)
	const groups = Option.toArray(
		Option.map(
			flight.from.code,
			airport =>
				({
					items: pipe(
						Array.dedupe([...TRAVEL_CHOICES, ...Option.toArray(saved)]),
						Array.sort(Number.Order),
						Array.map(minutes => ({
							checked: Option.contains(saved, minutes),
							disabled: pending,
							id: `airport-${minutes}`,
							message: Message.TripTime({row: TravelTime.make({airport, minutes})}),
							title: travelLabel(minutes)
						}))
					),
					title: `Time to ${cityOf(flight.from)} airport`
				}) satisfies ShellMenuGroup<Message>
		)
	)
	if (bookedOf(flight)) {
		return Array.append(groups, {
			items: [
				{id: 'directions', message: Message.OpenUrl({url: directionsTo(flight.from)}), title: 'Directions'},
				...Option.toArray(
					Option.map(rideTo(flight.from), url => ({id: 'ride', message: Message.OpenUrl({url}), title: 'Ride'}))
				)
			],
			title: ''
		})
	}
	return groups
}

export function AirportMenu(h: Html.H<Message>, groups: readonly ShellMenuGroup<Message>[], open: boolean) {
	return PopoverPanel(
		h,
		'trips-airport',
		'Airport travel',
		Array.map(groups, group =>
			h.div
				.key(group.title)
				.attrs({'aria-label': group.title || undefined, role: 'group'})
				.children(
					group.title !== '' && h.span.class('trips-menu-label').children(group.title),
					Array.map(group.items, item =>
						Button(h, {disabled: item.disabled ?? false})
							.key(item.id)
							.attrs({
								'aria-checked': Option.getOrUndefined(
									Option.map(Option.fromUndefinedOr(item.checked), checked => `${checked}`)
								),
								role: Boolean.match(item.checked === undefined, {
									onFalse: Function.constant('menuitemradio'),
									onTrue: Function.constant('menuitem')
								})
							})
							.on('click', item.message)
							.children(item.title, item.checked === true && SymbolIcon(h, 'checkmark'))
					)
				)
		)
	)
		.attrs({role: 'menu', style: 'position-anchor: --axis-action-airport'})
		.popover('auto', open)
		.on('toggle', event => {
			if (!event.open) return Message.Airport({open: false})
			return undefined
		})
}

export function Board(
	h: Html.H<Message>,
	flight: Flight,
	flights: FlightList,
	now: DateTime.Utc,
	travel: readonly TravelTime[]
) {
	const day = dayAt(flight, flights, now, travel)
	const drive = travelTo(flight, travel)
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
				h.div.class('axis-row').children(RowContent(h, {line: issue.reason, problem: true, title: titleOf(flight)}))
			)
		),
		Option.getOrUndefined(
			Option.map(late, reason =>
				h.div.class('axis-row').children(RowContent(h, {line: reason, problem: true, title: 'Inbound flight'}))
			)
		),
		...Travellers(h, flight)
	]
}

export function AirportBy(h: Html.H<Message>, flight: Flight) {
	return h.div
		.class('axis-row')
		.children(
			RowContent(h, {
				line: 'An hour before departure',
				title: 'At the airport by',
				value: clockAt(airportByOf(flight), flight.from.timeZone)
			})
		)
}
