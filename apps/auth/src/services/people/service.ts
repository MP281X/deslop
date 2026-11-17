import {Boolean, Config, Context, DateTime, Effect, Function, Layer, Option, Schema, String, pipe} from 'effect'

import {Reactivity} from 'effect/reactivity'
import {Migrator, SqlClient, SqlSchema} from 'effect/sql'

import {localAuth, requireAdmin} from '@deslop/runtime/server/auth'
import {AuthError, GitHubId, GitHubIdFromString, UserId, asAuthError} from '@deslop/runtime/shared/auth'
import type {User} from '@deslop/runtime/shared/auth'

import {authorizeMember, isAdmin, listPeople, personOf} from './lib/utils.ts'
import {Member} from './schema.ts'
import type {AdmitParams, Person} from './schema.ts'

import {CookieSessions} from '#services/cookie-sessions/service.ts'

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
		readonly login: (login: string) => Effect.Effect<Option.Option<Member>, AuthError>
		readonly register: (
			user: {readonly id: UserId; readonly name: string},
			fullName: Option.Option<string>,
			tailnet: boolean
		) => Effect.Effect<Member, AuthError>
		readonly allowed: (id: UserId) => Effect.Effect<User, AuthError>
		readonly list: (user: User) => Effect.Effect<Person[], AuthError>
		readonly admit: (params: AdmitParams, user: User) => Effect.Effect<Person, AuthError>
		readonly remove: (id: UserId, user: User) => Effect.Effect<Person, AuthError>
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
				const sessions = yield* CookieSessions
				const table = sql(Member.table)
				function mutate<A, E, R>(effect: Effect.Effect<A, E, R>) {
					return pipe(
						effect,
						Reactivity.mutation(['people', 'cookieSessions']),
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
				const removeRow = Effect.fnUntraced(function* (id: UserId) {
					yield* sessions.forgetPerson(id)
					yield* sql`DELETE FROM ${table} WHERE id = ${id}`
				})
				return People.of({
					admit: Effect.fn('People.admit')(
						function* (params, user) {
							yield* requireAdmin(user, 'Only an admin can manage people')
							const row = yield* existing(params.id)
							if (row.status !== 'Waiting' || isAdmin(admins, row.id)) {
								return yield* AuthError.make({message: 'This account is not asking for access'})
							}
							if (params.allow) {
								yield* sql`UPDATE ${table} SET status = 'Allowed', since = ${DateTime.toEpochMillis(yield* DateTime.now)} WHERE id = ${params.id}`
							} else {
								yield* removeRow(params.id)
							}
							return personOf(
								admins,
								yield* Boolean.match(params.allow, {
									onFalse: () => Effect.succeed(row),
									onTrue: () => existing(params.id)
								})
							)
						},
						mutate,
						sql.withTransaction,
						asAuthError('Cannot answer the access request')
					),
					allowed: Effect.fn('People.allowed')(function* (id) {
						return yield* authorizeMember(admins, id, yield* find(id))
					}, asAuthError('Cannot read the account')),
					find,
					list: Effect.fn('People.list')(function* (user) {
						yield* requireAdmin(user, 'Only an admin can manage people')
						return listPeople(yield* all(), admins)
					}, asAuthError('Cannot read people')),
					login: Effect.fn('People.login')(function* (login) {
						return yield* SqlSchema.findOneOption({
							Request: Schema.String,
							Result: Member,
							execute: name =>
								sql`SELECT * FROM ${table} WHERE id LIKE 'github:%' AND lower(name) = lower(${name}) LIMIT 1`
						})(login)
					}, asAuthError('Cannot read the person')),
					register: Effect.fn('People.register')(
						function* (user, fullName, tailnet) {
							const status = Boolean.match(tailnet || isAdmin(admins, user.id), {
								onFalse: Function.constant('Waiting'),
								onTrue: Function.constant('Allowed')
							})
							const row = yield* find(user.id)
							if (
								Option.exists(
									row,
									member =>
										member.name === user.name &&
										Option.getOrUndefined(member.fullName) === Option.getOrUndefined(fullName) &&
										(status === 'Waiting' || member.status === 'Allowed')
								)
							) {
								return yield* Effect.fromOption(row)
							}
							yield* mutate(
								sql`INSERT INTO ${table} (id, name, fullName, since, status) VALUES (${user.id}, ${user.name}, ${Option.getOrUndefined(Option.filter(fullName, String.isNonEmpty))}, ${DateTime.toEpochMillis(yield* DateTime.now)}, ${status}) ON CONFLICT (id) DO UPDATE SET name = excluded.name, fullName = excluded.fullName, status = CASE WHEN excluded.status = 'Allowed' THEN 'Allowed' ELSE ${table}.status END`
							)
							return yield* existing(user.id)
						},
						sql.withTransaction,
						asAuthError('Cannot register the person')
					),
					remove: Effect.fn('People.remove')(
						function* (id, user) {
							yield* requireAdmin(user, 'Only an admin can manage people')
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
