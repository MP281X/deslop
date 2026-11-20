// fallow-ignore-file duplicate-export -- Each app owns its folder-named Push service; their context identities and notification policies are distinct.
import type {Schema} from 'effect'
import {Array, Context, Effect, Function, Layer} from 'effect'

import type {SqlError} from 'effect/sql'
import {SqlClient, SqlSchema} from 'effect/sql'

import {Apns} from '@deslop/runtime/server/apns'
import {ApnsAnswer, Device} from '@deslop/runtime/shared/apns'

import {keyOf, SERIES_NAMES} from '#services/chapters/lib/utils.ts'
import {ChapterIdentity} from '#services/chapters/schema.ts'
import type {Chapter} from '#services/chapters/schema.ts'
import {ChapterDelivery, ChapterPushError} from '#services/push/schema.ts'

function asPushError(message: string) {
	return Effect.mapError((cause: SqlError.SqlError | Schema.SchemaError) => ChapterPushError.make({cause, message}))
}

export class Push extends Context.Service<Push>()('@deslop/opm/services/push/service/Push', {
	make: Effect.gen(function* () {
		const sql = yield* SqlClient.SqlClient
		const apns = yield* Apns
		const asPushReadError = asPushError('The push state could not be read.')
		const asPushSaveError = asPushError('The push state could not be saved.')
		const saveDevice = SqlSchema.void({
			Request: Device.insert,
			execute: row =>
				sql`INSERT INTO devices ${sql.insert(row)} ON CONFLICT (token) DO UPDATE SET bundle = excluded.bundle, kind = excluded.kind`
		})
		// Only the registration Apple answered for: a phone that registered the token again under another bundle meanwhile keeps it.
		const forgetDevice = SqlSchema.void({
			Request: Device.insert,
			execute: row =>
				sql`DELETE FROM devices WHERE token = ${row.token} AND bundle = ${row.bundle} AND kind = ${row.kind}`
		})
		const takeRecipients = SqlSchema.void({
			Request: ChapterIdentity,
			execute: chapter => sql`
				INSERT INTO ${sql(ChapterDelivery.table)} (series, number, token, done)
				SELECT ${chapter.series}, ${chapter.number}, token, 0 FROM devices
			`
		})
		// A recipient whose device was forgotten since is skipped.
		const listWaiting = SqlSchema.findAll({
			Request: ChapterIdentity,
			Result: Device,
			execute: chapter => sql`
				SELECT devices.* FROM ${sql(ChapterDelivery.table)} JOIN devices USING (token)
				WHERE series = ${chapter.series} AND number = ${chapter.number} AND done = 0
			`
		})
		const finishDelivery = SqlSchema.void({
			Request: ChapterDelivery.update,
			execute: row => sql`
				UPDATE ${sql(ChapterDelivery.table)} SET done = ${row.done}
				WHERE series = ${row.series} AND number = ${row.number} AND token = ${row.token}
			`
		})
		return {
			// Every recipient taken when the chapter was saved hears of it at least once: an alert Apple accepted just before its answer could be recorded is sent again, since recording first would lose the alert to a crash.
			announce: Effect.fn('Push.announce')(function* (chapter: Chapter) {
				// New registrations should not receive alerts for chapters announced without a working recipient.
				if (!apns.enabled) return true
				const identity = {number: chapter.number, series: chapter.series}
				const outcomes = yield* Effect.forEach(
					yield* asPushReadError(listWaiting(identity)),
					device =>
						Effect.catch(
							Effect.gen(function* () {
								const answer = yield* apns.sendToDevice(
									device,
									'alert',
									{
										aps: {
											alert: {
												body: chapter.title || `${chapter.pages.length} pages, out now`,
												title: `${SERIES_NAMES[chapter.series]} · Chapter ${chapter.number}`
											},
											sound: 'default',
											'thread-id': chapter.series
										},
										body: {path: keyOf(chapter)}
									},
									10,
									// An alert sent again after its answer was lost replaces the first on the phone.
									keyOf(chapter)
								)
								// A retry for one device must not send the same alert to the others again.
								const finish = Effect.as(
									asPushSaveError(finishDelivery({...identity, done: true, token: device.token})),
									true
								)
								return yield* ApnsAnswer.match(answer, {
									Accepted: () => finish,
									ChannelGone: () => finish,
									DeadToken: () => Effect.as(asPushSaveError(forgetDevice(device)), true),
									Refused: () => finish,
									Retry: () => Effect.succeed(false),
									// The payload is at fault, not the device: it stays registered, and the same alert would only be refused again.
									TooLarge: () => finish
								})
							}),
							cause => Effect.as(Effect.logWarning('A chapter push failed', cause), false)
						),
					{concurrency: 1}
				)
				return Array.every(outcomes, Function.identity)
			}),
			register: Effect.fn('Push.register')(function* (device: typeof Device.insert.Type) {
				yield* asPushSaveError(saveDevice(device))
			}),
			// Run in the transaction that saves the chapter, so a phone registered after it gets no backlog.
			takeRecipients: Effect.fn('Push.takeRecipients')(function* (chapter: ChapterIdentity) {
				yield* asPushSaveError(takeRecipients(chapter))
			})
		}
	})
}) {
	static readonly layer = Layer.effect(this, this.make)
}
