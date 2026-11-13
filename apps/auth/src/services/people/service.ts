import type {Stream} from 'effect'
import {Boolean, Clock, Context, Effect, Layer, Option, Schema, String, Struct, pipe} from 'effect'

import {SecureRandom} from 'effect/crypto'
import type {Headers} from 'effect/http'
import {Reactivity} from 'effect/reactivity'
import {Migrator, SqlClient, SqlModel, SqlSchema} from 'effect/sql'

import {Auth, adminIds, localAuth, requireAdmin} from '@deslop/runtime/server/auth'
import type {User} from '@deslop/runtime/shared/auth'
import {AuthError, DEVELOPER, bearerOf, isAdmin, rejected} from '@deslop/runtime/shared/auth'

import {RpcOwner} from '#rpcs/contracts.ts'
import {GitHub} from '#services/github/service.ts'
import {Passkeys} from '#services/passkeys/service.ts'
import {listPeople, ownerOf, personOf, roleOf} from '#services/people/lib/utils.ts'
import type {AdmitParams, GitHubUser, Person} from '#services/people/schema.ts'
import {Member, SignedAccount} from '#services/people/schema.ts'
import {randomTokenOf} from '#services/tokens/lib/utils.ts'
import {CurrentOwner} from '#services/tokens/schema.ts'
import type {CredentialOwner} from '#services/tokens/schema.ts'
import {Tokens} from '#services/tokens/service.ts'

declare module 'effect/reactivity/Reactivity' {
	interface Keys {
		readonly people: never
	}
}

export class People extends Context.Service<
	People,
	{
		readonly account: (headers: Headers.Headers) => Stream.Stream<SignedAccount, AuthError>
		readonly admin: (user: User) => Effect.Effect<void, AuthError>
		readonly admit: (params: AdmitParams, user: User) => Effect.Effect<Person, AuthError>
		readonly allowed: (owner: CredentialOwner) => Effect.Effect<CredentialOwner, AuthError>
		readonly list: (user: User) => Effect.Effect<Person[], AuthError>
		readonly people: (user: User) => Stream.Stream<Person[], AuthError>
		readonly register: (github: GitHubUser) => Effect.Effect<CredentialOwner, AuthError>
		readonly remove: (id: string, user: User) => Effect.Effect<Person, AuthError>
	}
