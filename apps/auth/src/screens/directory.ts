import {Command, Component, Router, Subscription} from '@effect/ui'
import type {View} from '@effect/ui'

import {Array, Boolean, DateTime, Function, Option, Schema, pipe} from 'effect'

import {AsyncResult} from 'effect/reactivity'

import type {Selection, ToolbarAction, ToolbarOptions} from '@deslop/components/model'
import {clockAtom} from '@deslop/runtime/client/clock'
import {blockingFailure, isDeniedCause, needsSignInCause} from '@deslop/runtime/client/live-stream'
import {UserId} from '@deslop/runtime/shared/auth'

import type {SignedAccount} from '#contracts'

import {
	Admit,
	Message,
	Model,
	Reader,
	RecoverSignIn,
	Refresh,
	SignOut,
	StartSignIn,
	readValue,
	signed
} from '#screens/model.ts'
import {watch, watchAuth} from '#screens/reads.ts'
import {AuthRoute, detailIsOpen, isHome, selectedOf} from '#screens/routes.ts'
import {personRow, sessionRow} from '#screens/rows.ts'
import type {AuthRow} from '#screens/rows.ts'

export type RetryTarget = typeof RetryTarget.Type
const RetryTarget = Schema.Union([Reader, Schema.Literal('sign-out')])

export type Notice = {kind: 'notice'; text: string; retry?: RetryTarget}
export type Entry = {kind: 'row'; row: AuthRow} | {kind: 'skeleton'; id: string} | Notice

function notice(text: string, retry?: RetryTarget) {
	return {kind: 'notice', text, ...(retry !== undefined && {retry})} satisfies Notice
}

function signOutNotices(error: Model['signOutError']) {
	return pipe(
		Option.fromUndefinedOr(error),
		Option.map(text => notice(text, 'sign-out')),
		Option.toArray
	)
}

function problem(result: AsyncResult.AsyncResult<unknown, unknown>, reader: Reader) {
	const failure = Option.getOrUndefined(blockingFailure(result))
	if (failure !== undefined) {
		if (needsSignInCause(failure)) return [notice('Signing in…')]
		if (isDeniedCause(failure)) return [notice('Access denied')]
		return [notice(`Couldn’t load ${reader}`, reader)]
	}
	if (AsyncResult.isFailure(result)) return [notice(`Couldn’t refresh ${reader}`, reader)]
	return []
}

function row(item: AuthRow) {
	return {kind: 'row', row: item} satisfies Entry
}

function loading(reader: Reader, count: number) {
	return Array.makeBy(count, index => ({id: `loading-${reader}-${index}`, kind: 'skeleton'}) satisfies Entry)
}

function sessions(model: Model) {
	const rows = Option.getOrUndefined(readValue(model.sessions))
	if (rows === undefined && AsyncResult.isInitial(model.sessions)) return loading('sessions', 3)
	const notices = problem(model.sessions, 'sessions')
	if (rows === undefined) return notices
	if (Array.isReadonlyArrayEmpty(rows)) return [notice('No browser sessions'), ...notices]
	return [...Array.map(rows, session => row(sessionRow(session, model.now))), ...notices]
}

