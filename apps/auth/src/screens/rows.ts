import {Array, Boolean, Function, Option, Schema, String, pipe} from 'effect'
import type {DateTime} from 'effect'

import type {RowData} from '@deslop/components/model'
import {ageOf, monthOf} from '@deslop/runtime/shared/format'

import type {Account, ListedSession, Person} from '#contracts'

import {browserOf, deviceOf} from '#screens/browser.ts'

export type Mark = typeof Mark.Type
export const Mark = Schema.TaggedUnion({
	Avatar: {initial: Schema.String, url: Schema.optional(Schema.String)},
	Device: {device: Schema.Literals(['apple', 'android', 'windows', 'linux', 'browser'])}
})

export type AuthRow = {item: RowData; mark: Mark}

function lineOf(parts: readonly unknown[]) {
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

export function sessionRow(session: ListedSession, now: DateTime.Utc) {
	const device = Option.getOrUndefined(deviceOf(session.browser))
	function logo() {
		if (device === undefined) return 'browser'
		if (device === 'Android') return 'android'
		if (device === 'Linux') return 'linux'
		if (device === 'Windows') return 'windows'
		return 'apple'
	}
	return {
		item: {
			id: session.id,
			line: lineOf([Option.getOrUndefined(session.address), session.current && 'This device']),
			title: lineOf([browserOf(session.browser), device]),
			trailing: ageOf(session.lastSeenAt, now)
		},
		mark: Mark.cases.Device.make({device: logo()})
	} satisfies AuthRow
}

export const AVATAR = {
	alignItems: 'center',
	backgroundColor: '#202020',
	borderRadius: 14,
	display: 'flex',
	flexShrink: 0,
	height: 28,
	justifyContent: 'center',
	overflow: 'hidden',
	position: 'relative',
	width: 28
} as const
