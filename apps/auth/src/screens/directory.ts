import {Command, Component, Router, Subscription} from '@effect/ui'
import type {View} from '@effect/ui'

import {Array, DateTime, Option, Schema, pipe} from 'effect'

import {AsyncResult} from 'effect/reactivity'

import type {Selection, ToolbarAction} from '@deslop/design/model'
import {clockAtom} from '@deslop/runtime/client/clock'
import {blockingFailure, isDeniedCause, needsSignInCause} from '@deslop/runtime/client/live-stream'
import {UserId} from '@deslop/runtime/shared/auth'

import type {SignedAccount} from '#contracts'

import {Admit, Message, Model, RecoverSignIn, Refresh, SignOut, StartSignIn, readValue, signed} from '#screens/model.ts'
import type {Reader} from '#screens/model.ts'
import {watch, watchAuth} from '#screens/reads.ts'
import {AuthRoute, detailIsOpen, isHome, selectedOf} from '#screens/routes.ts'
import {personRow, sessionRow} from '#screens/rows.ts'
import type {AuthRow} from '#screens/rows.ts'

type Notice = {kind: 'notice'; text: string; reader?: Reader | undefined}
export type Entry = {kind: 'row'; row: AuthRow} | {kind: 'skeleton'; id: string} | Notice

function problem(result: AsyncResult.AsyncResult<unknown, unknown>, reader: Reader): readonly Notice[] {
	const failure = Option.getOrUndefined(blockingFailure(result))
	if (failure !== undefined) {
		if (needsSignInCause(failure)) return [{kind: 'notice', text: 'Signing in…'}]
		if (isDeniedCause(failure)) return [{kind: 'notice', text: 'Access denied'}]
		return [{kind: 'notice', text: `Couldn’t load ${reader}`, reader}]
	}
	if (AsyncResult.isFailure(result)) return [{kind: 'notice', text: `Couldn’t refresh ${reader}`, reader}]
	return []
}

function row(row: AuthRow): Entry {
	return {kind: 'row', row}
}

function loading(reader: Reader, count: number): readonly Entry[] {
	return Array.makeBy(count, index => ({id: `loading-${reader}-${index}`, kind: 'skeleton'}))
}

function sessions(model: Model): readonly Entry[] {
	const rows = Option.getOrUndefined(readValue(model.sessions))
	if (rows === undefined && AsyncResult.isInitial(model.sessions)) return loading('sessions', 3)
	const notices = problem(model.sessions, 'sessions')
	if (rows === undefined) return notices
	if (Array.isReadonlyArrayEmpty(rows)) return [{kind: 'notice', text: 'No browser sessions'}, ...notices]
	return [...Array.map(rows, session => row(sessionRow(session, model.now))), ...notices]
}

function people(model: Model, viewer: SignedAccount): readonly Entry[] {
	const rows = readValue(model.people)
	const notices = problem(model.people, 'people')
	return Option.match(rows, {
		onNone: () => notices,
		onSome: rows => {
			const shown = model.waitingOnly ? Array.filter(rows, person => person.role === 'Waiting') : rows
			if (Array.isReadonlyArrayEmpty(shown)) {
				return [{kind: 'notice', text: model.waitingOnly ? 'No requests for approval' : 'No people'}, ...notices]
			}
			return [
				...Array.map(shown, person => row(personRow(person.id === viewer.id ? viewer : person, person, model.now))),
				...notices
			]
		}
	})
}

function showSignOut(viewer: SignedAccount | undefined, pending: boolean): readonly ToolbarAction[] {
	if (viewer?.signOut !== true) return []
	return [{disabled: pending, id: 'sign-out', label: 'Sign out', symbol: 'rectangle.portrait.and.arrow.right'}]
}

