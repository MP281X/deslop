// fallow-ignore-file duplicate-export -- Each app owns its folder-named Push service; their context identities and notification policies are distinct.
import type {Schema} from 'effect'
import {Array, Context, DateTime, Effect, Function, Layer} from 'effect'

import type {SqlError} from 'effect/sql'
import {SqlClient, SqlSchema} from 'effect/sql'

import {Apns} from '@deslop/runtime/server/apns'
import {ApnsAnswer, Device} from '@deslop/runtime/shared/apns'

import {ChapterDelivery, ChapterPushError} from './contract.ts'
import {schemeOf} from './shared.ts'

import {ChapterIdentity, keyOf} from '#chapters/contract.ts'
import type {Chapter} from '#chapters/contract.ts'

const ACTIVITY_SERIES = {manga: 'One Punch Man', webcomic: 'OPM Webcomic'}

function asPushError(message: string) {
	return Effect.mapError((cause: SqlError.SqlError | Schema.SchemaError) => ChapterPushError.make({cause, message}))
}

export class Push extends Context.Service<Push>()('@deslop/opm/push/server/Push', {
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
				SELECT ${chapter.series}, ${chapter.number}, token, 0 FROM devices WHERE kind = 'start'
			`
		})
		// A recipient whose device was forgotten since is skipped.
		const listWaiting = SqlSchema.findAll({
			Request: ChapterIdentity,
			Result: Device,
			execute: chapter => sql`
				SELECT devices.* FROM ${sql(ChapterDelivery.table)} JOIN devices USING (token)
				WHERE series = ${chapter.series} AND number = ${chapter.number} AND done = 0 AND kind = 'start'
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
			// Every recipient taken when the chapter was saved hears of it at least once: a start Apple accepted just before its answer could be recorded is sent again, since recording first would lose the announcement to a crash.
			announce: Effect.fn('Push.announce')(function* (chapter: Chapter) {
				// A server without an APNs key can send nothing, so its chapters count as announced and are never sent later.
				if (!apns.enabled) return true
				const identity = {number: chapter.number, series: chapter.series}
				const timestamp = DateTime.toEpochSeconds(yield* DateTime.now)
				const name = ACTIVITY_SERIES[chapter.series]
				const pages = chapter.pages.length
				const outcomes = yield* Effect.forEach(
					yield* asPushReadError(listWaiting(identity)),
					device =>
						Effect.catch(
							Effect.gen(function* () {
								const answer = yield* apns.sendToDevice(
									device,
									'liveactivity',
									{
										aps: {
											alert: {
												body: chapter.title || `${pages} pages, out now`,
												sound: 'default',
												title: `${name} · Chapter ${chapter.number}`
											},
											attributes: {url: `${schemeOf(device.bundle)}://chapter/${chapter.series}/${chapter.number}`},
											'attributes-type': 'ChapterActivityAttributes',
											'content-state': {name, number: `${chapter.number}`, pages},
											event: 'start',
											timestamp
										}
									},
									10,
									// Use the same collapse id if Apple has not delivered the first start.
									keyOf(chapter)
								)
								// A retry for one device must not start the same activity on the others again.
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
									// The payload is at fault, not the device: it stays registered, and the same activity would only be refused again.
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
