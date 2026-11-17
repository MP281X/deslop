// fallow-ignore-file duplicate-export -- Each app owns its folder-named Push service; their context identities and notification policies are distinct.
import {Array, Context, Effect, Function, Layer, Redacted, Schema} from 'effect'

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
		const listDevices = SqlSchema.findAll({
			Request: Schema.Void,
			Result: Device,
			execute: () => sql`SELECT * FROM devices`
		})
		const saveDevice = SqlSchema.void({
			Request: Device.insert,
			execute: row =>
				sql`INSERT INTO devices ${sql.insert(row)} ON CONFLICT (token) DO UPDATE SET bundle = excluded.bundle, kind = excluded.kind`
		})
		const forgetDevice = SqlSchema.void({
			Request: Device.insert,
			execute: row => sql`DELETE FROM devices WHERE token = ${row.token}`
		})
		const listDeliveries = SqlSchema.findAll({
			Request: ChapterIdentity,
			Result: ChapterDelivery,
			execute: chapter =>
				sql`SELECT * FROM ${sql(ChapterDelivery.table)} WHERE series = ${chapter.series} AND number = ${chapter.number}`
		})
		const recordDelivery = SqlSchema.void({
			Request: ChapterDelivery.insert,
			execute: row => sql`INSERT INTO ${sql(ChapterDelivery.table)} ${sql.insert(row)} ON CONFLICT DO NOTHING`
		})
		return {
			announce: Effect.fn('Push.announce')(function* (chapter: Chapter) {
				if (!apns.enabled) return true
				const devices = yield* asPushReadError(listDevices())
				const delivered = yield* asPushReadError(listDeliveries(chapter))
				const outcomes = yield* Effect.forEach(
					devices,
					device =>
						Effect.catch(
							Effect.gen(function* () {
								if (Array.some(delivered, row => Redacted.value(row.token) === Redacted.value(device.token))) {
									return true
								}
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
									10
								)
								const remember = Effect.as(
									asPushSaveError(
										recordDelivery({number: chapter.number, series: chapter.series, token: device.token})
									),
									true
								)
								return yield* ApnsAnswer.match(answer, {
									Accepted: () => remember,
									DeadToken: () => Effect.as(asPushSaveError(forgetDevice(device)), true),
									Refused: () => remember,
									Retry: () => Effect.succeed(false)
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
			})
		}
	})
}) {
	static readonly layer = Layer.effect(this, this.make)
}
