import {Array, Boolean, Cause, HashSet, Number, Option, Order, Result, String, Struct, pipe} from 'effect'

import {AuthError} from '@deslop/runtime/auth/schema'
import {isAdmin} from '@deslop/runtime/auth/utils'

import type {AdmitParams, GitHubUser, MemberRow, Members, Role} from '#services/people/schema.ts'
import {Person} from '#services/people/schema.ts'

const ROLE_ORDER = {Admin: 1, Member: 2, Waiting: 0} satisfies Record<Role, number>

export function ownerOf(row: MemberRow) {
	return {incarnation: row.incarnation, user: {id: row.id, name: row.name}}
}

export function roleOf(admins: readonly string[], id: string, row: Option.Option<MemberRow>) {
	if (isAdmin(admins, id)) return 'Admin' as const
	if (Option.exists(row, found => found.status === 'Allowed')) return 'Member' as const
	return 'Waiting' as const
}

export function personOf(admins: readonly string[], row: MemberRow) {
	return Person.make({
		...Struct.pick(row, ['id', 'name', 'since']),
		...Option.match(Option.liftPredicate(row.fullName, String.isNonEmpty), {
			onNone: () => ({}),
			onSome: fullName => ({fullName})
		}),
		role: roleOf(admins, row.id, Option.some(row))
	})
}

export function admission(current: Members, admins: readonly string[], params: AdmitParams, now: number) {
	return pipe(
		Result.fromOption(
			Array.findFirst(current, row => row.id === params.id),
			() => new Cause.NoSuchElementError()
		),
		Result.flatMap(row => {
			const found = personOf(admins, row)
			if (found.role !== 'Waiting') {
				return Result.fail(AuthError.make({message: 'This account is not asking for access'}))
			}
			if (!params.allow) {
				return Result.succeed([
					{owner: ownerOf(row), person: found},
					Array.filter(current, stored => stored.id !== params.id)
				] as const)
			}
			return Result.succeed([
				{owner: ownerOf(row), person: Person.make({...found, role: 'Member', since: now})},
				Array.map(current, stored => {
					if (stored.id !== params.id) return stored
					return {...stored, since: now, status: 'Allowed' as const}
				})
			] as const)
		})
	)
}

export function registerMember(
	current: Members,
	admins: readonly string[],
	profile: GitHubUser,
	since: number,
	incarnation: string
) {
	const row = {
		fullName: profile.name ?? '',
		id: `github:${profile.id}`,
		incarnation,
		name: profile.login,
		since,
		status: Boolean.match(isAdmin(admins, `github:${profile.id}`), {
			onFalse: () => 'Waiting' as const,
			onTrue: () => 'Allowed' as const
		})
	}
	return [
		ownerOf(row),
		Option.match(
			Array.findFirst(current, stored => stored.id === row.id),
			{
				onNone: () => [...current, row],
				onSome: () =>
					Array.map(current, stored => {
						if (stored.id !== row.id) return stored
						return {...stored, fullName: row.fullName, name: row.name}
					})
			}
		)
	] as const
}

export function listPeople(current: Members, admins: readonly string[]) {
	const known = pipe(
		current,
		Array.reverse,
		Array.sort(Order.flip(Order.mapInput(Order.Number, (row: MemberRow) => row.since))),
		Array.map(row => personOf(admins, row))
	)
	const knownIds = HashSet.fromIterable(Array.map(known, person => person.id))
	return Array.sort(
		[
			...Array.map(
				Array.filter(admins, id => !HashSet.has(knownIds, `github:${id}`)),
				id => Person.make({id: `github:${id}`, name: `GitHub ${id}`, role: 'Admin', since: 0})
			),
			...known
		],
		Order.mapInput(Number.Order, (person: Person) => ROLE_ORDER[person.role])
	)
}
