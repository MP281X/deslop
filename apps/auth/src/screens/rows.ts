import {Array, Option, String, pipe} from 'effect'
import type {DateTime} from 'effect'

import type {RowData} from '@deslop/design/model'
import {ageOf, monthOf} from '@deslop/runtime/shared/format'

import type {Account, ListedSession, Person} from '#contracts'

import {browserOf, deviceOf} from '#screens/browser.ts'

export type Mark =
	| {kind: 'avatar'; initial: string; url: string | undefined}
	| {kind: 'device'; device: 'apple' | 'android' | 'windows' | 'linux' | 'browser'}

export type AuthRow = RowData & {mark: Mark}

function lineOf(parts: readonly unknown[]) {
	return pipe(parts, Array.filter(String.isString), Array.join(' · '))
}

export function personRow(person: Account, membership?: Person, now?: DateTime.Utc): AuthRow {
	const username = Option.isSome(person.fullName) && `@${person.name}`
	const id = Option.getOrUndefined(String.match(/^github:([1-9]\d*)$/u)(person.id))
	const waiting = person.role === 'Waiting'
	return {
		id: person.id,
		line: lineOf([
			username,
			String.startsWith('github:')(person.id) ? 'GitHub' : 'Tailnet',
			person.role === 'Admin' && 'admin'
		]),
		mark: {
			kind: 'avatar',
			initial: String.toUpperCase(String.slice(0, 1)(person.name)),
			url: id === undefined ? undefined : `https://avatars.githubusercontent.com/u/${id[1]}?s=96`
		},
		problem: waiting ? {reason: lineOf(['Waiting for approval', username]), status: 'warning'} : undefined,
		title: Option.getOrElse(person.fullName, () => person.name),
		trailing:
			membership === undefined
				? undefined
				: Option.getOrUndefined(
						Option.map(membership.since, since => (waiting && now !== undefined ? ageOf(since, now) : monthOf(since)))
					)
	}
}

export function sessionRow(session: ListedSession, now: DateTime.Utc): AuthRow {
	const device = Option.getOrUndefined(deviceOf(session.browser))
	function logo() {
		if (device === undefined) return 'browser'
		if (device === 'Android') return 'android'
		if (device === 'Linux') return 'linux'
		if (device === 'Windows') return 'windows'
		return 'apple'
	}
	return {
		id: session.id,
		line: lineOf([Option.getOrUndefined(session.address), session.current && 'This device']),
		mark: {kind: 'device', device: logo()},
		title: lineOf([browserOf(session.browser), device]),
		trailing: ageOf(session.lastSeenAt, now)
	}
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
