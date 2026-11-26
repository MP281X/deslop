import {Array, Boolean, DateTime, Duration, Equal, Option, Order, Result, String, Struct, pipe} from 'effect'

import {Flight} from '#contracts'
import type {FlightList, Traveller} from '#contracts'
import {HOUR, bookedOf, isBooked, localDate} from '#journey'

import type {LocalTime} from './schema.ts'

const OFFSET = /(?:Z|[+-]\d{2}:?\d{2})$/u

// Titles a pass prints after a name, which say nothing about who travels.
const TITLES = ['MR', 'MRS', 'MS', 'MISS', 'MSTR', 'DR']

function zonedOf(time: LocalTime, timeZone: Option.Option<string>) {
	if (Option.isSome(String.match(OFFSET)(time))) {
		return DateTime.makeZonedFromString(String.replace(/Z$/u, '+00:00')(time))
	}
	// The wall-clock parts, read in the place's zone without dropping seconds or fractions.
	return Option.flatMap(timeZone, zone => DateTime.makeZoned(time, {adjustForTimeZone: true, timeZone: zone}))
}

// A time with an offset or Z stands for itself; a wall time the place never shows, such as 30 February or 02:30 as summer time begins, reads as nothing rather than as another moment.
export function instantOf(time: LocalTime, timeZone: Option.Option<string>) {
	return pipe(
		zonedOf(time, timeZone),
		Option.filter(at => {
			const parts = DateTime.toParts(at)
			return (
				`${parts.year}${pipe(
					[parts.month, parts.day, parts.hour, parts.minute],
					Array.map(part => String.padStart(2, '0')(`${part}`)),
					Array.join('')
				)}` === String.replaceAll(/\D/gu, '')(String.slice(0, 16)(time))
			)
		}),
		Option.map(DateTime.toUtc)
	)
}

// A field as printed, so "abc123 " and "ABC123" are the same code and "011A" and "11A" the same seat.
function printed(value: Option.Option<string>) {
	return pipe(value, Option.map(String.trim), Option.map(String.toUpperCase), Option.filter(String.isNonEmpty))
}

function codeOf(traveller: Traveller) {
	return printed(traveller.confirmation)
}

function seatOf(traveller: Traveller) {
	return Option.map(printed(traveller.seat), String.replace(/^0+(?=\d)/u, ''))
}

// An e-ticket number as its digits, so "125-2345678901" and "1252345678901" are one ticket.
function ticketOf(traveller: Traveller) {
	return pipe(printed(traveller.ticket), Option.map(String.replaceAll(/\D/gu, '')), Option.filter(String.isNonEmpty))
}

// A name as a pass or a booking prints it, so ROSSI/MATTEO MR and Matteo Rossi are one person: its words in any script and any order, without case, accents or titles.
function nameOf(traveller: Traveller) {
	return pipe(
		traveller.name,
		Option.map(name =>
			pipe(
				name,
				String.normalize('NFD'),
				String.replaceAll(/[̀-ͯ]/gu, ''),
				String.normalize('NFC'),
				String.toUpperCase,
				String.split(/[^\p{L}\p{M}\p{N}]+/u),
				Array.filter(word => String.isNonEmpty(word) && !Array.contains(TITLES, word)),
				Array.sort(String.Order),
				Array.join(' ')
			)
		),
		Option.filter(String.isNonEmpty)
	)
}

function newer<A>(existing: Option.Option<A>, incoming: Option.Option<A>) {
	return Option.orElse(incoming, () => existing)
}

function differ(left: Option.Option<string>, right: Option.Option<string>) {
	return Option.exists(left, one => Option.exists(right, other => other !== one))
}

function agree(left: Option.Option<string>, right: Option.Option<string>) {
	return Option.isSome(left) && Equal.equals(left, right)
}

type Evidence = {readonly code: boolean; readonly name: boolean; readonly seat: boolean; readonly ticket: boolean}

type Candidate = {readonly evidence: Evidence; readonly index: number}

// The e-ticket counts most, then the name, the reservation and the seat.
const bySurety = Order.combineAll([
	Order.mapInput(Order.Boolean, (candidate: Candidate) => candidate.evidence.ticket),
	Order.mapInput(Order.Boolean, (candidate: Candidate) => candidate.evidence.name),
	Order.mapInput(Order.Boolean, (candidate: Candidate) => candidate.evidence.code),
	Order.mapInput(Order.Boolean, (candidate: Candidate) => candidate.evidence.seat)
])

