import {
	Array,
	Boolean,
	Config,
	Context,
	DateTime,
	Effect,
	HashSet,
	Layer,
	Number,
	Option,
	Order,
	Schema,
	String,
	Struct,
	pipe
} from 'effect'

import {Reactivity} from 'effect/reactivity'
import {SqlClient, SqlSchema} from 'effect/sql'

import {localAuth} from '@deslop/runtime/server/auth'
import {AuthError, GitHubId, GitHubIdFromString, UserId, asAuthError} from '@deslop/runtime/shared/auth'
import type {Admin} from '@deslop/runtime/shared/auth'

import {Person, Binding, Member} from './contract.ts'
import type {AdmitParams, Role} from './contract.ts'
import {peopleMigrations} from './migrations.ts'

import {Sessions} from '#sessions/server.ts'
import {TailnetUserId} from '#tailnet/contract.ts'

const ROLE_ORDER = {Admin: 1, Member: 2, Waiting: 0} satisfies Record<Role, number>

// GitHub ids from GITHUB_ADMINS; a local install with none named treats the developer as the admin.
export const adminIds = Effect.gen(function* () {
	const listed = Config.Array(GitHubIdFromString, 'GITHUB_ADMINS')
	if (yield* localAuth) return yield* Config.withDefault(listed, [GitHubId.make(0)])
	return yield* listed
})

function isAdmin(admins: readonly GitHubId[], id: UserId) {
	return Array.some(admins, admin => `github:${admin}` === id)
}

// A browser enters only once an admin allowed it; the tailnet, and an app acting for someone, need only a tailnet sighting.
function isLetIn(member: Member, browser: boolean) {
	return Option.contains(member.status, 'Allowed') || (!browser && member.tailnet)
}

export const authorizeMember = Effect.fnUntraced(function* (
	admins: readonly GitHubId[],
	id: UserId,
	row: Option.Option<Member>,
	browser: boolean
) {
	if (isAdmin(admins, id)) {
		return {admin: true, id, name: Option.match(row, {onNone: () => id, onSome: member => member.name})}
	}
	return yield* pipe(
		row,
		Option.filter(member => isLetIn(member, browser)),
		Option.match({
			onNone: () => AuthError.make({error: 'access_denied', message: 'An admin has not allowed this account yet'}),
			onSome: member => Effect.succeed({admin: false, id: member.id, name: member.name})
		})
	)
})

export function roleOf(admins: readonly GitHubId[], id: UserId, row: Option.Option<Member>, browser: boolean) {
	if (isAdmin(admins, id)) return 'Admin' as const
	if (Option.exists(row, found => isLetIn(found, browser))) return 'Member' as const
	return 'Waiting' as const
}

// People lists someone as waiting only while their browser asks, whatever the tailnet lets them do.
function listedRoleOf(admins: readonly GitHubId[], row: Member) {
	if (isAdmin(admins, row.id)) return 'Admin' as const
	if (Option.contains(row.status, 'Waiting')) return 'Waiting' as const
	return 'Member' as const
}

function personOf(admins: readonly GitHubId[], row: Member) {
	return Person.make({
		admin: isAdmin(admins, row.id),
		...Struct.pick(row, ['id', 'name']),
		fullName: Option.filter(row.fullName, String.isNonEmpty),
		role: listedRoleOf(admins, row),
		since: row.since
	})
}

// The accounts asking for access first, then admins, then members, each newest first as the rows come.
function listPeople(rows: readonly Member[], admins: readonly GitHubId[]) {
	const known = Array.map(rows, row => personOf(admins, row))
	const knownIds = HashSet.fromIterable(Array.map(known, person => person.id))
	return Array.sort(
		[
			...pipe(
				admins,
				Array.filter(id => !HashSet.has(knownIds, `github:${id}`)),
				Array.map(id =>
					Person.make({
						admin: true,
						fullName: Option.none(),
						id: UserId.make(`github:${id}`),
						name: `GitHub ${id}`,
						role: 'Admin',
						since: Option.none()
					})
				)
			),
			...known
		],
		Order.mapInput(Number.Order, (person: Person) => ROLE_ORDER[person.role])
	)
}

declare module 'effect/reactivity/Reactivity' {
	interface Keys {
		readonly people: never
	}
}
export class People extends Context.Service<
	People,
	{
		readonly find: (id: UserId) => Effect.Effect<Option.Option<Member>, AuthError>
		readonly bound: (tailnetId: TailnetUserId) => Effect.Effect<Option.Option<Member>, AuthError>
		readonly bind: (tailnetId: TailnetUserId, id: UserId) => Effect.Effect<void, AuthError>
		readonly register: (
			user: {readonly id: UserId; readonly name: string},
			fullName: Option.Option<string>,
			tailnet: boolean
		) => Effect.Effect<Member, AuthError>
		readonly list: (admin: Admin) => Effect.Effect<Person[], AuthError>
		readonly admit: (params: AdmitParams, admin: Admin) => Effect.Effect<Person, AuthError>
		readonly remove: (id: UserId, admin: Admin) => Effect.Effect<Person, AuthError>
	}
>()('@deslop/auth/people/server/People') {
	static readonly migrations = peopleMigrations

	static readonly layer = Layer.provide(
		Layer.effect(
			People,
			Effect.gen(function* () {
				const sql = yield* SqlClient.SqlClient
				const admins = yield* adminIds
				const reactivity = yield* Reactivity.Reactivity
				const sessions = yield* Sessions
				const table = sql(Member.table)
				const bindings = sql(Binding.table)
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
				const find = Effect.fn('People.find')(findRow, asAuthError('Cannot read the person'))
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
				const boundRow = SqlSchema.findOneOption({
					Request: TailnetUserId,
					Result: Member,
					execute: tailnetId =>
						sql`SELECT ${table}.* FROM ${table} JOIN ${bindings} ON ${bindings}.userId = ${table}.id WHERE ${bindings}.tailnetId = ${tailnetId}`
				})
				const removeRow = Effect.fnUntraced(function* (id: UserId) {
					yield* sessions.forgetPerson(id)
					// The next sighting of their tailnet user resolves it again; one whose lookup was already under way binds what that lookup answers.
					yield* sql`DELETE FROM ${bindings} WHERE userId = ${id}`
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
					bind: Effect.fn('People.bind')(function* (tailnetId, id) {
						// Only a person still here is bound, and a first binding is never replaced.
						yield* sql`INSERT INTO ${bindings} (tailnetId, userId) SELECT ${tailnetId}, id FROM ${table} WHERE id = ${id} ON CONFLICT DO NOTHING`
					}, asAuthError('Cannot bind the tailnet user')),
					bound: Effect.fn('People.bound')(boundRow, asAuthError('Cannot read the tailnet user')),
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
