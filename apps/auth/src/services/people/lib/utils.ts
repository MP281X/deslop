import {Array, Effect, HashSet, Number, Option, Order, String, Struct, pipe} from 'effect'

import {AuthError, UserId} from '@deslop/runtime/shared/auth'
import type {GitHubId} from '@deslop/runtime/shared/auth'

import type {Member, Role} from '#services/people/schema.ts'
import {Person} from '#services/people/schema.ts'

const ROLE_ORDER = {Admin: 1, Member: 2, Waiting: 0} satisfies Record<Role, number>

export function isAdmin(admins: readonly GitHubId[], id: UserId) {
	return Array.some(admins, admin => `github:${admin}` === id)
}

export const authorizeMember = Effect.fnUntraced(function* (
	admins: readonly GitHubId[],
	id: UserId,
	row: Option.Option<Member>
) {
	if (isAdmin(admins, id)) {
		return {admin: true, id, name: Option.match(row, {onNone: () => id, onSome: member => member.name})}
	}
	if (!Option.exists(row, member => member.status === 'Allowed')) {
		return yield* AuthError.make({error: 'access_denied', message: 'An admin has not allowed this account yet'})
	}
	return yield* Option.match(row, {
		onNone: () => Effect.fail(AuthError.make({error: 'access_denied', message: 'This account was removed'})),
		onSome: member => Effect.succeed({admin: false, id: member.id, name: member.name})
	})
})

export function roleOf(admins: readonly GitHubId[], id: UserId, row: Option.Option<Member>) {
	if (isAdmin(admins, id)) return 'Admin' as const
	if (Option.exists(row, found => found.status === 'Allowed')) return 'Member' as const
	return 'Waiting' as const
}

export function personOf(admins: readonly GitHubId[], row: Member) {
	return Person.make({
		admin: isAdmin(admins, row.id),
		...Struct.pick(row, ['id', 'name']),
		fullName: Option.filter(row.fullName, String.isNonEmpty),
		role: roleOf(admins, row.id, Option.some(row)),
		since: Option.some(row.since)
	})
}

// The accounts asking for access first, then admins, then members, each newest first as the rows come.
export function listPeople(rows: readonly Member[], admins: readonly GitHubId[]) {
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
