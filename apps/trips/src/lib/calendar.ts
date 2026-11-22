import {Array, DateTime, Duration, Effect, Function, HashSet, Option, Semaphore, String, pipe} from 'effect'

import {AsyncResult, Atom} from 'effect/reactivity'
import {
	EntityTypes,
	createCalendar,
	getCalendars,
	getDefaultCalendarSync,
	requestCalendarPermissions
} from 'expo-calendar'
import type {ExpoCalendar} from 'expo-calendar'

import {bookingsAtom} from '#lib/bookings.ts'
import {BOOKING_LINK, linkOf} from '#lib/deep-links.ts'
import {placeLine} from '#lib/rides.ts'
import {arrivalOf, cancelledOf, departureOf, endOf, labelled, startOf, titleOf} from '#services/bookings/lib/utils.ts'
import type {BookingList, Flight, Train} from '#services/bookings/schema.ts'
import {Booking, BookingsError} from '#services/bookings/schema.ts'

const CALENDAR = 'Trips'
// The calendar takes one hex, so it copies the dark value of the app's orange.
const COLOR = '#ffa066'

function notesOf(journey: Flight | Train) {
	const known = [labelled('Confirmation', journey.confirmation), labelled('Seat', journey.seat)]
	if (Booking.isAnyOf(['flight'])(journey)) return Array.join(Array.getSomes(known), '\n')
	return Array.join(Array.getSomes([...known, labelled('Coach', journey.coach)]), '\n')
}

function eventOf(booking: Booking) {
	if (Booking.isAnyOf(['stay'])(booking)) {
		return {
			alarms: [{relativeOffset: -3 * 60}],
			endDate: DateTime.toDateUtc(booking.checkOut),
			location: Option.getOrElse(booking.place.address, () => booking.name),
			notes: Option.getOrElse(labelled('Confirmation', booking.confirmation), Function.constant('')),
			startDate: DateTime.toDateUtc(booking.checkIn),
			timeZone: booking.place.timeZone,
			title: booking.name
		}
	}
	return {
		// Calendar's own Time to Leave reads the location; this alert is the fallback when it is off.
		alarms: [{relativeOffset: {flight: -180, train: -45}[booking._tag]}],
		endDate: DateTime.toDateUtc(arrivalOf(booking)),
		location: placeLine(booking.from),
		notes: notesOf(booking),
		startDate: DateTime.toDateUtc(departureOf(booking)),
		timeZone: booking.from.timeZone,
		title: `${titleOf(booking)} ${Option.getOrElse(booking.from.code, () => booking.from.name)} → ${Option.getOrElse(booking.to.code, () => booking.to.name)}`
	}
}

function sameTime(left: DateTime.DateTime.Input, right: DateTime.DateTime.Input) {
	return Option.exists(Option.all([DateTime.make(left), DateTime.make(right)]), times =>
		DateTime.Equivalence(times[0], times[1])
	)
}

function alarmsOf(alarms: readonly {relativeOffset?: number}[]) {
	return pipe(
		alarms,
		Array.map(alarm => `${alarm.relativeOffset}`),
		Array.join(',')
	)
}

// Each booking owns the one event its URL names; a second event with that URL is a duplicate this mirror made, and goes.
function calendarPlan(
	all: BookingList,
	events: Awaited<ReturnType<ExpoCalendar['listEvents']>>,
	window: {start: DateTime.Utc; end: DateTime.Utc}
) {
	const planned = pipe(
		all,
		Array.filter(
			booking =>
				!cancelledOf(booking) &&
				DateTime.isGreaterThan(endOf(booking), window.start) &&
				DateTime.isLessThan(startOf(booking), window.end)
		),
		Array.map(booking => {
			const details = {...eventOf(booking), url: linkOf(booking.id)}
			return {details, event: Array.findFirst(events, event => event.url === details.url)}
		})
	)
	const kept = HashSet.fromIterable(
		Array.flatMap(planned, entry => Option.toArray(Option.map(entry.event, event => event.id)))
	)
	return {
		create: pipe(
			planned,
			Array.filter(entry => Option.isNone(entry.event)),
			Array.map(entry => entry.details)
		),
		remove: Array.filter(
			events,
			event => event.url !== undefined && String.startsWith(BOOKING_LINK)(event.url) && !HashSet.has(kept, event.id)
		),
		update: Array.flatMap(planned, entry =>
			pipe(
				entry.event,
				Option.filter(
					event =>
						!(
							sameTime(event.startDate, entry.details.startDate) &&
							sameTime(event.endDate, entry.details.endDate) &&
							event.title === entry.details.title &&
							event.location === entry.details.location &&
							event.notes === entry.details.notes &&
							event.timeZone === entry.details.timeZone &&
							alarmsOf(event.alarms) === alarmsOf(entry.details.alarms)
						)
				),
				Option.map(event => ({details: entry.details, event})),
				Option.toArray
			)
		)
	}
}