function detail(model: Model, viewer: SignedAccount, id: UserId | undefined, signingOut: boolean) {
	const accountProblem = problem(model.account, 'account')
	if (id === undefined || id === viewer.id || viewer.role !== 'Admin') {
		const signOutProblem: readonly Entry[] =
			model.signOutError === undefined ? [] : [{kind: 'notice', text: model.signOutError}]
		return {
			actions: showSignOut(viewer, signingOut),
			entries: [row(personRow(viewer)), ...sessions(model), ...signOutProblem, ...accountProblem]
		}
	}
	const person = pipe(
		readValue(model.people),
		Option.flatMap(rows => Array.findFirst(rows, person => person.id === id)),
		Option.getOrUndefined
	)
	if (person === undefined) {
		function entries(): readonly Entry[] {
			if (AsyncResult.isInitial(model.people)) return loading('people', 1)
			const issues = problem(model.people, 'people')
			if (Array.isReadonlyArrayNonEmpty(issues)) return issues
			return [{kind: 'notice', text: 'Person not found'}]
		}
		return {actions: [], entries: entries()}
	}
	const waiting = person.role === 'Waiting'
	const admission = model.admission?.id === person.id ? model.admission : undefined
	const actions: readonly ToolbarAction[] = waiting
		? [
				{disabled: model.admission?.pending, id: 'deny', label: `Deny @${person.name}`, symbol: 'xmark'},
				{disabled: model.admission?.pending, id: 'approve', label: `Approve @${person.name}`, symbol: 'checkmark'}
			]
		: []
	function entries(): readonly Entry[] {
		if (admission?.error !== undefined) return [{kind: 'notice', text: admission.error}]
		if (!waiting) return [{kind: 'notice', text: 'Only your browser sessions are visible'}]
		return []
	}
	return {actions, entries: [row(personRow(person)), ...entries(), ...accountProblem]}
}

