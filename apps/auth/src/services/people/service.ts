import {
	Array,
	Boolean,
	Clock,
	Config,
	Context,
	Effect,
	Layer,
	Number,
	Option,
	Order,
	Schema,
	Stream,
	String,
	Struct,
	SubscriptionRef,
	pipe
} from 'effect'

import type {Headers} from 'effect/http'
import {KeyValueStore} from 'effect/persistence'

import type {User} from '@deslop/runtime/auth/schema'
import {AuthError} from '@deslop/runtime/auth/schema'
import {Auth} from '@deslop/runtime/auth/service'

import {GitHub} from '#services/github/service.ts'
import type {AdmitParams, GitHubUser, MemberRow, Role} from '#services/people/schema.ts'
import {Account, Members, Person} from '#services/people/schema.ts'
import {Tokens} from '#services/tokens/service.ts'

const ROLE_ORDER = {Admin: 0, Member: 2, Waiting: 1} satisfies Record<Role, number>

function rejected(message: string) {
	return Effect.mapError(cause => {
		if (Schema.is(AuthError)(cause)) return cause
		return AuthError.make({cause, message})
	})
}

function memberOf(github: GitHubUser, since: number, status: MemberRow['status']) {
	return {fullName: github.name ?? '', id: `github:${github.id}`, name: github.login, since, status}
}

function member(id: string, current: Members) {
	return Array.findFirst(current, row => row.id === id)
}

export class People extends Context.Service<
	People,
	{
		readonly account: (headers: Headers.Headers) => Stream.Stream<Account, AuthError>
		readonly admin: (user: User) => Effect.Effect<void, AuthError>
		readonly admit: (params: AdmitParams, user: User) => Effect.Effect<Person, AuthError>
		readonly allowed: (user: User) => Effect.Effect<User, AuthError>
		readonly list: (user: User) => Effect.Effect<Person[], AuthError>
		readonly people: (user: User) => Stream.Stream<Person[], AuthError>
		readonly register: (github: GitHubUser) => Effect.Effect<User, AuthError>
		readonly remove: (id: string, user: User) => Effect.Effect<Person, AuthError>
	}