// One sync at a time, and a native write finishes even when a newer list arrives, so the next sync lists what the last one wrote and never adds an event twice.
const syncing = Semaphore.makeUnsafe(1)

function native<A>(message: string, write: () => PromiseLike<A>) {
	return Effect.uninterruptible(
		Effect.tryPromise({catch: cause => BookingsError.make({cause, message}), try: () => write()})
	)
}

// The bookings mirror into one calendar; an event's URL names its booking, so a later sync finds it again.
export const calendarAtom = Atom.make(get => {
	const loaded = get(bookingsAtom)
	return Effect.ignore(
		Semaphore.withPermit(
			syncing,
			Effect.gen(function* () {
				if (!AsyncResult.isSuccess(loaded)) return
				if (
					!(yield* Effect.tryPromise({
						catch: cause => BookingsError.make({cause, message: 'The calendar permission could not be asked.'}),
						try: () => requestCalendarPermissions()
					})).granted
				) {
					return
				}
				const calendar = yield* pipe(
					yield* Effect.tryPromise({
						catch: cause => BookingsError.make({cause, message: 'The calendars could not be listed.'}),
						try: () => getCalendars(EntityTypes.EVENT)
					}),
					Array.findFirst(found => found.title === CALENDAR),
					Option.match({
						onNone: () =>
							native('The Trips calendar could not be created.', () => {
								const source = getDefaultCalendarSync().source
								return createCalendar({
									color: COLOR,
									entityType: EntityTypes.EVENT,
									name: CALENDAR,
									source,
									...Option.match(Option.fromUndefinedOr(source.id), {
										onNone: () => ({}),
										onSome: sourceId => ({sourceId})
									}),
									title: CALENDAR
								})
							}),
						onSome: Effect.fnUntraced(function* (found) {
							if (String.toLowerCase(found.color ?? '') !== COLOR) {
								yield* native('The Trips calendar colour could not be set.', () => found.update({color: COLOR}))
							}
							return found
						})
					})
				)
				const now = yield* DateTime.now
				const window = {
					end: DateTime.addDuration(now, Duration.days(400)),
					start: DateTime.subtractDuration(now, Duration.days(1))
				}
				const events = yield* Effect.tryPromise({
					catch: cause => BookingsError.make({cause, message: 'The calendar events could not be listed.'}),
					try: () => calendar.listEvents(DateTime.toDateUtc(window.start), DateTime.toDateUtc(window.end))
				})
				const plan = calendarPlan(loaded.value, events, window)
				yield* Effect.forEach(
					plan.create,
					details =>
						native(`${details.title} could not be added to the calendar.`, () => calendar.createEvent(details)),
					{concurrency: 1, discard: true}
				)
				yield* Effect.forEach(
					plan.update,
					item =>
						native(`${item.details.title} could not be updated in the calendar.`, () =>
							item.event.update(item.details)
						),
					{concurrency: 1, discard: true}
				)
				yield* Effect.forEach(
					// Only events this mirror made: one the person added to the calendar stays.
					plan.remove,
					event => native(`${event.title} could not be removed from the calendar.`, () => event.delete()),
					{concurrency: 1, discard: true}
				)
			})
		),
		{log: 'Warn', message: 'The calendar was not synced'}
	)
})