function evidenceBetween(held: Traveller, incoming: Traveller) {
	return {
		code: agree(codeOf(held), codeOf(incoming)),
		name: agree(nameOf(held), nameOf(incoming)),
		seat: agree(seatOf(held), seatOf(incoming)),
		ticket: agree(ticketOf(held), ticketOf(incoming))
	} satisfies Evidence
}

// The surest candidate, unless others are as sure and the ticket prints fewer people alike than them, when which one it means is unknown and it changes nobody.
function chosen(candidates: readonly Candidate[], alikeCount: number) {
	return pipe(
		Array.match(candidates, {onEmpty: () => [], onNonEmpty: found => [Array.max(found, bySurety)]}),
		Array.flatMap(surest => Array.filter(candidates, candidate => bySurety(candidate, surest) === 0)),
		tied => Option.filter(Array.head(tied), () => tied.length <= alikeCount)
	)
}

// Two entries of a ticket that nothing tells apart.
function alike(left: Traveller, right: Traveller) {
	return (
		left.status === right.status &&
		Array.every([ticketOf, nameOf, codeOf, seatOf], field => Equal.equals(field(left), field(right)))
	)
}

// How many entries from this one on a ticket prints alike, each of whom may take one of the candidates tied for it.
function alikeFrom(entries: readonly Traveller[], entry: Traveller, index: number) {
	return pipe(
		entries,
		Array.drop(index),
		Array.countBy(other => alike(entry, other))
	)
}

// The ticket's word on a traveller: its status always, every other field only where it prints one, and a boarding pass once any was read.
function updated(held: Traveller, incoming: Traveller) {
	return {
		boardingGroup: newer(held.boardingGroup, incoming.boardingGroup),
		boardingPass: held.boardingPass || incoming.boardingPass,
		confirmation: newer(held.confirmation, incoming.confirmation),
		name: newer(held.name, incoming.name),
		seat: newer(held.seat, incoming.seat),
		status: incoming.status,
		ticket: newer(held.ticket, incoming.ticket)
	} satisfies Traveller
}

// The same person twice in one ticket, as a reader may list them: one seat holds one person, while two entries without a seat are the two people the ticket prints.
function repeated(left: Traveller, right: Traveller) {
	return Option.isSome(seatOf(left)) && alike(left, right) && Equal.equals(left.boardingGroup, right.boardingGroup)
}

type Seating = {readonly claimed: readonly number[]; readonly travellers: readonly Traveller[]}

// A traveller the ticket names nobody for, who speaks for their whole reservation.
function wholeBooking(traveller: Traveller) {
	return Option.isNone(traveller.name) && Option.isNone(traveller.seat)
}

// A ticket that names nobody and prints no seat speaks for its whole reservation, such as the booking's cancellation, but only for the travellers holding its code whose reservation still stands, so a cancelled one is reinstated only by a ticket naming them. With no code, or one nobody holds, a reservation that stands joins a flight nobody is on yet, or with its code any flight, and otherwise it changes nobody.
function wholeReservation(seating: Seating, incoming: Traveller) {
	function holds(held: Traveller) {
		return agree(codeOf(held), codeOf(incoming))
	}
	return pipe(
		incoming,
		Option.liftPredicate(wholeBooking),
		Option.map(() => {
			if (Array.some(seating.travellers, holds)) {
				return {
					...seating,
					travellers: Array.map(seating.travellers, held =>
						Boolean.match(holds(held) && isBooked(held), {onFalse: () => held, onTrue: () => updated(held, incoming)})
					)
				}
			}
			if (isBooked(incoming) && (Array.isReadonlyArrayEmpty(seating.travellers) || Option.isSome(codeOf(incoming)))) {
				return {...seating, travellers: [...seating.travellers, incoming]}
			}
			return seating
		})
	)
}

// A traveller the flight does not hold joins it while their reservation stands; a cancellation of someone it never held changes nothing.
function joined(seating: Seating, incoming: Traveller) {
	if (!isBooked(incoming)) return seating
	return {claimed: [...seating.claimed, seating.travellers.length], travellers: [...seating.travellers, incoming]}
}

