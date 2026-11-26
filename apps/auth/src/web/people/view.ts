import {Array, Boolean, Function, Option, String, pipe} from 'effect'
import type {DateTime} from 'effect'

import type {UserId} from '@deslop/runtime/shared/auth'
import {ageOf, monthOf} from '@deslop/runtime/shared/format'
import {Button} from '@deslop/ui/control'

import type {Account, Person, SignedAccount} from '#contracts'

import {Message} from '#web/auth/model.ts'
import type {H, Model} from '#web/auth/model.ts'
import {rowLine} from '#web/auth/row.ts'
import {Notice} from '#web/auth/status.ts'

function Name(h: H, person: Account) {
	const waiting = person.role === 'Waiting'
	const fullName = Option.getOrUndefined(person.fullName)
	const source = Boolean.match(String.startsWith('github:')(person.id), {
		onFalse: Function.constant('Tailnet'),
		onTrue: Function.constant('GitHub')
	})
	return h.span
		.class('auth-row-name')
		.children(
			h.span
				.class('axis-title')
				.children(waiting && h.span.class('axis-dot').attr('aria-hidden', 'true'), fullName ?? person.name),
			h.span
				.class('axis-muted')
				.children(
					rowLine([
						waiting && 'Waiting for approval',
						fullName !== undefined && `@${person.name}`,
						source,
						person.role === 'Admin' && 'admin'
					])
				)
		)
}

export function People(h: H, selected: UserId, viewer: SignedAccount, now: DateTime.Utc, rows?: readonly Person[]) {
	if (rows === undefined) return undefined
	if (Array.isReadonlyArrayEmpty(rows)) return Notice(h, 'No people')
	return Array.map(rows, person => {
		const identity = Boolean.match(person.id === viewer.id, {onFalse: () => person, onTrue: () => viewer})
		const current = Boolean.match(person.id === selected, {
			onFalse: Function.constUndefined,
			onTrue: Function.constant('true')
		})
		const sinceText = Option.getOrUndefined(
			Option.map(person.since, since => {
				if (person.role === 'Waiting') return ageOf(since, now)
				return monthOf(since)
			})
		)
		return Button(h)
			.key(person.id)
			.class('axis-row auth-person')
			.attr('aria-current', current)
			.on('click', () => Message.Select({id: person.id}))
			.children(Name(h, identity), h.span.class('axis-value').children(sinceText))
	})
}

export function PersonDetail(h: H, person: Account, viewer: SignedAccount, admission: Model['admission']) {
	const own = person.id === viewer.id
	const error = Option.getOrUndefined(
		pipe(
			Option.fromUndefinedOr(admission),
			Option.filter(answer => answer.id === person.id),
			Option.flatMap(answer => Option.fromUndefinedOr(answer.error))
		)
	)
	return [
		h.div.class('axis-row').children(Name(h, person)),
		error !== undefined && Notice(h, error, undefined, true),
		!own && person.role !== 'Waiting' && Notice(h, 'Only your browser sessions are visible')
	]
}
