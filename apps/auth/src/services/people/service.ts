import {Boolean, Context, DateTime, Effect, Layer, Option, Schema, Stream, String, Struct, pipe} from 'effect'

import {SecureRandom} from 'effect/crypto'
import type {Headers} from 'effect/http'
import {Reactivity} from 'effect/reactivity'
import {Migrator, SqlClient, SqlModel, SqlSchema} from 'effect/sql'

import {Auth, adminIds, localAuth, requireAdmin} from '@deslop/runtime/server/auth'
import type {User} from '@deslop/runtime/shared/auth'
import {AuthError, DEVELOPER, UserId, bearerOf, isAdmin, asAuthError} from '@deslop/runtime/shared/auth'

import {RpcOwner} from '#rpcs/contracts.ts'
import {Passkeys} from '#services/passkeys/service.ts'
import {listPeople, ownerOf, personOf, roleOf} from '#services/people/lib/utils.ts'
import type {AdmitParams, GitHubUser, Person} from '#services/people/schema.ts'
import {Member, SignedAccount} from '#services/people/schema.ts'
import {randomTokenOf} from '#services/tokens/lib/utils.ts'
import {CurrentOwner, IncarnationId} from '#services/tokens/schema.ts'
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
		readonly watch: (user: User) => Stream.Stream<Person[], AuthError>
		readonly register: (github: GitHubUser) => Effect.Effect<CredentialOwner, AuthError>
		readonly remove: (id: UserId, user: User) => Effect.Effect<Person, AuthError>
	}
>()('@deslop/auth/services/people/service/People') {
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
				const admins = yield* adminIds
				const local = yield* localAuth
				const randomToken = randomTokenOf(yield* SecureRandom.SecureRandom)
				const withReactivity = Effect.provideService(Reactivity.Reactivity, yield* Reactivity.Reactivity)
				const developer = {incarnation: IncarnationId.make('local'), user: DEVELOPER}
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
				function member(id: UserId) {
					return Effect.catchNoSuchElement(members.findById(id))
				}
				// A local install's developer account keeps the one registration its sessions name; any other gets a fresh one.
				function incarnationOf(profile: GitHubUser) {
					if (local && profile.id === 0) return Effect.succeed(developer.incarnation)
					return Effect.map(randomToken(32), id => IncarnationId.make(id))
				}
				function existing(id: UserId) {
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
				}, asAuthError('Cannot read the account'))
				const sessionOwner = Effect.fnUntraced(function* (headers: Headers.Headers) {
					if (local) return developer
					return yield* allowed(yield* tokens.session(headers))
				})
				const admin = Effect.fn('People.admin')(function* (user: User) {
					yield* Effect.annotateCurrentSpan('userId', user.id)
					return yield* requireAdmin(admins, user, 'Only an admin can manage people')
				})
				const list = Effect.fn('People.list')(function* (user: User) {
					yield* admin(user)
					return listPeople(yield* listMembers(), admins)
				}, asAuthError('Cannot read people'))

				const people = People.of({
					// Read again when an account or a sign-in changes, so a sign-out elsewhere or an admission shows here.
					account: headers =>
						Stream.withSpan(
							sql.reactive(
								['people', 'tokens'],
								asAuthError('Cannot read the account')(
									Effect.gen(function* () {
										const session = yield* tokens.browserSession(headers)
										return Option.match(yield* currentOwner(session.owner), {
											onNone: () =>
												SignedAccount.make({
													...session.owner.user,
													fullName: Option.none(),
													role: roleOf(admins, session.owner.user.id, Option.none()),
													via: session.via
												}),
											onSome: row =>
												SignedAccount.make({...Struct.omit(personOf(admins, row), ['since']), via: session.via})
										})
									})
								)
							),
							'People.account',
							{attributes: {'rpc.stream': true}}
						),
					admin,
					// Each answer reads and changes the account in one transaction, so two answers to the same account cannot both apply.
					admit: Effect.fn('People.admit')(
						function* (params: AdmitParams, user: User) {
							yield* admin(user)
							const now = yield* DateTime.now
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
						asAuthError('Cannot answer the access request')
					),
					allowed,
					list,
					register: Effect.fn('People.register')(
						function* (profile: GitHubUser) {
							const id = UserId.make(`github:${profile.id}`)
							const fullName = Option.filter(profile.name, String.isNonEmpty)
							const since = yield* DateTime.now
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
						asAuthError('Cannot record the GitHub account')
					),
					remove: Effect.fn('People.remove')(
						function* (id: UserId, user: User) {
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
						asAuthError('Cannot remove this account')
					),
					watch: user =>
						Stream.withSpan(sql.reactive(['people'], list(user)), 'People.watch', {
							attributes: {'rpc.stream': true, userId: user.id}
						})
				})
				return Context.add(
					Context.make(People, people),
					RpcOwner,
					RpcOwner.of((effect, request) =>
						Effect.flatMap(sessionOwner(request.headers), owner => Effect.provideService(effect, CurrentOwner, owner))
					)
				)
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
				token: Effect.fn('Auth.token')(function* (headers: Headers.Headers) {
					return yield* asAuthError('Sign in first')(Effect.fromOption(bearerOf(headers)))
				}),
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
