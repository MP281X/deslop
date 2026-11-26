import {Array, Effect, HashSet, Number, Option, Order, String, Struct, pipe} from 'effect'

import {AuthError, UserId} from '@deslop/runtime/shared/auth'
import type {GitHubId} from '@deslop/runtime/shared/auth'

import {Person} from '#contracts'
import type {Role} from '#contracts'

import type {Member} from '#server/people/schema.ts'

const ROLE_ORDER = {Admin: 1, Member: 2, Waiting: 0} satisfies Record<Role, number>

export function isAdmin(admins: readonly GitHubId[], id: UserId) {
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

export function personOf(admins: readonly GitHubId[], row: Member) {
	return Person.make({
		admin: isAdmin(admins, row.id),
		...Struct.pick(row, ['id', 'name']),
		fullName: Option.filter(row.fullName, String.isNonEmpty),
		role: listedRoleOf(admins, row),
		since: row.since
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