function people(model: Model, viewer: SignedAccount) {
	const notices = problem(model.people, 'people')
	return Option.match(readValue(model.people), {
		onNone: () => notices,
		onSome: rows => {
			const shown = Boolean.match(model.waitingOnly, {
				onFalse: () => rows,
				onTrue: () => Array.filter(rows, person => person.role === 'Waiting')
			})
			if (Array.isReadonlyArrayEmpty(shown)) {
				return [
					notice(
						Boolean.match(model.waitingOnly, {
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
							model.now
						)
					)
				),
				...notices
			]
		}
	})
}

function showSignOut(pending: boolean, viewer?: SignedAccount) {
	if (viewer?.signOut !== true) return []
	return [
		{disabled: pending, id: 'sign-out', label: 'Sign out', symbol: 'rectangle.portrait.and.arrow.right'}
	] satisfies readonly ToolbarAction[]
}

export function visibleToolbar(toolbar: ToolbarOptions) {
	return Option.getOrUndefined(Option.liftPredicate(toolbar, value => Array.isReadonlyArrayNonEmpty(value.actions)))
}

function detail(model: Model, viewer: SignedAccount, signingOut: boolean, id?: UserId) {
	const accountProblem = problem(model.account, 'account')
	const signOutProblem = signOutNotices(model.signOutError)
	if (id === undefined || id === viewer.id || viewer.role !== 'Admin') {
		return {
			actions: showSignOut(signingOut, viewer),
			entries: [row(personRow(viewer)), ...sessions(model), ...signOutProblem, ...accountProblem]
		}
	}
	const person = pipe(
		readValue(model.people),
		Option.flatMap(rows => Array.findFirst(rows, candidate => candidate.id === id)),
		Option.getOrUndefined
	)
	if (person === undefined) {
		if (AsyncResult.isInitial(model.people)) return {actions: [], entries: [...loading('people', 1), ...signOutProblem]}
		const issues = problem(model.people, 'people')
		if (Array.isReadonlyArrayNonEmpty(issues)) return {actions: [], entries: [...issues, ...signOutProblem]}
		return {actions: [], entries: [notice('Person not found'), ...signOutProblem]}
	}
	const waiting = person.role === 'Waiting'
	const admission = pipe(
		Option.fromUndefinedOr(model.admission),
		Option.filter(answer => answer.id === person.id),
		Option.getOrUndefined
	)
	const actions = Boolean.match(waiting, {
		onFalse: () => [],
		onTrue: () =>
			[
				{disabled: model.admission?.pending, id: 'deny', label: `Deny @${person.name}`, symbol: 'xmark'},
				{disabled: model.admission?.pending, id: 'approve', label: `Approve @${person.name}`, symbol: 'checkmark'}
			] satisfies readonly ToolbarAction[]
	})
	function entries() {
		if (admission?.error !== undefined) return [notice(admission.error)]
		if (!waiting) return [notice('Only your browser sessions are visible')]
		return []
	}
	return {actions, entries: [row(personRow(person)), ...entries(), ...signOutProblem, ...accountProblem]}
}

function accessState(model: Model, viewer?: SignedAccount) {
	if (viewer?.role === 'Waiting') return 'waiting'
	if (Option.exists(readValue(model.account), Option.isNone)) return 'sign-in'
	return 'refused'
}

export type Props = typeof Props.Type
const Props = Schema.Struct({native: Schema.Boolean, route: AuthRoute})

function recoverRead(result: AsyncResult.AsyncResult<unknown, unknown>) {
	if (Option.exists(blockingFailure(result), needsSignInCause)) {
		return [Command.asNoop(RecoverSignIn.make({}))]
	}
	return []
}

const AuthScreen = Component.define({message: Message, model: Model, name: 'AuthScreen', props: Props}).make({
	init: $ => ({
		account: AsyncResult.initial(),
		now: DateTime.nowUnsafe(),
		openedFromList: false,
		people: AsyncResult.initial(),
		route: $.props.route,
		sessions: AsyncResult.initial(),
		waitingOnly: false
	}),
	parts: (p, model) => {
		const viewer = signed(model.account)
		const selected = selectedOf(model.route)
		const signingOut = p.isRunning(SignOut)
		const signingIn = p.isRunning(StartSignIn)
		const back = p.part((el, event: string) => el.on(event, Message.Back()))
		const selection: Selection = {
			back,
			id:
				selected ??
				Boolean.match(detailIsOpen(model.route), {
					onFalse: Function.constUndefined,
					onTrue: () => viewer?.id ?? 'account-loading'
				}),
			select: p.part((el, event: string, id: string) =>
				el.on(event, () =>
					Option.getOrUndefined(Option.map(Schema.decodeOption(UserId)(id), personId => Message.Select({id: personId})))
				)
			)
		}
		const choose = p.part((el, event: string, identify: Parameters<ToolbarOptions['choose']>[2]) =>
			el.on(event, payload => {
				const id = identify(payload)
				if (id === 'sign-out') return Message.SignOut()
				if (id !== undefined) return Message.Choose({id})
				return undefined
			})
		)
		const retry = p.part((el, event: string, target: RetryTarget) => {
			if (target === 'sign-out') return el.on(event, Message.SignOut())
			return el.on(event, Message.Retry({reader: target}))
		})
		if (!isHome(model.route)) return {back, kind: 'not-found', retry} as const
		if (AsyncResult.isInitial(model.account)) {
			return {
				accountNotes: [],
				defaultId: undefined,
				detail: [
					...loading('account', 1),
					...Boolean.match(selected === undefined, {onFalse: () => [], onTrue: () => loading('sessions', 2)})
				],
				detailToolbar: [],
				kind: 'directory',
				people: loading('people', 3),
				retry,
				selection,
				toolbar: {actions: [], choose}
			} as const
		}
		if (viewer === undefined || viewer.role === 'Waiting') {
			return {
				entries: [...signOutNotices(model.signOutError), ...problem(model.account, 'account')],
				error: model.signInError ?? model.route.search.error,
				kind: 'access',
				retry,
				signIn: p.part((el, event: string) => el.on(event, Message.SignIn())),
				signingIn,
				state: accessState(model, viewer),
				toolbar: {actions: showSignOut(signingOut, viewer), choose}
			} as const
		}
		const selectedPerson = detail(model, viewer, signingOut, selected)
		if (viewer.role !== 'Admin') {
			return {
				detail: selectedPerson.entries,
				kind: 'sessions',
				retry,
				selection: {...selection, id: undefined},
				toolbar: {actions: selectedPerson.actions, choose}
			} as const
		}
		const filter: ToolbarAction = {
			id: 'people',
			label: 'People options',
			menu: [
				{checked: !model.waitingOnly, id: 'all', label: 'All people'},
				{checked: model.waitingOnly, id: 'waiting', label: 'Waiting for approval'}
			],
			symbol: 'line.3.horizontal.decrease'
		}
		return {
			accountNotes: problem(model.account, 'account'),
			defaultId: viewer.id,
			detail: selectedPerson.entries,
			detailToolbar: selectedPerson.actions,
			kind: 'directory',
			people: Boolean.match(AsyncResult.isInitial(model.people), {
				onFalse: () => people(model, viewer),
				onTrue: () => loading('people', 3)
			}),
			retry,
			selection,
			toolbar: {actions: [filter], choose}
		} as const
	},
	subscriptions: $ => {
		const viewer = signed($.model.account)
		const home = isHome($.model.route)
		return [
			Router.subscription(AuthRoute, $.model.route, route => Message.Route({route})),
			home &&
				Subscription.make(
					'account',
					watchAuth(
						reads => reads.accountAtom,
						result => Message.Account({result})
					)
				),
			home &&
				viewer?.role === 'Admin' &&
				Subscription.make('people', viewer.id, id =>
					watchAuth(
						reads => reads.peopleAtoms(id),
						result => Message.People({result, viewer: id})
					)
				),
			home &&
				viewer !== undefined &&
				viewer.role !== 'Waiting' &&
				Subscription.make('sessions', viewer.id, id =>
					watchAuth(
						reads => reads.sessionAtoms(id),
						result => Message.Sessions({result, viewer: id})
					)
				),
			home &&
				viewer !== undefined &&
				Subscription.make(
					'clock',
					watch(clockAtom('1 minute'), now => Message.Clock({now}))
				)
		]
	},
	update: {
		Account: ($, message) => {
			const previous = signed($.model.account)
			const next = signed(message.result)
			if (previous?.id === next?.id && previous?.role === next?.role) return $.evolve({account: message.result})
			const sameSessionOwner =
				previous !== undefined &&
				next !== undefined &&
				previous.id === next.id &&
				previous.role !== 'Waiting' &&
				next.role !== 'Waiting'
			return $.evolve({
				account: message.result,
				admission: undefined,
				people: AsyncResult.initial(),
				sessions: Boolean.match(sameSessionOwner, {
					onFalse: () => AsyncResult.initial(),
					onTrue: () => $.model.sessions
				}),
				signInError: undefined,
				signOutError: undefined,
				waitingOnly: false
			})
		},
		Admission: ($, message) => {
			if (signed($.model.account)?.id !== message.viewer || $.model.admission?.id !== message.id) return $.model
			if (message.error === undefined) return $.evolve({admission: undefined})
			return $.evolve({admission: {error: message.error, id: message.id, pending: false}})
		},
		Back: $ => {
			if (!isHome($.model.route)) return $.run(Command.asNoop(Router.replace(AuthRoute, AuthRoute.Home({search: {}}))))
			if ($.model.openedFromList) return $.run(Command.asNoop(Router.Back.make({})))
			return $.run(
				Command.asNoop(
					Router.patchSearch(AuthRoute, $.model.route, {pane: undefined, person: undefined}, {scroll: false})
				)
			)
		},
		Choose: ($, message) => {
			const viewer = signed($.model.account)
			if (viewer?.role !== 'Admin') return $.model
			if (message.id === 'all' || message.id === 'waiting') return $.evolve({waitingOnly: message.id === 'waiting'})
			const personId = selectedOf($.model.route)
			if (
				(message.id !== 'approve' && message.id !== 'deny') ||
				personId === undefined ||
				$.model.admission?.pending === true ||
				!Option.exists(readValue($.model.people), rows =>
					Array.some(rows, person => person.id === personId && person.role === 'Waiting')
				)
			) {
				return $.model
			}
			return $.evolve({admission: {id: personId, pending: true}}).run(
				Admit.make({allow: message.id === 'approve', id: personId, viewer: viewer.id})
			)
		},
		Clock: ($, message) => $.evolve({now: message.now}),
		People: ($, message) => {
			const account = signed($.model.account)
			if (account?.id !== message.viewer || account.role !== 'Admin') return $.model
			return $.evolve({people: message.result}).run(...recoverRead(message.result))
		},
		Retry: ($, message) =>
			$.run(Command.asNoop(Refresh.make({reader: message.reader, viewer: signed($.model.account)?.id}))),
		Route: ($, message) => {
			const before = selectedOf($.model.route)
			const after = selectedOf(message.route)
			const next = $.evolve({route: message.route})
			if (!detailIsOpen($.model.route) && detailIsOpen(message.route)) return next.viewTransition(['design-detail-in'])
			if (detailIsOpen($.model.route) && !detailIsOpen(message.route)) return next.viewTransition(['design-detail-out'])
			if (before !== after) return next.viewTransition(['design-layout'])
			return next
		},
		Select: ($, message) => {
			if (!isHome($.model.route) || signed($.model.account)?.role !== 'Admin') return $.model
			const fromList = !detailIsOpen($.model.route)
			return $.evolve({openedFromList: fromList || $.model.openedFromList}).run(
				Command.asNoop(
					Router.patchSearch(
						AuthRoute,
						$.model.route,
						{pane: 'detail', person: message.id},
						{
							history: Boolean.match(fromList, {
								onFalse: Function.constant('replace'),
								onTrue: Function.constant('push')
							}),
							scroll: false
						}
					)
				)
			)
		},
		Sessions: ($, message) => {
			const account = signed($.model.account)
			if (account?.id !== message.viewer || account.role === 'Waiting') return $.model
			return $.evolve({sessions: message.result}).run(...recoverRead(message.result))
		},
		SignIn: $ => {
			if (!isHome($.model.route)) return $.model
			return $.evolve({signInError: undefined}).run(
				pipe(
					StartSignIn.make({next: $.model.route.search.next}),
					Command.match({
						onFailure: error => Message.SignInFailed({error}),
						onSuccess: signedIn => Message.SignInFinished({signedIn})
					})
				)
			)
		},
		SignInFailed: ($, message) => $.evolve({signInError: message.error.message}),
		SignInFinished: ($, message) => {
			if (!message.signedIn) return $.model
			return $.run(Command.asNoop(Refresh.make({reader: 'account', sessionChanged: true})))
		},
		SignOut: $ => {
			if ($.model.signOutError === undefined && signed($.model.account)?.signOut !== true) {
				return $.model
			}
			return $.evolve({signOutError: undefined}).run(
				pipe(
					SignOut.make(),
					Command.match({
						onFailure: error => Message.SignOutFailed({error}),
						onSuccess: () => Message.SignOutFinished()
					})
				)
			)
		},
		SignOutFailed: ($, message) => $.evolve({signOutError: message.error.message}),
		SignOutFinished: $ => {
			if (!$.props.native) return $.model
			return $.evolve({
				account: AsyncResult.initial(),
				people: AsyncResult.initial(),
				sessions: AsyncResult.initial()
			}).run(Command.asNoop(Refresh.make({reader: 'account', sessionChanged: true})))
		}
	}
})

export type Screen = Component.Headless.Parts<typeof AuthScreen>

export function Directory<M, R>(
	h: View.HelperBase<M, unknown>,
	props: Props,
	view: (screen: Screen) => View.Content<M, R>
) {
	return AuthScreen(h, {props, view})
}
