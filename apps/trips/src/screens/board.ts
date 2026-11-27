import {Array, Boolean, DateTime, Duration, Function, Option, pipe} from 'effect'

import type {RowData, RowOptions, Selection} from '@deslop/design/model'

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
import type {Hero} from '#screens/itinerary.ts'
import {travelLabel} from '#screens/travel.ts'

export type FlightRow = ReturnType<typeof row>

function row(
	id: string,
	title: string,
	muted: string,
	value?: string,
	options?: {problem?: RowData['problem']; target?: FlightId; was?: RowData['trailing']}
) {
	return {
		item: {id, line: muted, problem: options?.problem, title, trailing: value} satisfies RowData,
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
			Option.some(Boolean.match(date === today, {onFalse: () => date, onTrue: () => `lands ${arrivalClockOf(flight)}`}))
		]),
		Option.getOrUndefined(times.value),
		{problem: Option.getOrUndefined(troubleOf(flight, now)), target: flight.id, was: Option.getOrUndefined(times.was)}
	)
}

function changeRow(feeder: Flight, flight: Flight) {
	const change = changeWords(feeder, flight)

	return row(`${flight.id}-change`, change.label, '', undefined, {
		problem: Option.getOrUndefined(Option.map(change.was, reason => ({reason, status: 'warning' as const})))
	})
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
	const index = pipe(
		journey,
		Array.findFirstIndex(item => item.id === flight.id),
		Option.getOrElse(Function.constant(0))
	)
	const current = stepOf(journey, now, travel)
	const feeder = Option.getOrUndefined(Array.get(journey, index - 1))
	function nextStep() {
		if (feeder !== undefined && index > current.index) return changeHero(feeder, flight)
		if (index >= current.index) return heroOf(journey, current, now, travel)
		return {
			label: 'Landed in',
			pending: false,
			problem: Option.none(),
			right: `at ${arrivalClockOf(flight)}`,
			value: cityOf(flight.to),
			was: Option.none()
		} satisfies Hero
	}
	return {
		hero: nextStep(),
		next: Option.getOrUndefined(Array.get(journey, index + 1)),
		toAirport: index === 0 && current.index === 0 && (current.phase === 'leave' || current.phase === 'airport')
	}
}

export type Itinerary = ReturnType<typeof itinerary>
export const PAST = 'past'

export function itinerary(flights: FlightList, now: DateTime.Utc, travel: readonly TravelTime[], pastOpen: boolean) {
	const trip = tripOf(flights, now)
	const past = pastOf(flights, now)
	function dates(omit: FlightList) {
		return Array.map(datesOf(flights, now, omit), group => ({
			date: group.date,
			rows: Array.flatMap(group.rows, groupRow => [
				...Option.toArray(Option.map(groupRow.feeder, from => changeRow(from, groupRow.flight))),
				bookedRow(groupRow.flight, now)
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
	return {
		airport: Option.getOrUndefined(
			pipe(
				Array.head(trip.flights),
				Option.filter(flight => dayAt(flight, flights, now, travel).toAirport),
				Option.map(airportByRow)
			)
		),
		compact,
		hero: Option.getOrUndefined(nextHero(flights, now, travel)),
		past: Boolean.match(Array.isReadonlyArrayEmpty(past), {
			onFalse: () =>
				row(
					PAST,
					'Past flights',
					Boolean.match(past.length === 1, {
						onFalse: () => `${past.length} flights`,
						onTrue: Function.constant('1 flight')
					})
				),
			onTrue: Function.constUndefined
		}),
		pastOpen,
		pastRows: Boolean.match(pastOpen, {
			onFalse: Array.empty<FlightRow>,
			onTrue: () => Array.map(past, flight => bookedRow(flight, now))
		}),
		timeline
	}
}

export type BoardingPass = ReturnType<typeof boardingPass>

export function flightRowOptions<Content>(
	flight: FlightRow,
	select: Selection['select'],
	activeId: Selection['id'],
	time: (was: string, current?: string) => Content
) {
	const target = flight.target
	return {
		active: target !== undefined && target === activeId,
		item: flight.item,
		...(target !== undefined && {select: (el, event) => select(el, event, target)}),
		trailing: Option.getOrUndefined(
			Option.map(Option.fromUndefinedOr(flight.was), previous => time(previous, flight.item.trailing))
		)
	} satisfies RowOptions<Content>
}

export function itineraryContent<Content>(
	list: Itinerary,
	wide: boolean,
	activeId: Selection['id'],
	draw: {
		row: (item: FlightRow, activeId?: string) => Content
		group: (date: string, hero: Itinerary['hero'], rows: readonly Content[]) => Content
		empty: () => Content
		past: (item: FlightRow) => Content
	}
) {
	const groups = Boolean.match(wide, {onFalse: () => list.compact, onTrue: () => list.timeline})
	return [
		Array.isReadonlyArrayEmpty(list.compact) && draw.empty(),
		Array.map(groups, (group, index) =>
			draw.group(
				group.date,
				Boolean.match(!wide && index === 0, {onFalse: Function.constUndefined, onTrue: () => list.hero}),
				Array.map(group.rows, item => draw.row(item, activeId))
			)
		),
		list.airport !== undefined && draw.row(list.airport),
		list.past !== undefined && draw.past(list.past),
		Array.map(list.pastRows, item => draw.row(item, activeId))
	] as const
}

export function boardingSections<Content, Section>(
	pass: BoardingPass,
	renderRow: (item: FlightRow) => Content,
	information: (rows: readonly Content[]) => Section,
	travellers: (title: string, rows: readonly Content[]) => Section
) {
	return [
		information(Array.map(pass.rows, renderRow)),
		Array.isReadonlyArrayNonEmpty(pass.travellers) && travellers('Travellers', Array.map(pass.travellers, renderRow))
	] as const
}

export function heroStatus(hero: Hero) {
	return Option.getOrUndefined(
		Option.map(hero.problem, problem =>
			Boolean.match(problem === 'bad', {
				onFalse: Function.constant('warning' as const),
				onTrue: Function.constant('error' as const)
			})
		)
	)
}

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
					problem: Boolean.match(traveller.status === 'cancelled', {
						onFalse: Function.constUndefined,
						onTrue: () => ({
							reason: line([Option.some('Cancelled'), Option.liftPredicate(detail, text => text !== '')]),
							status: 'error' as const
						})
					})
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
				Option.map(Option.fromUndefinedOr(day.next), to => {
					const change = changeWords(flight, to)
					const target = `${titleOf(to)} to ${cityOf(to.to)}`
					return row('connection', change.label, target, clockAt(departureOf(to), to.from.timeZone), {
						problem: Boolean.match(change.tight, {
							onFalse: Function.constUndefined,
							onTrue: () => ({reason: line([Option.some(target), change.was]), status: 'warning' as const})
						}),
						target: to.id
					})
				})
			])
		],
		travellers
	}
}