// Each traveller a ticket names is at most one already on the flight, the surest among those this ticket has not named yet, so two passengers of the same name in two seats stay two, a pass shared again updates the one it names, and one that could be either of two changes neither. The same e-ticket says it is that traveller, whatever the reservation, name or seat; otherwise nothing may differ, so another seat under the same name and code is a second person of that name.
function seat(seating: Seating, incoming: Traveller, alikeCount: number) {
	return Option.getOrElse(wholeReservation(seating, incoming), () =>
		pipe(
			seating.travellers,
			Array.filterMap((held, index) =>
				pipe(
					evidenceBetween(held, incoming),
					Option.liftPredicate(
						evidence =>
							evidence.ticket ||
							(!differ(codeOf(held), codeOf(incoming)) &&
								!differ(ticketOf(held), ticketOf(incoming)) &&
								!differ(nameOf(held), nameOf(incoming)) &&
								!differ(seatOf(held), seatOf(incoming)))
					),
					Option.filter(() => !Array.contains(seating.claimed, index)),
					Option.match({onNone: () => Result.failVoid, onSome: evidence => Result.succeed({evidence, index})})
				)
			),
			Array.match({
				onEmpty: () => joined(seating, incoming),
				onNonEmpty: candidates =>
					Option.match(chosen(candidates, alikeCount), {
						onNone: () => seating,
						onSome: found => ({
							claimed: [...seating.claimed, found.index],
							travellers: Array.map(seating.travellers, (held, index) =>
								Boolean.match(index === found.index, {onFalse: () => held, onTrue: () => updated(held, incoming)})
							)
						})
					})
			})
		)
	)
}

// Each ticket adds the travellers it names, so passes shared for other people fill one flight, and updates the ones already on it.
function travellersOf(existing: readonly Traveller[], incoming: readonly Traveller[]) {
	const entries = Array.dedupeWith(incoming, repeated)
	const start: Seating = {claimed: [], travellers: existing}
	return Array.reduce(entries, start, (seating, entry, index) => seat(seating, entry, alikeFrom(entries, entry, index)))
		.travellers
}

function withTravellers(flight: Flight, travellers: readonly Traveller[]) {
	return Flight.make({...Struct.pick(flight, Struct.keys(Flight.fields)), travellers})
}

// What names one service: a flight number from one airport on one local date there, as the airline prints it, so BA15's two legs a day and BA801 on two evenings stay apart.
export type Service = {
	readonly airlineCode: string
	readonly departs: DateTime.Utc
	readonly number: string
	readonly origin: string
	readonly timeZone: string
}

// One key per service, read alike when a ticket is saved and when old rows are joined.
export function serviceOf(service: Service) {
	return `${service.airlineCode} ${service.number} ${service.origin} ${DateTime.formatIsoDateUtc(localDate(service.departs, service.timeZone))}`
}

function serviceOfFlight(flight: Flight) {
	return serviceOf({
		airlineCode: flight.airlineCode,
		departs: flight.departs,
		number: flight.number,
		origin: Option.getOrElse(flight.from.code, () => flight.from.name),
		timeZone: flight.from.timeZone
	})
}

function sameService(existing: Flight, incoming: Flight) {
	return serviceOfFlight(existing) === serviceOfFlight(incoming)
}

// A traveller a segment would take off another flight, by their place there, and which of the segment's travellers takes them; identified when one e-ticket says they are the same person.
type Leaver = {readonly identified: boolean; readonly index: number; readonly mover: number}

// A flight and the travellers a segment would take off it.
type Held = {readonly flight: Flight; readonly leavers: readonly Leaver[]}

function among(leavers: readonly Leaver[]) {
	return (index: number) => Array.some(leavers, leaver => leaver.index === index)
}

// Who of a flight's travellers one of a segment's movers takes, given those the segment's earlier movers took already.
type Taking = {
	readonly at: number
	readonly mover: Traveller
	readonly movers: readonly Traveller[]
	readonly taken: readonly Leaver[]
	readonly travellers: readonly Traveller[]
}