>()('@deslop/auth/services/people/service/People') {
	// People also answers `Auth`: a token or session counts only while its account is allowed.
	static readonly layer = Layer.effectContext(
		Effect.gen(function* () {
			const store = KeyValueStore.toSchemaStore(yield* KeyValueStore.KeyValueStore, Members)
			const state = yield* SubscriptionRef.make<Members>(Option.getOrElse(yield* store.get('members'), () => []))
			const tokens = yield* Tokens
			const github = yield* GitHub
			const admins = yield* Config.Array(Schema.String, 'GITHUB_ADMINS')
			// Every change saves the next members before memory and the live views see them.
			const transact = Effect.fnUntraced(function* <A, E>(
				change: (current: Members) => Effect.Effect<readonly [A, Members], E>
			) {
				return yield* SubscriptionRef.modifyEffect(state, current =>
					Effect.tap(change(current), result => store.set('members', result[1]))
				)
			}, Effect.uninterruptible)
			function roleOf(id: string, row: Option.Option<MemberRow>) {
				if (Array.contains(admins, String.replace('github:', '')(id))) return 'Admin' as const
				if (Option.exists(row, found => found.status === 'Allowed')) return 'Member' as const
				return 'Waiting' as const
			}
			function personOf(row: MemberRow) {
				return Person.make({
					...Struct.pick(row, ['id', 'name', 'since']),
					...Option.match(Option.liftPredicate(row.fullName, String.isNonEmpty), {
						onNone: () => ({}),
						onSome: fullName => ({fullName})
					}),
					role: roleOf(row.id, Option.some(row))
				})
			}
			const allowed = Effect.fnUntraced(function* (user: User) {
				if (roleOf(user.id, member(user.id, yield* SubscriptionRef.get(state))) === 'Waiting') {
					return yield* AuthError.make({
						error: 'access_denied',
						message: 'An admin has not allowed this GitHub account yet'
					})
				}
				return user
			})
			const admin = Effect.fnUntraced(function* (user: User) {
				if (roleOf(user.id, Option.none()) !== 'Admin') {
					return yield* AuthError.make({error: 'access_denied', message: 'Only an admin can manage people'})
				}
			})
			// Admins first, then the accounts asking for access, then members, each newest first.
			const list = Effect.fn('People.list')(function* (user: User) {
				yield* admin(user)
				const known = pipe(
					yield* SubscriptionRef.get(state),
					Array.reverse,
					Array.sort(Order.flip(Order.mapInput(Order.Number, (row: MemberRow) => row.since))),
					Array.map(personOf)
				)
				return Array.sort(
					[
						...Array.map(
							Array.filter(admins, id => !Array.some(known, person => person.id === `github:${id}`)),
							id => Person.make({id: `github:${id}`, name: `GitHub ${id}`, role: 'Admin', since: 0})
						),
						...known
					],
					Order.mapInput(Number.Order, (person: Person) => ROLE_ORDER[person.role])
				)
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
							return Effect.succeed([undefined, [...current, memberOf(profile, since, 'Allowed')]] as const)
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
									const user = yield* tokens.session(headers)
									return Option.match(member(user.id, yield* SubscriptionRef.get(state)), {
										onNone: () => Account.make({...user, role: roleOf(user.id, Option.none())}),
										onSome: row => Account.make(Struct.omit(personOf(row), ['since']))
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
					const person = yield* transact(current =>
						Effect.gen(function* () {
							const found = personOf(yield* Effect.fromOption(member(params.id, current)))
							if (found.role !== 'Waiting') {
								return yield* AuthError.make({message: 'This account is not asking for access'})
							}
							if (!params.allow) return [found, Array.filter(current, row => row.id !== params.id)] as const
							return [
								Person.make({...found, role: 'Member', since: now}),
								Array.map(current, row => {
									if (row.id !== params.id) return row
									return {...row, since: now, status: 'Allowed' as const}
								})
							] as const
						})
					)
					// A declined account is signed out, so it can sign in again to ask again.
					if (!params.allow) yield* tokens.forget(params.id)
					return person
				}, rejected('Cannot answer the access request')),
				allowed: Effect.fn('People.allowed')(allowed),
				list,
				people: user => Stream.mapEffect(SubscriptionRef.changes(state), () => list(user)),
				// Every GitHub sign-in is recorded: an admin as allowed, anyone else as asking for access until an admin answers.
				register: Effect.fn('People.register')(function* (profile: GitHubUser) {
					const since = yield* Clock.currentTimeMillis
					return yield* transact(current => {
						const row = memberOf(
							profile,
							since,
							Boolean.match(roleOf(`github:${profile.id}`, Option.none()) === 'Admin', {
								onFalse: () => 'Waiting' as const,
								onTrue: () => 'Allowed' as const
							})
						)
						return Effect.succeed([
							{id: row.id, name: row.name},
							Option.match(member(row.id, current), {
								onNone: () => [...current, row],
								onSome: () =>
									Array.map(current, existing => {
										if (existing.id !== row.id) return existing
										return {...existing, fullName: row.fullName, name: row.name}
									})
							})
						] as const)
					})
				}, rejected('Cannot record the GitHub account')),
				remove: Effect.fn('People.remove')(function* (id: string, user: User) {
					yield* admin(user)
					if (roleOf(id, Option.none()) === 'Admin') {
						return yield* AuthError.make({message: 'Admins come from GITHUB_ADMINS, so they cannot be removed here'})
					}
					const found = personOf(yield* Effect.fromOption(member(id, yield* SubscriptionRef.get(state))))
					// Access ends first, so no token or sign-in can be issued to the account between the two steps.
					yield* transact(current => Effect.succeed([undefined, Array.filter(current, row => row.id !== id)] as const))
					yield* tokens.forget(id)
					return found
				}, rejected('Cannot remove this account'))
			})
			return pipe(
				Context.make(People, people),
				Context.merge(
					Auth.makeContext(
						Auth.of({
							access: Effect.fn('Auth.access')(function* (headers: Headers.Headers, resource: string) {
								return yield* allowed(yield* tokens.access(headers, resource))
							}),
							user: Effect.fn('Auth.user')(function* (headers: Headers.Headers) {
								return yield* allowed(yield* tokens.session(headers))
							})
						})
					)
				)
			)
		})
	)
}
