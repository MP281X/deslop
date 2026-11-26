import type {Option} from 'effect'
import {Context, DateTime, Duration, Effect, Layer, Schedule, Schema, pipe} from 'effect'

import {Digest, SecureRandom} from 'effect/crypto'
import {Base64Url} from 'effect/encoding'
import {Reactivity} from 'effect/reactivity'
import {SqlClient, SqlSchema} from 'effect/sql'

import {asAuthError} from '@deslop/runtime/shared/auth'
import type {AuthError, UserId} from '@deslop/runtime/shared/auth'

import {sessionsMigrations} from './migrations.ts'
import {CookieSession} from './schema.ts'

declare module 'effect/reactivity/Reactivity' {
	interface Keys {
		readonly sessions: never
	}
}
export class Sessions extends Context.Service<
	Sessions,
	{
		readonly create: (user: UserId, address: Option.Option<string>, browser: string) => Effect.Effect<string, AuthError>
		readonly current: (secret: string) => Effect.Effect<Option.Option<CookieSession>, AuthError>
		readonly list: (user: UserId) => Effect.Effect<CookieSession[], AuthError>
		readonly remove: (id: string, user: UserId) => Effect.Effect<void, AuthError>
		readonly forget: (secret: string) => Effect.Effect<void, AuthError>
		readonly forgetPerson: (user: UserId) => Effect.Effect<void, AuthError>
	}
>()('@deslop/auth/server/sessions/service/Sessions') {
	static readonly migrations = sessionsMigrations

	static readonly layer = Layer.provide(
		Layer.effect(
			Sessions,
			Effect.gen(function* () {
				const sql = yield* SqlClient.SqlClient
				const reactivity = yield* Reactivity.Reactivity
				const digest = yield* Digest.Digest
				const random = yield* SecureRandom.SecureRandom
				function hash(secret: string) {
					return Effect.map(digest.digest(Digest.sha256, new TextEncoder().encode(secret)), Base64Url.encode)
				}
				const table = sql(CookieSession.table)
				function mutate<A, E, R>(effect: Effect.Effect<A, E, R>) {
					return pipe(
						effect,
						Reactivity.mutation(['sessions']),
						Effect.provideService(Reactivity.Reactivity, reactivity)
					)
				}
				// A browser unused for thirty days is signed out.
				const cutoff = Effect.map(DateTime.now, now => DateTime.subtract(now, {days: 30}))
				const insert = SqlSchema.void({
					Request: CookieSession.insert,
					execute: row => sql`INSERT INTO ${table} ${sql.insert(row)}`
				})
				// An expired session can never be used or listed again, so nobody hears that it goes.
				yield* pipe(
					cutoff,
					Effect.flatMap(since => sql`DELETE FROM ${table} WHERE lastSeenAt <= ${DateTime.toEpochMillis(since)}`),
					Effect.withSpan('Sessions.sweep'),
					Effect.ignore({log: 'Warn', message: 'Expired sessions could not be deleted'}),
					Effect.repeat(Schedule.spaced(Duration.hours(1))),
					Effect.forkScoped
				)
				return Sessions.of({
					create: Effect.fn('Sessions.create')(
						function* (user, address, browser) {
							const secret = Base64Url.encode(yield* random.randomBytes(32))
							const now = yield* DateTime.now
							yield* insert({address, browser, createdAt: now, id: yield* hash(secret), lastSeenAt: now, userId: user})
							return secret
						},
						mutate,
						asAuthError('Cannot create the session')
					),
					current: Effect.fn('Sessions.current')(function* (secret) {
						const id = yield* hash(secret)
						const now = DateTime.toEpochMillis(yield* DateTime.now)
						const since = DateTime.toEpochMillis(yield* cutoff)
						return yield* SqlSchema.findOneOption({
							Request: Schema.Void,
							Result: CookieSession,
							execute: () =>
								sql`UPDATE ${table} SET lastSeenAt = ${now} WHERE id = ${id} AND lastSeenAt > ${since} RETURNING *`
						})()
					}, asAuthError('Cannot read the session')),
					forget: Effect.fn('Sessions.forget')(
						function* (secret) {
							yield* sql`DELETE FROM ${table} WHERE id = ${yield* hash(secret)}`
						},
						mutate,
						asAuthError('Cannot sign out; no changes committed')
					),
					forgetPerson: Effect.fn('Sessions.forgetPerson')(
						function* (user) {
							yield* sql`DELETE FROM ${table} WHERE userId = ${user}`
						},
						mutate,
						asAuthError('Cannot sign out the person; no changes committed')
					),
					list: Effect.fn('Sessions.list')(function* (user) {
						const since = DateTime.toEpochMillis(yield* cutoff)
						return yield* SqlSchema.findAll({
							Request: Schema.Void,
							Result: CookieSession,
							execute: () =>
								sql`SELECT * FROM ${table} WHERE userId = ${user} AND lastSeenAt > ${since} ORDER BY lastSeenAt DESC`
						})()
					}, asAuthError('Cannot list sessions')),
					remove: Effect.fn('Sessions.remove')(
						function* (id: string, user: UserId) {
							yield* sql`DELETE FROM ${table} WHERE id = ${id} AND userId = ${user}`
						},
						mutate,
						asAuthError('Cannot sign out the session; no changes committed')
					)
				})
			})
		),
		Sessions.migrations
	)
}
