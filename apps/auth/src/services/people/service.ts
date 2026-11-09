import {Array, Boolean, Clock, Context, Effect, Layer, Option, Stream, Struct, SubscriptionRef, pipe} from 'effect'

import {SecureRandom} from 'effect/crypto'
import type {Headers} from 'effect/http'
import {KeyValueStore} from 'effect/persistence'

import type {User} from '@deslop/runtime/auth/schema'
import {AuthError} from '@deslop/runtime/auth/schema'
import {Auth} from '@deslop/runtime/auth/service'
import {DEVELOPER, adminIds, bearerOf, isAdmin, localAuth, rejected} from '@deslop/runtime/auth/utils'

import {RpcOwner} from '#rpcs/contracts.ts'
import {GitHub} from '#services/github/service.ts'
import {Passkeys} from '#services/passkeys/service.ts'
import {admission, listPeople, ownerOf, personOf, registerMember, roleOf} from '#services/people/lib/utils.ts'
import type {AdmitParams, GitHubUser, Person} from '#services/people/schema.ts'
import {Members, SignedAccount} from '#services/people/schema.ts'
import {randomTokenOf} from '#services/tokens/lib/utils.ts'
import {CurrentOwner} from '#services/tokens/schema.ts'
import type {CredentialOwner} from '#services/tokens/schema.ts'
import {Tokens} from '#services/tokens/service.ts'

