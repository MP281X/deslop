import {Array, DateTime, Duration, Effect, HashSet, Option, String, pipe} from 'effect'

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
import {arrivalOf, departureOf, endOf, labelled, titleOf} from '#services/bookings/lib/utils.ts'
import type {Booking, BookingList, Flight, Train} from '#services/bookings/schema.ts'
import {BookingsError} from '#services/bookings/schema.ts'

const CALENDAR = 'Trips'
// The calendar takes one hex, so it copies the dark value of the app's orange.
const COLOR = '#ffa066'

function notesOf(journey: Flight | Train) {
	const known = [labelled('Confirmation', journey.confirmation), labelled('Seat', journey.seat)]
	if (journey._tag === 'flight') return Array.join(Array.getSomes(known), '\n')
	return Array.join(Array.getSomes([...known, labelled('Coach', journey.coach)]), '\n')
}

function eventOf(booking: Booking) {
	if (booking._tag === 'stay') {
		return {
			alarms: [{relativeOffset: -3 * 60}],
			endDate: DateTime.toDateUtc(booking.checkOut),
			location: Option.getOrElse(booking.place.address, () => booking.name),
			notes: Option.getOrElse(labelled('Confirmation', booking.confirmation), () => ''),
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

function calendarPlan(all: BookingList, events: Awaited<ReturnType<ExpoCalendar['listEvents']>>, now: DateTime.Utc) {
	const eventsByUrl = Array.groupBy(events, event => event.url ?? '')
	const bookings = Array.filter(
		all,
		booking =>
			booking.status === 'confirmed' &&
			DateTime.isGreaterThan(endOf(booking), DateTime.subtractDuration(now, Duration.days(1)))
	)
	const planned = Array.map(bookings, booking => {
		const details = {...eventOf(booking), url: linkOf(booking.id)}
		return {details, event: Array.head(eventsByUrl[details.url] ?? [])}
	})
	const kept = HashSet.fromIterable(Array.map(bookings, booking => linkOf(booking.id)))
	return {
		create: pipe(
			planned,
			Array.filter(entry => Option.isNone(entry.event)),
			Array.map(entry => entry.details)
		),
		remove: Array.filter(
			events,
			event => event.url !== undefined && String.startsWith(BOOKING_LINK)(event.url) && !HashSet.has(kept, event.url)
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
							event.notes === entry.details.notes
						)
				),
				Option.map(event => ({details: entry.details, event})),
				Option.toArray
			)
		)
	}
}

// The bookings mirror into one calendar; an event's URL names its booking, so a later sync finds it again.
export const calendarAtom = Atom.make(get =>
	Effect.ignore(
		Effect.gen(function* () {
			const loaded = get(bookingsAtom)
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
						Effect.tryPromise({
							catch: cause => BookingsError.make({cause, message: 'The Trips calendar could not be created.'}),
							try: () => {
								const source = getDefaultCalendarSync().source
								return createCalendar({
									color: COLOR,
									entityType: EntityTypes.EVENT,
									name: CALENDAR,
									source,
									sourceId: source.id,
									title: CALENDAR
								})
							}
						}),
					onSome: Effect.fnUntraced(function* (found) {
						if (String.toLowerCase(found.color ?? '') !== COLOR) {
							yield* Effect.tryPromise({
								catch: cause => BookingsError.make({cause, message: 'The Trips calendar colour could not be set.'}),
								try: () => found.update({color: COLOR})
							})
						}
						return found
					})
				})
			)
			const now = yield* DateTime.now
			const events = yield* Effect.tryPromise({
				catch: cause => BookingsError.make({cause, message: 'The calendar events could not be listed.'}),
				try: () =>
					calendar.listEvents(
						DateTime.toDateUtc(DateTime.subtractDuration(now, Duration.days(60))),
						DateTime.toDateUtc(DateTime.addDuration(now, Duration.days(400)))
					)
			})
			const plan = calendarPlan(loaded.value, events, now)
			yield* Effect.forEach(
				plan.create,
				details =>
					Effect.tryPromise({
						catch: cause =>
							BookingsError.make({cause, message: `${details.title} could not be added to the calendar.`}),
						try: () => calendar.createEvent(details)
					}),
				{concurrency: 1, discard: true}
			)
			yield* Effect.forEach(
				plan.update,
				item =>
					Effect.tryPromise({
						catch: cause =>
							BookingsError.make({cause, message: `${item.details.title} could not be updated in the calendar.`}),
						try: () => item.event.update(item.details)
					}),
				{concurrency: 1, discard: true}
			)
			yield* Effect.forEach(
				// Only events this mirror made: one the person added to the calendar stays.
				plan.remove,
				event =>
					Effect.tryPromise({
						catch: cause =>
							BookingsError.make({cause, message: `${event.title} could not be removed from the calendar.`}),
						try: () => event.delete()
					}),
				{concurrency: 1, discard: true}
			)
		}),
		{log: 'Warn', message: 'The calendar was not synced'}
	)
)