>('@deslop/auth/services/people/service/People') {
	// The table this service owns, made at start; one statement per `sql` call, since SQLite runs only the first statement of a string.
	static readonly migrations = Layer.effectDiscard(
		Migrator.make({})({
			loader: Migrator.fromRecord({
				'0001_members': Effect.flatMap(
					SqlClient.SqlClient,
					sql => sql`
						CREATE TABLE members (
							id TEXT PRIMARY KEY,
							name TEXT NOT NULL,
							fullName TEXT,
							incarnation TEXT NOT NULL,
							since INTEGER NOT NULL,
							status TEXT NOT NULL
						) STRICT
					`
				)
			}),
			table: 'members_migrations'
		})
	)

	static readonly layer = Layer.provide(
		Layer.effectContext(
			Effect.gen(function* () {
				const sql = yield* SqlClient.SqlClient
				const tokens = yield* Tokens
				const passkeys = yield* Passkeys
				const github = yield* GitHub
				const admins = yield* adminIds
				const local = yield* localAuth
				const randomToken = randomTokenOf(yield* SecureRandom.SecureRandom)
				const withReactivity = Effect.provideService(Reactivity.Reactivity, yield* Reactivity.Reactivity)
				const developer = {incarnation: 'local', user: DEVELOPER}
				const members = yield* SqlModel.makeRepository(Member, {
					idColumn: 'id',
					spanPrefix: 'People',
					tableName: Member.table
				})
				const listMembers = SqlSchema.findAll({
					Request: Schema.Void,
					Result: Member,
					// Newest first; of two at the same moment, the one recorded later.
					execute: () => sql`SELECT * FROM ${sql(Member.table)} ORDER BY since DESC, rowid DESC`
				})
				// An admin's answer lets the account in from now on.
				const allowMember = SqlSchema.findOne({
					Request: Schema.Struct(Struct.pick(Member.update.fields, ['id', 'since'])),
					Result: Member,
					execute: request => sql`
						UPDATE ${sql(Member.table)} SET status = ${'Allowed' satisfies Member['status']}, since = ${request.since}
						WHERE id = ${request.id}
						RETURNING *
					`
				})
				// Each sign-in takes the account's current GitHub login and name.
				const renameMember = SqlSchema.findOne({
					Request: Schema.Struct(Struct.pick(Member.update.fields, ['fullName', 'id', 'name'])),
					Result: Member,
					execute: request => sql`
						UPDATE ${sql(Member.table)} SET ${sql.update(request, ['id'])} WHERE id = ${request.id} RETURNING *
					`
				})
				// An admin's profile is added once; a sign-in that recorded the admin meanwhile is kept.
				const addAdmin = SqlSchema.void({
					Request: Member.insert,
					execute: row => sql`INSERT INTO ${sql(Member.table)} ${sql.insert(row)} ON CONFLICT (id) DO NOTHING`
				})
				function member(id: string) {
					return Effect.catchNoSuchElement(members.findById(id))
				}
				// A local install's developer account keeps the one registration its sessions name; any other gets a fresh one.
				function incarnationOf(profile: GitHubUser) {
					if (local && profile.id === 0) return Effect.succeed(developer.incarnation)
					return randomToken(32)
				}
				function existing(id: string) {
					return Effect.flatMap(member(id), Effect.fromOption)
				}
				const currentOwner = Effect.fnUntraced(function* (owner: CredentialOwner) {
					const row = yield* member(owner.user.id)
					if (local && owner.user.id === DEVELOPER.id && owner.incarnation === developer.incarnation) return row
					if (!Option.exists(row, found => found.incarnation === owner.incarnation)) {
						return yield* AuthError.make({
							error: 'invalid_grant',
							message: 'This account registration ended. Sign in again.'
						})
					}
					return row
				})
				const allowed = Effect.fn('People.allowed')(function* (owner: CredentialOwner) {
					if (roleOf(admins, owner.user.id, yield* currentOwner(owner)) === 'Waiting') {
						return yield* AuthError.make({
							error: 'access_denied',
							message: 'An admin has not allowed this GitHub account yet'
						})
					}
					return owner
				}, rejected('Cannot read the account'))
				const sessionOwner = Effect.fnUntraced(function* (headers: Headers.Headers) {
					if (local) return developer
					return yield* allowed(yield* tokens.session(headers))
				})
				function admin(user: User) {
					return requireAdmin(admins, user, 'Only an admin can manage people')
				}
				const list = Effect.fn('People.list')(function* (user: User) {
					yield* admin(user)
					return listPeople(yield* listMembers(), admins)
				}, rejected('Cannot read people'))

				// An admin who has not signed in since GITHUB_ADMINS named them still shows their GitHub profile.
				yield* pipe(
					Effect.forEach(
						admins,
						Effect.fnUntraced(function* (id) {
							if (Option.isSome(yield* member(`github:${id}`))) return
							const profile = yield* github.profile(id)
							yield* pipe(
								addAdmin({
									fullName: Option.filter(Option.fromNullishOr(profile.name), String.isNonEmpty),
									id: `github:${profile.id}`,
									incarnation: yield* incarnationOf(profile),
									name: profile.login,
									since: yield* Clock.currentTimeMillis,
									status: 'Allowed'
								}),
								Reactivity.mutation(['people'])
							)
						}),
						{concurrency: 1, discard: true}
					),
					Effect.ignore({log: 'Warn', message: 'The admins’ GitHub profiles could not be read'}),
					Effect.forkScoped
				)

				const people = People.of({
					// Read again when an account or a sign-in changes, so a sign-out elsewhere or an admission shows here.
					account: headers =>
						sql.reactive(
							['people', 'tokens'],
							(rejected('Cannot read the account'))(Effect.gen(function* () {
									const session = yield* tokens.browserSession(headers)
									return Option.match(yield* currentOwner(session.owner), {
										onNone: () =>
											SignedAccount.make({
												...session.owner.user,
												role: roleOf(admins, session.owner.user.id, Option.none()),
												via: session.via
											}),
										onSome: row =>
											SignedAccount.make({...Struct.omit(personOf(admins, row), ['since']), via: session.via})
									})
								}))
						),
					admin,
					// Each answer reads and changes the account in one transaction, so two answers to the same account cannot both apply.
					admit: Effect.fn('People.admit')(
						function* (params: AdmitParams, user: User) {
							yield* admin(user)
							const now = yield* Clock.currentTimeMillis
							const answered = yield* pipe(
								Effect.gen(function* () {
									const row = yield* existing(params.id)
									if (roleOf(admins, row.id, Option.some(row)) !== 'Waiting') {
										return yield* AuthError.make({message: 'This account is not asking for access'})
									}
									if (params.allow) return yield* allowMember({id: row.id, since: now})
									yield* members.delete(row.id)
									return row
								}),
								Reactivity.mutation(['people']),
								sql.withTransaction
							)
							// A declined account is signed out and loses its passkeys, so it can sign in again to ask again.
							if (!params.allow) {
								yield* tokens.forget(ownerOf(answered))
								yield* passkeys.forget(ownerOf(answered))
							}
							return personOf(admins, answered)
						},
						withReactivity,
						rejected('Cannot answer the access request')
					),
					allowed,
					list,
					people: user => sql.reactive(['people'], list(user)),
					register: Effect.fn('People.register')(
						function* (profile: GitHubUser) {
							const id = `github:${profile.id}`
							const fullName = Option.filter(Option.fromNullishOr(profile.name), String.isNonEmpty)
							const since = yield* Clock.currentTimeMillis
							const row = yield* pipe(
								member(id),
								Effect.flatMap(
									Option.match({
										onNone: () =>
											Effect.flatMap(incarnationOf(profile), incarnation =>
												members.insert({
													fullName,
													id,
													incarnation,
													name: profile.login,
													since,
													status: Boolean.match(isAdmin(admins, id), {
														onFalse: () => 'Waiting' as const,
														onTrue: () => 'Allowed' as const
													})
												})
											),
										onSome: () => renameMember({fullName, id, name: profile.login})
									})
								),
								Reactivity.mutation(['people']),
								sql.withTransaction
							)
							return ownerOf(row)
						},
						withReactivity,
						rejected('Cannot record the GitHub account')
					),
					remove: Effect.fn('People.remove')(
						function* (id: string, user: User) {
							yield* admin(user)
							if (roleOf(admins, id, Option.none()) === 'Admin') {
								return yield* AuthError.make({
									message: 'Admins come from GITHUB_ADMINS, so they cannot be removed here'
								})
							}
							const removed = yield* pipe(
								existing(id),
								Effect.tap(row => members.delete(row.id)),
								Reactivity.mutation(['people']),
								sql.withTransaction
							)
							// Membership commits first. Cleanup is scoped to its incarnation and cannot remove a concurrent new registration.
							yield* tokens.forget(ownerOf(removed))
							yield* passkeys.forget(ownerOf(removed))
							return personOf(admins, removed)
						},
						withReactivity,
						rejected('Cannot remove this account')
					)
				})
				return Context.add(Context.make(People, people), RpcOwner, RpcOwner.of((effect, request) =>
							Effect.flatMap(sessionOwner(request.headers), owner => Effect.provideService(effect, CurrentOwner, owner))
						))
			})
		),
		this.migrations
	)
}

export const layerIssuerAuth = Layer.effectContext(
	Effect.gen(function* () {
		const tokens = yield* Tokens
		const people = yield* People
		const local = yield* localAuth
		return Auth.makeContext(
			Auth.of({
				token: (headers: Headers.Headers) => rejected('Sign in first')(Effect.fromOption(bearerOf(headers))),
				user: Effect.fn('Auth.user')(function* (headers: Headers.Headers) {
					if (local) return DEVELOPER
					return (yield* people.allowed(
						yield* Boolean.match(headers['authorization'] !== undefined, {
							onFalse: () => tokens.session(headers),
							onTrue: () => tokens.verify(headers)
						})
					)).user
				})
			})
		)
	})
)