function member(id: string, current: Members) {
	return Array.findFirst(current, row => row.id === id)
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
>()('@deslop/auth/services/people/service/People') {
	static readonly layer = Layer.effectContext(
		Effect.gen(function* () {
			const store = KeyValueStore.toSchemaStore(yield* KeyValueStore.KeyValueStore, Members)
			const state = yield* SubscriptionRef.make<Members>(Option.getOrElse(yield* store.get('members'), () => []))
			const tokens = yield* Tokens
			const passkeys = yield* Passkeys
			const github = yield* GitHub
			const admins = yield* adminIds
			const local = yield* localAuth
			const randomToken = randomTokenOf(yield* SecureRandom.SecureRandom)
			const developer = {incarnation: 'local', user: DEVELOPER}
			// Every change saves the next members before memory and the live views see them.
			const transact = Effect.fnUntraced(function* <A, E>(
				change: (current: Members) => Effect.Effect<readonly [A, Members], E>
			) {
				return yield* SubscriptionRef.modifyEffect(state, current =>
					Effect.tap(change(current), result => store.set('members', result[1]))
				)
			}, Effect.uninterruptible)
			const currentOwner = Effect.fnUntraced(function* (owner: CredentialOwner) {
				const row = member(owner.user.id, yield* SubscriptionRef.get(state))
				if (local && owner.user.id === DEVELOPER.id && owner.incarnation === developer.incarnation) return row
				if (
					!Option.match(row, {
						onNone: () => isAdmin(admins, owner.user.id) && owner.incarnation === 'legacy',
						onSome: found => found.incarnation === owner.incarnation
					})
				) {
					return yield* AuthError.make({
						error: 'invalid_grant',
						message: 'This account registration ended. Sign in again.'
					})
				}
				return row
			})
			const allowed = Effect.fnUntraced(function* (owner: CredentialOwner) {
				if (roleOf(admins, owner.user.id, yield* currentOwner(owner)) === 'Waiting') {
					return yield* AuthError.make({
						error: 'access_denied',
						message: 'An admin has not allowed this GitHub account yet'
					})
				}
				return owner
			})
			const sessionOwner = Effect.fnUntraced(function* (headers: Headers.Headers) {
				if (local) return developer
				return yield* allowed(yield* tokens.session(headers))
			})
			const admin = Effect.fnUntraced(function* (user: User) {
				if (!isAdmin(admins, user.id)) {
					return yield* AuthError.make({error: 'access_denied', message: 'Only an admin can manage people'})
				}
			})
			// Admins first, then the accounts asking for access, then members, each newest first.
			const list = Effect.fn('People.list')(function* (user: User) {
				yield* admin(user)
				return listPeople(yield* SubscriptionRef.get(state), admins)
			}, rejected('Cannot read people'))

			// An admin who has not signed in since GITHUB_ADMINS named them still shows their GitHub profile.
			yield* pipe(
				Effect.forEach(
					admins,
					Effect.fnUntraced(function* (id) {
						if (Option.isSome(member(`github:${id}`, yield* SubscriptionRef.get(state)))) return
						const profile = yield* github.profile(id)
						const since = yield* Clock.currentTimeMillis
						yield* transact(current => {
							if (Option.isSome(member(`github:${profile.id}`, current))) {
								return Effect.succeed([undefined, current] as const)
							}
							return Effect.succeed([
								undefined,
								[
									...current,
									{
										fullName: profile.name ?? '',
										id: `github:${profile.id}`,
										incarnation: Boolean.match(local, {onFalse: () => 'legacy', onTrue: () => 'local'}),
										name: profile.login,
										since,
										status: 'Allowed'
									}
								]
							] as const)
						})
					}),
					{concurrency: 1, discard: true}
				),
				Effect.ignore({log: 'Warn', message: 'The admins’ GitHub profiles could not be read'}),
				Effect.forkScoped
			)

			const people = People.of({
				// Read again when the account's role or its sessions change, so a sign-out elsewhere or an admission shows here.
				account: headers =>
					pipe(
						Stream.merge(
							Stream.map(SubscriptionRef.changes(state), () => undefined),
							tokens.changes
						),
						Stream.mapEffect(() =>
							pipe(
								Effect.gen(function* () {
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
								}),
								rejected('Cannot read the account')
							)
						)
					),
				admin,
				// Each answer reads and changes the account in one transaction, so two answers to the same account cannot both apply.
				admit: Effect.fn('People.admit')(function* (params: AdmitParams, user: User) {
					yield* admin(user)
					const now = yield* Clock.currentTimeMillis
					const result = yield* transact(current => Effect.fromResult(admission(current, admins, params, now)))
					// A declined account is signed out and loses its passkeys, so it can sign in again to ask again.
					if (!params.allow) {
						yield* tokens.forget(result.owner)
						yield* passkeys.forget(result.owner)
					}
					return result.person
				}, rejected('Cannot answer the access request')),
				allowed: Effect.fn('People.allowed')(allowed),
				list,
				people: user => Stream.mapEffect(SubscriptionRef.changes(state), () => list(user)),
				register: Effect.fn('People.register')(function* (profile: GitHubUser) {
					const since = yield* Clock.currentTimeMillis
					return yield* transact(current =>
						Effect.gen(function* () {
							return registerMember(
								current,
								admins,
								profile,
								since,
								yield* Option.match(member(`github:${profile.id}`, current), {
									onNone: () => {
										if (local && profile.id === 0) return Effect.succeed('local')
										return randomToken(32)
									},
									onSome: row => Effect.succeed(row.incarnation)
								})
							)
						})
					)
				}, rejected('Cannot record the GitHub account')),
				remove: Effect.fn('People.remove')(function* (id: string, user: User) {
					yield* admin(user)
					if (roleOf(admins, id, Option.none()) === 'Admin') {
						return yield* AuthError.make({message: 'Admins come from GITHUB_ADMINS, so they cannot be removed here'})
					}
					const removed = yield* transact(current =>
						Effect.gen(function* () {
							return [
								yield* Effect.fromOption(member(id, current)),
								Array.filter(current, row => row.id !== id)
							] as const
						})
					)
					// Membership commits first. Cleanup is scoped to its incarnation and cannot remove a concurrent new registration.
					yield* tokens.forget(ownerOf(removed))
					yield* passkeys.forget(ownerOf(removed))
					return personOf(admins, removed)
				}, rejected('Cannot remove this account'))
			})
			return pipe(
				Context.make(People, people),
				Context.add(
					RpcOwner,
					RpcOwner.of((effect, request) =>
						Effect.flatMap(sessionOwner(request.headers), owner => Effect.provideService(effect, CurrentOwner, owner))
					)
				)
			)
		})
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
