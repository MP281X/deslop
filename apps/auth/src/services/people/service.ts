import {Boolean, Config, Context, DateTime, Effect, Layer, Option, Schema, String, pipe} from 'effect'

import {Reactivity} from 'effect/reactivity'
import {Migrator, SqlClient, SqlSchema} from 'effect/sql'

import {localAuth} from '@deslop/runtime/server/auth'
import {AuthError, GitHubId, GitHubIdFromString, UserId, asAuthError} from '@deslop/runtime/shared/auth'
import type {Admin} from '@deslop/runtime/shared/auth'

import {isAdmin, listPeople, personOf} from './lib/utils.ts'
import {Member} from './schema.ts'
import type {AdmitParams, Person} from './schema.ts'

import {Sessions} from '#services/sessions/service.ts'

// GitHub ids from GITHUB_ADMINS; a local install with none named treats the developer as the admin.
export const adminIds = Effect.gen(function* () {
	const listed = Config.Array(GitHubIdFromString, 'GITHUB_ADMINS')
	if (yield* localAuth) return yield* Config.withDefault(listed, [GitHubId.make(0)])
	return yield* listed
})

declare module 'effect/reactivity/Reactivity' {
	interface Keys {
		readonly people: never
	}
}
export class People extends Context.Service<
	People,
	{
		readonly find: (id: UserId) => Effect.Effect<Option.Option<Member>, AuthError>
		readonly register: (
			user: {readonly id: UserId; readonly name: string},
			fullName: Option.Option<string>,
			tailnet: boolean
		) => Effect.Effect<Member, AuthError>
		readonly list: (admin: Admin) => Effect.Effect<Person[], AuthError>
		readonly admit: (params: AdmitParams, admin: Admin) => Effect.Effect<Person, AuthError>
		readonly remove: (id: UserId, admin: Admin) => Effect.Effect<Person, AuthError>
	}