// A segment naming nobody takes everyone still booked under its code; a cancelled traveller stays, as only a ticket naming them reinstates them.
function wholeLeavers(taking: Taking) {
	return Array.filterMap(taking.travellers, (held, index) =>
		Boolean.match(isBooked(held) && agree(codeOf(held), codeOf(taking.mover)) && !among(taking.taken)(index), {
			onFalse: () => Result.failVoid,
			onTrue: () => Result.succeed({identified: false, index, mover: taking.at} satisfies Leaver)
		})
	)
}

// Each traveller a segment names takes at most one still booked on a flight, the surest, and none when two are as likely: the same e-ticket, whatever the reservation, or the same reservation and name with no e-ticket that differs. Seats tell nothing, as each flight has its own.
function namedLeaver(taking: Taking) {
	return pipe(
		chosen(
			Array.filterMap(taking.travellers, (held, index) =>
				pipe(
					evidenceBetween(held, taking.mover),
					Option.liftPredicate(
						evidence =>
							evidence.ticket || (evidence.code && evidence.name && !differ(ticketOf(held), ticketOf(taking.mover)))
					),
					Option.filter(() => isBooked(held) && !among(taking.taken)(index)),
					Option.match({onNone: () => Result.failVoid, onSome: evidence => Result.succeed({evidence, index})})
				)
			),
			alikeFrom(taking.movers, taking.mover, taking.at)
		),
		Option.map(found => ({identified: found.evidence.ticket, index: found.index, mover: taking.at}) satisfies Leaver),
		Option.toArray
	)
}

function leaversOf(travellers: readonly Traveller[], movers: readonly Traveller[]) {
	return Array.flatten(
		Array.mapAccum(movers, Array.empty<Leaver>(), (taken, mover, at) => {
			const taking = {at, mover, movers, taken, travellers} satisfies Taking
			const found = Boolean.match(wholeBooking(mover), {
				onFalse: () => namedLeaver(taking),
				onTrue: () => wholeLeavers(taking)
			})
			return [Array.appendAll(taken, found), found]
		})[1]
	)
}

function within(held: Flight, incoming: Flight) {
	return pipe(DateTime.distance(held.departs, incoming.departs), Duration.abs, Duration.isLessThan(Duration.days(2)))
}

// What says a segment replaces another flight within two days, as a schedule change or a missed connection moves a traveller: it leaves from the same airport or lands at the same one. For a traveller one e-ticket identifies, any airport they share will do while both are in the air at once; otherwise the two are legs of one journey, as a connection or a later rebooked leg before it is, and both stay.
function replaces(incoming: Flight, held: Flight, identified: boolean) {
	const crossed = agree(held.from.code, incoming.to.code) || agree(held.to.code, incoming.from.code)
	return (
		within(held, incoming) &&
		(agree(held.from.code, incoming.from.code) ||
			agree(held.to.code, incoming.to.code) ||
			(identified &&
				crossed &&
				DateTime.isLessThan(held.departs, incoming.arrives) &&
				DateTime.isLessThan(incoming.departs, held.arrives)))
	)
}

// A ticket speaks for the journey of a traveller it moves only when it holds or replaces every other flight they hold within two days of it, so a pass for one leg never moves them off another leg of the same booking.
function covers(ticket: FlightList, held: readonly Held[]) {
	return (mover: number) =>
		Array.every(held, other =>
			Array.every(
				other.leavers,
				leaver =>
					leaver.mover !== mover ||
					!Array.some(ticket, segment => within(other.flight, segment)) ||
					Array.some(ticket, segment => replaces(segment, other.flight, leaver.identified))
			)
		)
}

// The travellers a segment takes off each flight, by their places there: those it names or its whole reservation, still booked, from the flights it replaces outside the ticket's own.
function leavingOf(flights: FlightList, ticket: FlightList, incoming: Flight) {
	const services = Array.map(ticket, serviceOfFlight)
	const movers = pipe(incoming.travellers, Array.filter(isBooked), Array.dedupeWith(repeated))
	const held = Array.map(
		flights,
		flight =>
			({
				flight,
				leavers: pipe(
					services,
					Array.filter(service => service === serviceOfFlight(flight)),
					Array.match({onEmpty: () => leaversOf(flight.travellers, movers), onNonEmpty: () => []})
				)
			}) satisfies Held
	)
	const covered = covers(ticket, held)
	return Array.map(
		held,
		other =>
			({
				...other,
				leavers: Array.filter(
					other.leavers,
					leaver => covered(leaver.mover) && replaces(incoming, other.flight, leaver.identified)
				)
			}) satisfies Held
	)
}

