import {Array, Option, Schema} from 'effect'
import type {DateTime} from 'effect'

import {AsyncResult} from 'effect/reactivity'

import {UserId} from '@deslop/runtime/shared/auth'
import {ageOf} from '@deslop/runtime/shared/format'

import {readValue} from '#reads'

import {ListedSession} from './contract.ts'
import {browserOf, deviceOf} from './shared.ts'

import {Mark, lineOf, loading, notice, problem, row} from '#people/screen.ts'
import type {AuthRow} from '#people/screen.ts'

const SessionsRead = AsyncResult.Schema({error: Schema.Unknown, success: Schema.Array(ListedSession)})
export type SessionsRead = typeof SessionsRead.Type

// The browser sessions of whoever is signed in, with the message that fills them.
export const sessionsFields = {sessions: SessionsRead}
export const sessionsMessages = {Sessions: {result: SessionsRead, viewer: UserId}}

function sessionRow(session: ListedSession, now: DateTime.Utc) {
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

export function sessionEntries(sessions: SessionsRead, now: DateTime.Utc) {
	const rows = Option.getOrUndefined(readValue(sessions))
	if (rows === undefined && AsyncResult.isInitial(sessions)) return loading('sessions', 3)
	const notices = problem(sessions, 'sessions')
	if (rows === undefined) return notices
	if (Array.isReadonlyArrayEmpty(rows)) return [notice('No browser sessions'), ...notices]
	return [...Array.map(rows, session => row(sessionRow(session, now))), ...notices]
}