>()('@deslop/auth/services/people/service/People') {
	static readonly migrations = Layer.effectDiscard(
		Migrator.make({})({
			loader: Migrator.fromRecord({
				'0001_members': Effect.flatMap(
					SqlClient.SqlClient,
					sql =>
						sql`CREATE TABLE members (id TEXT PRIMARY KEY, name TEXT NOT NULL, fullName TEXT, incarnation TEXT NOT NULL, since INTEGER NOT NULL, status TEXT NOT NULL) STRICT`
				),
				'0002_identity': Effect.gen(function* () {
					const sql = yield* SqlClient.SqlClient
					for (const table of [
						'browser_sessions',
						'app_grants',
						'spent_refresh_tokens',
						'signing_keys',
						'passkeys',
						'apps',
						'tokens_migrations',
						'passkeys_migrations',
						'apps_migrations'
					]) {
						yield* sql`DROP TABLE IF EXISTS ${sql(table)}`
					}
					yield* sql`ALTER TABLE members DROP COLUMN incarnation`
				}),
				'0003_nullable_since': Effect.gen(function* () {
					const sql = yield* SqlClient.SqlClient
					yield* sql`CREATE TABLE members_next (id TEXT PRIMARY KEY, name TEXT NOT NULL, fullName TEXT, since INTEGER, status TEXT NOT NULL) STRICT`
					yield* sql`INSERT INTO members_next SELECT id, name, fullName, NULLIF(since, 0), status FROM members`
					yield* sql`DROP TABLE members`
					yield* sql`ALTER TABLE members_next RENAME TO members`
				}),
				// A tailnet sighting stops approving the browser: the browser's status may be none and the sighting is its own column. Every row keeps its status, so whoever enters from a browser still does; no waiting row was seen on the tailnet, which made it Allowed, and an allowed one is marked at its next sighting.
				'0004_tailnet': Effect.gen(function* () {
					const sql = yield* SqlClient.SqlClient
					yield* sql`CREATE TABLE members_next (id TEXT PRIMARY KEY, name TEXT NOT NULL, fullName TEXT, since INTEGER, status TEXT, tailnet INTEGER NOT NULL) STRICT`
					yield* sql`INSERT INTO members_next SELECT id, name, fullName, since, status, 0 FROM members ORDER BY rowid`
					yield* sql`DROP TABLE members`
					yield* sql`ALTER TABLE members_next RENAME TO members`
				})
			}),
			table: 'members_migrations'
		})
	)
	static readonly layer = Layer.provide(
		Layer.effect(
			People,
			Effect.gen(function* () {
				const sql = yield* SqlClient.SqlClient
				const admins = yield* adminIds
				const reactivity = yield* Reactivity.Reactivity
				const sessions = yield* Sessions
				const table = sql(Member.table)
				function mutate<A, E, R>(effect: Effect.Effect<A, E, R>) {
					return pipe(
						effect,
						Reactivity.mutation(['people', 'sessions']),
						Effect.provideService(Reactivity.Reactivity, reactivity)
					)
				}
				const findRow = SqlSchema.findOneOption({
					Request: UserId,
					Result: Member,
					execute: id => sql`SELECT * FROM ${table} WHERE id = ${id}`
				})
				const find = Effect.fn('People.find')(function* (id: UserId) {
					return yield* findRow(id)
				}, asAuthError('Cannot read the person'))
				function existing(id: UserId) {
					return Effect.flatMap(find(id), Effect.fromOption)
				}
				const all = SqlSchema.findAll({
					Request: Schema.Void,
					Result: Member,
					execute: () => sql`SELECT * FROM ${table} ORDER BY since DESC, rowid DESC`
				})
				const upsert = SqlSchema.void({
					Request: Member.insert,
					execute: row =>
						sql`INSERT INTO ${table} ${sql.insert(row)} ON CONFLICT (id) DO UPDATE SET name = excluded.name, fullName = excluded.fullName, status = excluded.status, tailnet = excluded.tailnet`
				})
				const removeRow = Effect.fnUntraced(function* (id: UserId) {
					yield* sessions.forgetPerson(id)
					yield* sql`DELETE FROM ${table} WHERE id = ${id}`
				})
				return People.of({
					admit: Effect.fn('People.admit')(
						function* (params) {
							const row = yield* existing(params.id)
							if (!Option.contains(row.status, 'Waiting') || isAdmin(admins, row.id)) {
								return yield* AuthError.make({message: 'This account is not asking for access'})
							}
							if (params.allow) {
								yield* sql`UPDATE ${table} SET status = 'Allowed', since = ${DateTime.toEpochMillis(yield* DateTime.now)} WHERE id = ${params.id}`
							} else if (row.tailnet) {
								// Declining takes back only what the browser asked for: the tailnet still lets them in.
								yield* sessions.forgetPerson(params.id)
								yield* sql`UPDATE ${table} SET status = NULL WHERE id = ${params.id}`
							} else {
								yield* removeRow(params.id)
							}
							return personOf(
								admins,
								yield* Boolean.match(params.allow || row.tailnet, {
									onFalse: () => Effect.succeed(row),
									onTrue: () => existing(params.id)
								})
							)
						},
						mutate,
						sql.withTransaction,
						asAuthError('Cannot answer the access request')
					),
					find,
					list: Effect.fn('People.list')(function* () {
						return listPeople(yield* all(), admins)
					}, asAuthError('Cannot read people')),
					register: Effect.fn('People.register')(
						function* (user, profileName, tailnet) {
							// An empty name is stored as none, so it is compared as none: an unchanged person costs no write.
							const fullName = Option.filter(profileName, String.isNonEmpty)
							const row = yield* find(user.id)
							// A GitHub sign-in asks an admin to allow the browser; a tailnet sighting leaves that answer as it is.
							const status = Boolean.match(
								isAdmin(admins, user.id) || Option.exists(row, member => Option.contains(member.status, 'Allowed')),
								{
									onFalse: () =>
										Boolean.match(tailnet, {
											onFalse: () => Option.some('Waiting' as const),
											onTrue: () => Option.flatMap(row, member => member.status)
										}),
									onTrue: () => Option.some('Allowed' as const)
								}
							)
							const seen = tailnet || Option.exists(row, member => member.tailnet)
							if (
								Option.exists(
									row,
									member =>
										member.name === user.name &&
										Option.getOrUndefined(member.fullName) === Option.getOrUndefined(fullName) &&
										Option.getOrUndefined(member.status) === Option.getOrUndefined(status) &&
										member.tailnet === seen
								)
							) {
								return yield* Effect.fromOption(row)
							}
							yield* mutate(
								upsert({
									fullName,
									id: user.id,
									name: user.name,
									since: Option.some(yield* DateTime.now),
									status,
									tailnet: seen
								})
							)
							return yield* existing(user.id)
						},
						sql.withTransaction,
						asAuthError('Cannot register the person')
					),
					remove: Effect.fn('People.remove')(
						function* (id) {
							if (isAdmin(admins, id)) {
								return yield* AuthError.make({error: 'access_denied', message: 'Admins cannot be removed'})
							}
							const row = yield* existing(id)
							yield* removeRow(id)
							return personOf(admins, row)
						},
						mutate,
						sql.withTransaction,
						asAuthError('Cannot remove the person; no changes committed')
					)
				})
			})
		),
		People.migrations
	)
}