const Props = Schema.Struct({native: Schema.Boolean, route: AuthRoute})
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
			id: selected ?? (detailIsOpen(model.route) ? (viewer?.id ?? 'account-loading') : undefined),
			select: p.part((el, event: string, id: string) =>
				el.on(event, () =>
					Option.getOrUndefined(Option.map(Schema.decodeUnknownOption(UserId)(id), id => Message.Select({id})))
				)
			)
		}
		const choose = p.part((el, event: string, identify: (payload: unknown) => string | undefined) =>
			el.on(event, payload => {
				const id = identify(payload)
				if (id === 'sign-out') return Message.SignOut()
				if (id !== undefined) return Message.Choose({id})
				return undefined
			})
		)
		const retry = p.part((el, event: string, reader: Reader) => el.on(event, Message.Retry({reader})))
		const signIn = p.part((el, event: string) => el.on(event, Message.SignIn()))
		const account = {back, retry, signIn, signingIn}
		if (!isHome(model.route)) return {kind: 'not-found', ...account} as const
		if (AsyncResult.isInitial(model.account)) {
			return {
				accountNotes: [],
				defaultId: undefined,
				detail: [...loading('account', 1), ...(selected === undefined ? loading('sessions', 2) : [])],
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
				...account,
				entries: problem(model.account, 'account'),
				error: model.signInError ?? model.signOutError ?? model.route.search.error,
				kind: 'access',
				state:
					viewer?.role === 'Waiting'
						? 'waiting'
						: Option.exists(readValue(model.account), Option.isNone)
							? 'sign-in'
							: 'refused',
				toolbar: {actions: showSignOut(viewer, signingOut), choose}
			} as const
		}
		const selectedPerson = detail(model, viewer, selected, signingOut)
		if (viewer.role !== 'Admin') {
			return {
				detail: selectedPerson.entries,
				kind: 'sessions',
				selection: {...selection, id: undefined},
				retry,
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
			people: AsyncResult.isInitial(model.people) ? loading('people', 3) : people(model, viewer),
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
						reads => reads.account,
						result => Message.Account({result})
					)
				),
			home &&
				viewer?.role === 'Admin' &&
				Subscription.make('people', viewer.id, id =>
					watchAuth(
						reads => reads.people(id),
						result => Message.People({result, viewer: id})
					)
				),
			home &&
				viewer !== undefined &&
				viewer.role !== 'Waiting' &&
				Subscription.make('sessions', viewer.id, id =>
					watchAuth(
						reads => reads.sessions(id),
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
		Account: ($, {result}) => {
			const previous = signed($.model.account)
			const next = signed(result)
			if (previous?.id === next?.id && previous?.role === next?.role) return $.evolve({account: result})
			const sameSessionOwner =
				previous !== undefined &&
				next !== undefined &&
				previous.id === next.id &&
				previous.role !== 'Waiting' &&
				next.role !== 'Waiting'
			return $.evolve({
				account: result,
				admission: undefined,
				people: AsyncResult.initial(),
				sessions: sameSessionOwner ? $.model.sessions : AsyncResult.initial(),
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
		Choose: ($, {id}) => {
			const viewer = signed($.model.account)
			if (viewer?.role !== 'Admin') return $.model
			if (id === 'all' || id === 'waiting') return $.evolve({waitingOnly: id === 'waiting'})
			const personId = selectedOf($.model.route)
			if (
				(id !== 'approve' && id !== 'deny') ||
				personId === undefined ||
				$.model.admission?.pending === true ||
				!Option.exists(readValue($.model.people), rows =>
					Array.some(rows, person => person.id === personId && person.role === 'Waiting')
				)
			)
				return $.model
			return $.evolve({admission: {id: personId, pending: true}}).run(
				Admit.make({allow: id === 'approve', id: personId, viewer: viewer.id})
			)
		},
		Clock: ($, {now}) => $.evolve({now}),
		People: ($, message) => {
			const account = signed($.model.account)
			if (account?.id !== message.viewer || account.role !== 'Admin') return $.model
			const next = $.evolve({people: message.result})
			if (Option.exists(blockingFailure(message.result), needsSignInCause))
				return next.run(Command.asNoop(RecoverSignIn.make({})))
			return next
		},
		Retry: ($, {reader}) => $.run(Command.asNoop(Refresh.make({reader, viewer: signed($.model.account)?.id}))),
		Route: ($, {route}) => {
			const before = selectedOf($.model.route)
			const after = selectedOf(route)
			const next = $.evolve({route})
			if (!detailIsOpen($.model.route) && detailIsOpen(route)) return next.viewTransition(['design-detail-in'])
			if (detailIsOpen($.model.route) && !detailIsOpen(route)) return next.viewTransition(['design-detail-out'])
			if (before !== after) return next.viewTransition(['design-layout'])
			return next
		},
		Select: ($, {id}) => {
			if (!isHome($.model.route) || signed($.model.account)?.role !== 'Admin') return $.model
			const fromList = !detailIsOpen($.model.route)
			return $.evolve({openedFromList: fromList || $.model.openedFromList}).run(
				Command.asNoop(
					Router.patchSearch(
						AuthRoute,
						$.model.route,
						{pane: 'detail', person: id},
						{history: fromList ? 'push' : 'replace', scroll: false}
					)
				)
			)
		},
		Sessions: ($, message) => {
			const account = signed($.model.account)
			if (account?.id !== message.viewer || account.role === 'Waiting') return $.model
			const next = $.evolve({sessions: message.result})
			if (Option.exists(blockingFailure(message.result), needsSignInCause))
				return next.run(Command.asNoop(RecoverSignIn.make({})))
			return next
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
		SignInFailed: ($, {error}) => $.evolve({signInError: error.message}),
		SignInFinished: ($, {signedIn}) => {
			if (!signedIn) return $.model
			return $.run(Command.asNoop(Refresh.make({reader: 'account', sessionChanged: true})))
		},
		SignOut: $ => {
			if (signed($.model.account)?.signOut !== true) return $.model
			return $.evolve({signOutError: undefined}).run(
				pipe(
					SignOut.make({}),
					Command.match({
						onFailure: error => Message.SignOutFailed({error}),
						onSuccess: () => Message.SignOutFinished({})
					})
				)
			)
		},
		SignOutFailed: ($, {error}) => $.evolve({signOutError: error.message}),
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
	props: typeof Props.Type,
	view: (screen: Screen) => View.Content<M, R>
) {
	return AuthScreen(h, {props, view})
}
