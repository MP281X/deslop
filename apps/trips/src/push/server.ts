import {Array, Boolean, Cause, Context, Effect, Function, Layer, Option, Schema, pipe} from 'effect'
import type {DateTime} from 'effect'

import type {SqlError} from 'effect/sql'
import {Migrator, SqlClient, SqlSchema} from 'effect/sql'

import {Apns} from '@deslop/runtime/server/apns'
import {ApnsAnswer} from '@deslop/runtime/shared/apns'

import {AlertDelivery, Device, PushError, SentAlert} from './contract.ts'
import {migrations} from './migrations.ts'
import {announced, perDevice, unannouncedDevices} from './policy.ts'
import type {Alert} from './policy.ts'

import type {FlightsError, Flight} from '#flights/contract.ts'
import {FlightId, Place} from '#flights/contract.ts'

export function asPushError(message: string) {
	return Effect.mapError(
		(
			cause:
				| SqlError.SqlError
				| Schema.SchemaError
				| FlightsError
				| PushError
				| Effect.Error<ReturnType<typeof Apns.Service.startActivity>>
		) => PushError.make({cause, message})
	)
}

export const asPushReadError = asPushError('The push state could not be read.')
export const asPushSaveError = asPushError('The push state could not be saved.')

// The iPhones that took Trips' tokens, and what each was told: the alerts the round sends as notifications and the receipts that keep each sent once; the Live Activities read and write the same receipts for the changes they tell themselves.
export class Push extends Context.Service<Push>()('@deslop/trips/push/server/Push', {
	make: Effect.gen(function* () {
		const sql = yield* SqlClient.SqlClient
		const apns = yield* Apns

		const listDevices = SqlSchema.findAll({
			Request: Schema.Void,
			Result: Device,
			execute: () => sql`SELECT * FROM ${sql(Device.table)}`
		})
		const saveDevice = SqlSchema.void({
			Request: Device.insert,
			execute: row => sql`
				INSERT INTO ${sql(Device.table)} ${sql.insert(row)}
				ON CONFLICT (token) DO UPDATE SET bundle = excluded.bundle, kind = excluded.kind
			`
		})
		// One Live Activity shows per app, started with the token of the iPhone that registered last; older ones would only be tried in the table's order.
		const forgetOtherStarters = SqlSchema.void({
			Request: Device.insert,
			execute: row => sql`
				DELETE FROM ${sql(Device.table)}
				WHERE bundle = ${row.bundle} AND kind = 'start' AND token <> ${row.token}
			`
		})
		// Only while the token is still the one stored, so a token rotated meanwhile stays.
		const forgetDevice = SqlSchema.void({
			Request: Device.insert,
			execute: row => sql`
				DELETE FROM ${sql(Device.table)}
				WHERE bundle = ${row.bundle} AND kind = ${row.kind} AND token = ${row.token}
			`
		})
		const listSent = SqlSchema.findAll({
			Request: FlightId,
			Result: SentAlert,
			execute: id => sql`SELECT * FROM ${sql(SentAlert.table)} WHERE flightId = ${id} ORDER BY sentAt`
		})
		const recordSent = SqlSchema.void({
			Request: Schema.NonEmptyArray(SentAlert.insert),
			execute: rows => sql`
				INSERT INTO ${sql(SentAlert.table)} ${sql.insert(rows)}
				ON CONFLICT DO UPDATE SET sentAt = excluded.sentAt
			`
		})
		const listDeliveries = SqlSchema.findAll({
			Request: FlightId,
			Result: AlertDelivery,
			execute: id => sql`SELECT * FROM ${sql(AlertDelivery.table)} WHERE flightId = ${id} ORDER BY sentAt`
		})
		const recordDelivery = SqlSchema.void({
			Request: AlertDelivery.insert,
			execute: row =>
				sql`INSERT INTO ${sql(AlertDelivery.table)} ${sql.insert(row)} ON CONFLICT DO UPDATE SET sentAt = excluded.sentAt`
		})
		const forgetSentExcept = SqlSchema.void({
			Request: Schema.Array(FlightId),
			execute: ids => sql`DELETE FROM ${sql(SentAlert.table)} WHERE flightId NOT IN ${sql.in(ids)}`
		})
		const forgetDeliveriesExcept = SqlSchema.void({
			Request: Schema.Array(FlightId),
			execute: ids => sql`DELETE FROM ${sql(AlertDelivery.table)} WHERE flightId NOT IN ${sql.in(ids)}`
		})

		function forget(device: Device) {
			return asPushSaveError(forgetDevice(device))
		}

		// A device whose token died leaves the list with its first failed alert, which it never took: `settled` is Apple's last word for the phone, `gone` a token forgotten, `later` an alert to send again.
		const notify = Effect.fnUntraced(function* (device: Device, alert: Alert, flight: Flight) {
			const directions = yield* Effect.transposeOption(
				Option.map(Option.fromUndefinedOr(alert.directions), Schema.encodeEffect(Place))
			)
			const answer = yield* apns.sendToDevice(
				device,
				'alert',
				{
					aps: {
						alert: {body: alert.body, title: alert.title},
						sound: 'default',
						'thread-id': flight.id,
						// The app registers this category's Directions and Uber actions, which lead to the place sent beside it.
						...Option.match(directions, {onNone: () => ({}), onSome: () => ({category: 'leave'})})
					},
					// The app reads a notification's data from `body`: the flight a tap opens and the airport its actions lead to.
					body: {flightId: flight.id, ...Option.match(directions, {onNone: () => ({}), onSome: place => ({place})})}
				},
				10,
				// A gate or boarding time the phone must end on replaces the one it showed before.
				Boolean.match(perDevice(alert), {
					onFalse: Function.constUndefined,
					onTrue: () => `${flight.id}-${alert.category}`
				})
			)
			return yield* ApnsAnswer.match(answer, {
				Accepted: () => Effect.succeed('settled' as const),
				ChannelGone: () => Effect.succeed('settled' as const),
				DeadToken: () => Effect.as(forget(device), 'gone' as const),
				Refused: () => Effect.succeed('settled' as const),
				Retry: () => Effect.succeed('later' as const),
				// The alert itself can never fit, so it is final for this device, which stays registered.
				TooLarge: () => Effect.succeed('settled' as const)
			})
		})

		const devices = asPushReadError(listDevices())

		return {
			// Only a flight with something to say reads its receipts, through their index on (flightId, sentAt).
			announce: Effect.fn('Push.announce')(function* (flight: Flight, now: DateTime.Utc, candidates: readonly Alert[]) {
				if (Array.isReadonlyArrayEmpty(candidates)) return
				const sent = yield* asPushReadError(listSent(flight.id))
				const due = Array.filter(candidates, alert => perDevice(alert) || !announced(sent, alert))
				if (Array.isReadonlyArrayEmpty(due)) return
				const delivered = yield* asPushReadError(listDeliveries(flight.id))
				yield* Effect.forEach(
					due,
					Effect.fnUntraced(function* (alert) {
						const alertDevices = Array.filter(yield* devices, device => device.kind === 'alert')
						const row = {
							category: alert.category,
							flightId: flight.id,
							sentAt: now,
							value: Option.fromUndefinedOr(alert.value)
						}
						const pending = unannouncedDevices(alertDevices, delivered, alert)
						// The flight-wide record of a per-device value is a summary, written once every phone has it.
						if (perDevice(alert) && Array.isReadonlyArrayEmpty(pending) && announced(sent, alert)) return
						const outcomes = yield* Effect.forEach(
							pending,
							device =>
								Effect.catch(
									Effect.gen(function* () {
										const outcome = yield* notify(device, alert, flight)
										if (outcome === 'settled') {
											yield* asPushSaveError(recordDelivery({...row, token: device.token}))
										}
										return outcome
									}),
									cause => Effect.as(Effect.logWarning('An alert was not sent', Cause.fail(cause)), 'later' as const)
								),
							{concurrency: 1}
						)
						// Only a phone still registered that took it makes it sent, so one registered later in the window still gets it, also after the only token died.
						if (
							alertDevices.length > Array.countBy(outcomes, outcome => outcome === 'gone') &&
							!Array.contains(outcomes, 'later')
						) {
							yield* asPushSaveError(recordSent([row]))
						}
					}),
					{concurrency: 1, discard: true}
				)
			}),
			// The registered tokens, which the round reads once and the Live Activities pick their targets from.
			devices,
			// A token Apple rejected or refused leaves with its first failed send.
			forget,
			// Nothing reads the alerts of a flight that left.
			forgetAlertsExcept: Effect.fn('Push.forgetAlertsExcept')(function* (ids: readonly FlightId[]) {
				yield* Effect.all([forgetSentExcept(ids), forgetDeliveriesExcept(ids)], {concurrency: 1, discard: true})
			}),
			// What a flight's alerts have sent so far, and which phone took each.
			receipts: (id: FlightId) =>
				asPushReadError(Effect.all({delivered: listDeliveries(id), sent: listSent(id)}, {concurrency: 1})),
			// A change a Live Activity told as its own alert counts as delivered to its iPhone, so no notification repeats it there.
			record: (rows: readonly (typeof AlertDelivery.insert.Type)[]) =>
				asPushSaveError(Effect.forEach(rows, recordDelivery, {concurrency: 1, discard: true})),
			register: Effect.fn('Push.register')(function* (device: typeof Device.insert.Type) {
				yield* pipe(
					Effect.gen(function* () {
						yield* saveDevice(device)
						if (device.kind === 'start') yield* forgetOtherStarters(device)
					}),
					sql.withTransaction,
					asPushSaveError
				)
			})
		}
	})
}) {
	static readonly migrations = Layer.effectDiscard(
		Migrator.make({})({loader: Migrator.fromRecord(migrations), table: 'push_migrations'})
	)

	static readonly layer = Layer.provide(Layer.effect(this, this.make), this.migrations)
}
