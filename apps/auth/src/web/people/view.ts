import {Array, Boolean, Function, Option, String} from 'effect'
import type {DateTime} from 'effect'

import type {UserId} from '@deslop/runtime/shared/auth'
import {ageOf, monthOf} from '@deslop/runtime/shared/format'
import {Notice, Row} from '@deslop/ui/axis'

import type {Account, Person, SignedAccount} from '#contracts'

import {Message} from '#web/auth/model.ts'
import type {H, Model} from '#web/auth/model.ts'
import {rowLine} from '#web/auth/row.ts'

function nameOf(person: Account) {
	return Option.getOrElse(person.fullName, () => person.name)
}

function lineOf(person: Account) {
	const handle = Option.isSome(person.fullName) && `@${person.name}`
	if (person.role === 'Waiting') return rowLine(['Waiting for approval', handle])
	return rowLine([
		handle,
		Boolean.match(String.startsWith('github:')(person.id), {
			onFalse: Function.constant('Tailnet'),
			onTrue: Function.constant('GitHub')
		}),
		person.role === 'Admin' && 'admin'
	])
}

export function People(
	h: H,
	rows: readonly Person[],
	viewer: SignedAccount,
	now: DateTime.Utc,
	waitingOnly: boolean,
	selected?: UserId
) {
	const people = Boolean.match(waitingOnly, {
		onFalse: () => rows,
		onTrue: () => Array.filter(rows, row => row.role === 'Waiting')
	})
	if (Array.isReadonlyArrayEmpty(people)) {
		return Notice(
			h,
			Boolean.match(waitingOnly, {
				onFalse: Function.constant('No people'),
				onTrue: Function.constant('No requests for approval')
			})
		)
	}
	return Array.map(people, person => {
		const identity = Boolean.match(person.id === viewer.id, {onFalse: () => person, onTrue: () => viewer})
		const since = Option.getOrUndefined(
			Option.map(person.since, date => {
				if (person.role === 'Waiting') return ageOf(date, now)
				return monthOf(date)
			})
		)
		return Row(h, {
			current: person.id === selected,
			id: person.id,
			line: lineOf(identity),
			open: Message.Select({id: person.id}),
			problem: person.role === 'Waiting',
			title: nameOf(identity),
			value: since
		})
	})
}

export function PersonDetail(h: H, person: Account, viewer: SignedAccount, admission: Model['admission']) {
	return [
		h.div
			.class('axis-row axis-item')
			.children(
				h.span
					.class('axis-lines')
					.children(
						h.span
							.class('axis-title')
							.children(
								person.role === 'Waiting' && h.span.class('axis-dot').attr('aria-hidden', 'true'),
								nameOf(person)
							),
						h.span.class('axis-muted').children(lineOf(person))
					)
			),
		admission?.id === person.id && admission.error !== undefined && Notice(h, admission.error),
		person.id !== viewer.id && person.role !== 'Waiting' && Notice(h, 'Only your browser sessions are visible')
	]
}