// Who arrives from each flight: the travellers leaving it, keeping who they are and their reservation, but not the seat, group or boarding pass of the flight they left.
function arrivalsOf(leaving: readonly Held[]) {
	return Array.map(leaving, other =>
		pipe(
			other.flight.travellers,
			Array.filter((_, index) => among(other.leavers)(index)),
			Array.map(
				traveller =>
					({...traveller, boardingGroup: Option.none(), boardingPass: false, seat: Option.none()}) satisfies Traveller
			)
		)
	)
}

// Those arriving join one flight at a time, so a traveller leaving two flights a ticket replaces, as a missed connection's, arrives once; the ticket then updates whom it names.
function seated(
	existing: readonly Traveller[],
	arrivals: readonly (readonly Traveller[])[],
	incoming: readonly Traveller[]
) {
	return travellersOf(Array.reduce(arrivals, existing, travellersOf), incoming)
}

// A ticket reads only for its own travellers, so a cancellation changes no time or gate another traveller's ticket gave; the boarding time and live data survive only while the departure stays within the hour.
function combine(existing: Flight, incoming: Flight, arrivals: readonly (readonly Traveller[])[]) {
	const same = pipe(
		DateTime.distance(incoming.departs, existing.departs),
		Duration.abs,
		Duration.isLessThanOrEqualTo(HOUR)
	)
	const fields = Boolean.match(bookedOf(incoming), {onFalse: () => existing, onTrue: () => incoming})
	return Flight.make({
		...Struct.pick(fields, Struct.keys(Flight.fields)),
		boardingAt: newer(
			Option.filter(existing.boardingAt, () => same),
			fields.boardingAt
		),
		id: existing.id,
		live: Option.filter(existing.live, () => same),
		travellers: seated(existing.travellers, arrivals, incoming.travellers)
	})
}

// A flight without the travellers leaving it, or nothing once nobody is left on it.
function remaining(other: Held) {
	if (Array.isReadonlyArrayEmpty(other.leavers)) return Result.succeed(other.flight)
	return pipe(
		Array.filter(other.flight.travellers, (_, index) => !among(other.leavers)(index)),
		Option.liftPredicate(Array.isReadonlyArrayNonEmpty),
		Option.match({onNone: () => Result.failVoid, onSome: left => Result.succeed(withTravellers(other.flight, left))})
	)
}

// One segment of a ticket joins its service, or becomes a flight of its own with its own id, alerts and Live Activity, unless it holds nobody, as a cancellation of a flight never saved. The travellers it moves leave the flights it replaces; a flight goes once nobody is left on it.
function upsertOne(ticket: FlightList) {
	return (flights: FlightList, incoming: Flight) => {
		const leaving = leavingOf(flights, ticket, incoming)
		const arrivals = arrivalsOf(leaving)
		const target = Array.findFirst(flights, held => sameService(held, incoming))
		const merged = Option.match(target, {
			onNone: () => withTravellers(incoming, seated([], arrivals, incoming.travellers)),
			onSome: found => combine(found, incoming, arrivals)
		})
		const rest = Array.filterMap(leaving, other =>
			Boolean.match(sameService(other.flight, incoming), {
				onFalse: () => remaining(other),
				onTrue: () => Result.succeed(merged)
			})
		)
		return Option.match(target, {
			onNone: () =>
				Boolean.match(Array.isReadonlyArrayEmpty(merged.travellers), {
					onFalse: () => [...rest, merged],
					onTrue: () => rest
				}),
			onSome: () => rest
		})
	}
}

// All segments of one ticket stand together: none replaces another, as an itinerary's two flights on one route never do.
export function upsert(current: FlightList, incoming: FlightList): FlightList {
	return Array.reduce(incoming, current, upsertOne(incoming))
}

// FlightAware searches at most two days ahead, so a lookup asks up to 47 hours on; tracking starts an hour inside that, so the first lookup reaches an hour past the booked departure, which a schedule moved a little later still falls in.
