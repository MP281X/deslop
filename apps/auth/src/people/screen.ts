import {Array, Boolean, Function, Option, Schema, String, pipe} from 'effect'
import type {DateTime} from 'effect'

import {AsyncResult} from 'effect/reactivity'

import type {RowData, ToolbarAction} from '@deslop/components/model'
import {blockingFailure, isDeniedCause, needsSignInCause} from '@deslop/runtime/client/live-stream'
import {UserId} from '@deslop/runtime/shared/auth'
import {ageOf, monthOf} from '@deslop/runtime/shared/format'

import {Reader, readValue} from '#reads'

import {Person} from './contract.ts'
import type {Account} from './contract.ts'

const PeopleRead = AsyncResult.Schema({error: Schema.Unknown, success: Schema.Array(Person)})
export type PeopleRead = typeof PeopleRead.Type

export type Admission = typeof Admission.Type
const Admission = Schema.Struct({error: Schema.optionalKey(Schema.String), id: UserId, pending: Schema.Boolean})

// The people an admin sees, the filter on them and the answer to a request for access, with the messages that fill them.
export const peopleFields = {admission: Schema.optional(Admission), people: PeopleRead, waitingOnly: Schema.Boolean}
export const peopleMessages = {
	Admission: {error: Schema.optionalKey(Schema.String), id: UserId, viewer: UserId},
	Choose: {id: Schema.String},
	People: {result: PeopleRead, viewer: UserId},
	Select: {id: UserId}
}

export type Mark = typeof Mark.Type
export const Mark = Schema.TaggedUnion({
	Avatar: {initial: Schema.String, url: Schema.optional(Schema.String)},
	Device: {device: Schema.Literals(['apple', 'android', 'windows', 'linux', 'browser'])}
})

export type AuthRow = {item: RowData; mark: Mark}

export type RetryTarget = typeof RetryTarget.Type
const RetryTarget = Schema.Union([Reader, Schema.Literal('sign-out')])

export type Notice = {kind: 'notice'; text: string; retry?: RetryTarget}
export type Entry = {kind: 'row'; row: AuthRow} | {kind: 'skeleton'; id: string} | Notice

export function notice(text: string, retry?: RetryTarget) {
	return {kind: 'notice', text, ...(retry !== undefined && {retry})} satisfies Notice
}

export function row(item: AuthRow) {
	return {kind: 'row', row: item} satisfies Entry
}

export function loading(reader: Reader, count: number) {
	return Array.makeBy(count, index => ({id: `loading-${reader}-${index}`, kind: 'skeleton'}) satisfies Entry)
}

export function problem(result: AsyncResult.AsyncResult<unknown, unknown>, reader: Reader) {
	const failure = Option.getOrUndefined(blockingFailure(result))
	if (failure !== undefined) {
		if (needsSignInCause(failure)) return [notice('Signing in…')]
		if (isDeniedCause(failure)) return [notice('Access denied')]
		return [notice(`Couldn’t load ${reader}`, reader)]
	}
	if (AsyncResult.isFailure(result)) return [notice(`Couldn’t refresh ${reader}`, reader)]
	return []
}

export function lineOf(parts: readonly unknown[]) {
	return pipe(parts, Array.filter(String.isString), Array.join(' · '))
}

