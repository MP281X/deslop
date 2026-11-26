import type {Html} from '@effect/ui/html'

import {Array, Boolean, Function, Option, String, pipe} from 'effect'
import type {DateTime} from 'effect'

import {AsyncResult} from 'effect/reactivity'

import {blockingFailure, isDeniedCause} from '@deslop/runtime/client/live-stream'
import type {UserId} from '@deslop/runtime/shared/auth'
import {ageOf, monthOf} from '@deslop/runtime/shared/format'
import {Button} from '@deslop/ui/control'
import {Glass, SidebarControl} from '@deslop/ui/glass'

import {Message, readValue, signInRequested} from '#routes/(home)/-model.ts'
import type {Model, Reader} from '#routes/(home)/-model.ts'
import github from '#routes/github.svg'
import type {Account, Person, SignedAccount} from '#services/people/schema.ts'
import {browserOf, deviceOf} from '#services/sessions/lib/utils.ts'

const READER_LABELS = {account: 'Account', people: 'People', sessions: 'Sessions'}

export type H = Html.H<Message>

export function Sidebar(h: H, open: boolean, message: Message, className: string) {
	return h.div.class('auth-sidebar', className).children(SidebarControl(h, open, message))
}

export function SignOut(h: H, account: SignedAccount) {
	return (
		account.signOut &&
		h.form
			.attrs({action: '/sign-out', method: 'post'})
			.children(Glass(h).children(Button(h, {type: 'submit'}).class('auth-action').children('Sign out')))
	)
}

export function SignIn(h: H, error?: string) {
	return h.section
		.class('auth-center')
		.attr('aria-label', 'Sign in')
		.children(
			Glass(h).children(
				Button(h)
					.class('auth-action')
					.on('click', () => Message.StartSignIn())
					.children(h.img.attr('src', github).attr('alt', ''), 'Continue with GitHub')
			),
			error !== undefined &&
				h.p
					.class('axis-muted auth-status')
					.attr('role', 'alert')
					.children(h.span.class('axis-dot').attr('aria-hidden', 'true'), error)
		)
}

export function Notice(h: H, label: string, reader?: Reader, problem = false) {
	return h.div
		.class('axis-row auth-status')
		.attr('role', 'status')
		.children(
			h.p.class('axis-muted').children(problem && h.span.class('axis-dot').attr('aria-hidden', 'true'), label),
			reader !== undefined &&
				Glass(h).children(
					Button(h)
						.class('auth-action')
						.on('click', () => Message.Retry({reader}))
						.children('Retry')
				)
		)
}

export function ReadProblem(h: H, result: AsyncResult.AsyncResult<unknown, unknown>, reader: Reader) {
	const failure = blockingFailure(result)
	if (Option.isSome(failure)) {
		if (signInRequested(result)) return Notice(h, 'Signing in…')
		if (Option.exists(failure, isDeniedCause)) return Notice(h, 'Access denied', undefined, true)
		return Notice(h, `Couldn’t load ${reader}`, reader, true)
	}
	if (AsyncResult.isFailure(result)) return Notice(h, `${READER_LABELS[reader]} out of date`, reader, true)
	if (AsyncResult.isInitial(result)) return Notice(h, `Loading ${reader}…`)
	return undefined
}

function line(parts: readonly unknown[]) {
	return pipe(parts, Array.filter(String.isString), Array.join(' · '))
}

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
					line([
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
		h.div.class('axis-row').children(Name(h, person), own && SignOut(h, viewer)),
		person.role === 'Waiting' &&
			h.div.class('auth-answers').children(
				Array.map([false, true], allow => {
					const label = Boolean.match(allow, {onFalse: Function.constant('Deny'), onTrue: Function.constant('Approve')})
					return Glass(h).children(
						Button(h, {disabled: admission?.pending ?? false})
							.class('auth-action')
							.attr('aria-label', `${label} @${person.name}`)
							.on('click', () => Message.Answer({allow, id: person.id}))
							.children(label)
					)
				})
			),
		error !== undefined && Notice(h, error, undefined, true),
		!own && person.role !== 'Waiting' && Notice(h, 'Only your browser sessions are visible')
	]
}

export function Sessions(h: H, result: Model['sessions'], now: DateTime.Utc) {
	return h.section.attr('aria-label', 'Browser sessions').children(
		Option.match(readValue(result), {
			onNone: Function.constUndefined,
			onSome: rows => {
				if (Array.isReadonlyArrayEmpty(rows)) return Notice(h, 'No browser sessions')
				return Array.map(rows, session =>
					h.div
						.key(session.id)
						.class('axis-row')
						.children(
							h.span
								.class('auth-row-name')
								.children(
									h.span
										.class('axis-title')
										.children(line([browserOf(session.browser), Option.getOrUndefined(deviceOf(session.browser))])),
									h.span
										.class('axis-muted')
										.children(line([Option.getOrUndefined(session.address), session.current && 'This device']))
								),
							h.span.class('axis-value').children(ageOf(session.lastSeenAt, now))
						)
				)
			}
		}),
		ReadProblem(h, result, 'sessions')
	)
}
