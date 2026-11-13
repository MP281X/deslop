import {Array, HashSet, Number, Option, Order, String, Struct, pipe} from 'effect'

import {isAdmin} from '@deslop/runtime/shared/auth'

import type {Member, Role} from '#services/people/schema.ts'
import {Person} from '#services/people/schema.ts'

const ROLE_ORDER = {Admin: 1, Member: 2, Waiting: 0} satisfies Record<Role, number>

export function ownerOf(row: Member) {
	return {incarnation: row.incarnation, user: {id: row.id, name: row.name}}
}

export function roleOf(admins: readonly string[], id: string, row: Option.Option<Member>) {
	if (isAdmin(admins, id)) return 'Admin' as const
	if (Option.exists(row, found => found.status === 'Allowed')) return 'Member' as const
	return 'Waiting' as const
}

export function personOf(admins: readonly string[], row: Member) {
	return Person.make({
		...Struct.pick(row, ['id', 'name', 'since']),
		...pipe(
			row.fullName,
			Option.filter(String.isNonEmpty),
			Option.match({onNone: () => ({}), onSome: fullName => ({fullName})})
		),
		role: roleOf(admins, row.id, Option.some(row))
	})
}

// The accounts asking for access first, then admins, then members, each newest first as the rows come.
export function listPeople(rows: readonly Member[], admins: readonly string[]) {
	const known = Array.map(rows, row => personOf(admins, row))
	const knownIds = HashSet.fromIterable(Array.map(known, person => person.id))
	return Array.sort(
		[
			...pipe(
				admins,
				Array.filter(id => !HashSet.has(knownIds, `github:${id}`)),
				Array.map(id => Person.make({id: `github:${id}`, name: `GitHub ${id}`, role: 'Admin', since: 0}))
			),
			...known
		],
		Order.mapInput(Number.Order, (person: Person) => ROLE_ORDER[person.role])
	)
}