export function personRow(person: Account, membership?: Person, now?: DateTime.Utc) {
	const username = Option.isSome(person.fullName) && `@${person.name}`
	const waiting = person.role === 'Waiting'
	function trailing() {
		if (membership === undefined) return undefined
		return Option.getOrUndefined(
			Option.map(membership.since, since => {
				if (waiting && now !== undefined) return ageOf(since, now)
				return monthOf(since)
			})
		)
	}
	return {
		item: {
			id: person.id,
			line: lineOf([
				username,
				Boolean.match(String.startsWith('github:')(person.id), {
					onFalse: Function.constant('Tailnet'),
					onTrue: Function.constant('GitHub')
				}),
				person.role === 'Admin' && 'admin'
			]),
			problem: Boolean.match(waiting, {
				onFalse: Function.constUndefined,
				onTrue: () => ({reason: lineOf(['Waiting for approval', username]), status: 'warning' as const})
			}),
			title: Option.getOrElse(person.fullName, () => person.name),
			trailing: trailing()
		},
		mark: Mark.cases.Avatar.make({
			initial: String.toUpperCase(String.slice(0, 1)(person.name)),
			url: pipe(
				String.match(/^github:([1-9]\d*)$/u)(person.id),
				Option.map(id => `https://avatars.githubusercontent.com/u/${id[1]}?s=96`),
				Option.getOrUndefined
			)
		})
	} satisfies AuthRow
}

// The people an admin lists, the viewer in their own account's words.
export function peopleEntries(
	people: PeopleRead,
	waitingOnly: boolean,
	viewer: Account,
	now: DateTime.Utc
): readonly Entry[] {
	const notices = problem(people, 'people')
	return Option.match(readValue(people), {
		onNone: () => notices,
		onSome: rows => {
			const shown = Boolean.match(waitingOnly, {
				onFalse: () => rows,
				onTrue: () => Array.filter(rows, person => person.role === 'Waiting')
			})
			if (Array.isReadonlyArrayEmpty(shown)) {
				return [
					notice(
						Boolean.match(waitingOnly, {
							onFalse: Function.constant('No people'),
							onTrue: Function.constant('No requests for approval')
						})
					),
					...notices
				]
			}
			return [
				...Array.map(shown, person =>
					row(
						personRow(
							Boolean.match(person.id === viewer.id, {onFalse: () => person, onTrue: () => viewer}),
							person,
							now
						)
					)
				),
				...notices
			]
		}
	})
}

export function filterAction(waitingOnly: boolean) {
	return {
		id: 'people',
		label: 'People options',
		menu: [
			{checked: !waitingOnly, id: 'all', label: 'All people'},
			{checked: waitingOnly, id: 'waiting', label: 'Waiting for approval'}
		],
		symbol: 'line.3.horizontal.decrease'
	} satisfies ToolbarAction
}

// One person's detail for an admin: their row, and the answer to their request for access.
export function personDetail(
	people: PeopleRead,
	id: UserId,
	tail: {readonly account: readonly Entry[]; readonly signOut: readonly Entry[]},
	admission?: Admission
) {
	const person = pipe(
		readValue(people),
		Option.flatMap(rows => Array.findFirst(rows, candidate => candidate.id === id)),
		Option.getOrUndefined
	)
	if (person === undefined) {
		if (AsyncResult.isInitial(people)) return {actions: [], entries: [...loading('people', 1), ...tail.signOut]}
		const issues = problem(people, 'people')
		if (Array.isReadonlyArrayNonEmpty(issues)) return {actions: [], entries: [...issues, ...tail.signOut]}
		return {actions: [], entries: [notice('Person not found'), ...tail.signOut]}
	}
	const waiting = person.role === 'Waiting'
	const answer = pipe(
		Option.fromUndefinedOr(admission),
		Option.filter(found => found.id === person.id),
		Option.getOrUndefined
	)
	const actions = Boolean.match(waiting, {
		onFalse: () => [],
		onTrue: () =>
			[
				{disabled: admission?.pending, id: 'deny', label: `Deny @${person.name}`, symbol: 'xmark'},
				{disabled: admission?.pending, id: 'approve', label: `Approve @${person.name}`, symbol: 'checkmark'}
			] satisfies readonly ToolbarAction[]
	})
	function entries() {
		if (answer?.error !== undefined) return [notice(answer.error)]
		if (!waiting) return [notice('Only your browser sessions are visible')]
		return []
	}
	return {actions, entries: [row(personRow(person)), ...entries(), ...tail.signOut, ...tail.account]}
}
