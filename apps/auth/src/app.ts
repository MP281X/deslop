import {Command, Component, Router, Subscription, UiSchema} from '@effect/ui'

import type {DateTime} from 'effect'
import {Array, Boolean, Option, Schema, pipe} from 'effect'

import {AsyncResult} from 'effect/reactivity'

import type {ToolbarOptions} from '@deslop/components/model'
import {needsSignInCause, blockingFailure} from '@deslop/runtime/client/live-stream'
import {goBack, listBehind, openItem, selection, shellApp, slide} from '@deslop/runtime/client/shell'
import type {AppScreen} from '@deslop/runtime/client/shell'
import {UserId} from '@deslop/runtime/shared/auth'
import {DateTimeUtcFromFiniteMillis} from '@deslop/runtime/shared/time'

import {
	Admit,
	AuthRoute,
	Reader,
	RecoverSignIn,
	Refresh,
	ReturnTo,
	SignOut,
	StartSignIn,
	isDetail,
	isHome,
	readAuth,
	readValue,
	selectedOf
} from './reads.ts'

import type {SignedAccount} from '#identity/contract.ts'
import {identityFields, identityMessages, accessState, showSignOut, signed} from '#identity/screen.ts'
import {
	filterAction,
	loading,
	notice,
	peopleEntries,
	peopleFields,
	peopleMessages,
	personDetail,
	personRow,
	problem,
	row
} from '#people/screen.ts'
import type {RetryTarget} from '#people/screen.ts'
import {sessionEntries, sessionsFields, sessionsMessages} from '#sessions/screen.ts'

// The screen's model and messages: each feature's part, and the route's. The shell owns the clock.
type Model = typeof Model.Type
const Model = Schema.Struct({
	...identityFields,
	...peopleFields,
	...sessionsFields,
	hasListBehind: Schema.Boolean,
	route: AuthRoute
})

const Message = UiSchema.TaggedEnum({
	...identityMessages,
	...peopleMessages,
	...sessionsMessages,
	Back: {},
	Retry: {reader: Reader},
	Route: {route: AuthRoute}
})

function signOutNotices(error: Model['signOutError']) {
	return pipe(
		Option.fromUndefinedOr(error),
		Option.map(text => notice(text, 'sign-out')),
		Option.toArray
	)
}

function recoverRead(result: AsyncResult.AsyncResult<unknown, unknown>) {
	if (Option.exists(blockingFailure(result), needsSignInCause)) return [Command.asNoop(RecoverSignIn.make({}))]
	return []
}

// An account that signed in with somewhere to go goes there.
function returnAfter(route: AuthRoute, account?: SignedAccount) {
	if (!isHome(route) || route.search.next === undefined || account === undefined || account.role === 'Waiting') {
		return []
	}
	return [Command.asNoop(ReturnTo.make({next: route.search.next}))]
}

function detailOf(model: Model, viewer: SignedAccount, signingOut: boolean, now: DateTime.Utc, id?: UserId) {
	const account = problem(model.account, 'account')
	const signOut = signOutNotices(model.signOutError)
	if (id === undefined || id === viewer.id || viewer.role !== 'Admin') {
		return {
			actions: showSignOut(signingOut, viewer),
			entries: [row(personRow(viewer)), ...sessionEntries(model.sessions, now), ...signOut, ...account]
		}
	}
	return personDetail(model.people, id, {account, signOut}, model.admission)
}

const Screen = Component.define({
	message: Message,
	model: Model,
	name: 'AuthScreen',
	props: Schema.Struct({now: DateTimeUtcFromFiniteMillis, route: AuthRoute})
}).make({
	init: $ => ({
		account: AsyncResult.initial(),
		hasListBehind: false,
		people: AsyncResult.initial(),
		route: $.props.route,
		sessions: AsyncResult.initial(),
		waitingOnly: false
	}),
	parts: (p, model) => {
		const now = p.props.now
		const viewer = signed(model.account)
		const selected = selectedOf(model.route)
		const signingOut = p.isRunning(SignOut)
		const open = selection(p, {
			back: Message.Back(),
			id: selected ?? viewer?.id ?? 'account-loading',
			open: isDetail(model.route),
			select: id => Message.Select({id: UserId.make(id)})
		})
		const choose = p.part((el, event: string, identify: Parameters<ToolbarOptions['choose']>[2]) =>
			el.on(event, payload => {
				const id = identify(payload)
				if (id === 'sign-out') return Message.SignOut()
				if (id !== undefined) return Message.Choose({id})
				return undefined
			})
		)
		const reload = p.part((el, event: string, target: RetryTarget) => {
			if (target === 'sign-out') return el.on(event, Message.SignOut())
			return el.on(event, Message.Retry({reader: target}))
		})
		// Auth draws its own refusals and its own missing page, so the shell has none to put in their place.
		const answered = {reads: [], routeMissing: false} as const
		if (!isHome(model.route)) return {...answered, back: open.back, kind: 'not-found'} as const
		if (AsyncResult.isInitial(model.account)) {
			return {
				...answered,
				accountNotes: [],
				detail: [
					...loading('account', 1),
					...Boolean.match(selected === undefined, {onFalse: () => [], onTrue: () => loading('sessions', 2)})
				],
				detailToolbar: [],
				id: undefined,
				kind: 'directory',
				loading: false,
				people: loading('people', 3),
				reload,
				selection: open,
				toolbar: {actions: [], choose}
			} as const
		}
		if (viewer === undefined || viewer.role === 'Waiting') {
			return {
				...answered,
				entries: [...signOutNotices(model.signOutError), ...problem(model.account, 'account')],
				error: model.signInError ?? model.route.search.error,
				kind: 'access',
				reload,
				signIn: p.part((el, event: string) => el.on(event, Message.SignIn())),
				startingSignIn: p.isRunning(StartSignIn),
				state: accessState(model.account, viewer),
				toolbar: {actions: showSignOut(signingOut, viewer), choose}
			} as const
		}
		const selectedPerson = detailOf(model, viewer, signingOut, now, selected)
		if (viewer.role !== 'Admin') {
			return {
				...answered,
				detail: selectedPerson.entries,
				kind: 'sessions',
				reload,
				selection: {...open, id: undefined},
				toolbar: {actions: selectedPerson.actions, choose}
			} as const
		}
		return {
			...answered,
			accountNotes: problem(model.account, 'account'),
			detail: selectedPerson.entries,
			detailToolbar: selectedPerson.actions,
			id: viewer.id,
			kind: 'directory',
			loading: false,
			people: Boolean.match(AsyncResult.isInitial(model.people), {
				onFalse: () => peopleEntries(model.people, model.waitingOnly, viewer, now),
				onTrue: () => loading('people', 3)
			}),
			reload,
			selection: open,
			toolbar: {actions: [filterAction(model.waitingOnly)], choose}
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
					readAuth(
						reads => reads.accountAtom,
						result => Message.Account({result})
					)
				),
			home &&
				viewer?.role === 'Admin' &&
				Subscription.make('people', viewer.id, id =>
					readAuth(
						reads => reads.peopleAtoms(id),
						result => Message.People({result, viewer: id})
					)
				),
			home &&
				viewer !== undefined &&
				viewer.role !== 'Waiting' &&
				Subscription.make('sessions', viewer.id, id =>
					readAuth(
						reads => reads.sessionAtoms(id),
						result => Message.Sessions({result, viewer: id})
					)
				)
		]
	},
	update: {
		Account: ($, message) => {
			const previous = signed($.model.account)
			const next = signed(message.result)
			const returning = returnAfter($.model.route, next)
			if (previous?.id === next?.id && previous?.role === next?.role) {
				return $.evolve({account: message.result}).run(...returning)
			}
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
			}).run(...returning)
		},
		Admission: ($, message) => {
			if (signed($.model.account)?.id !== message.viewer || $.model.admission?.id !== message.id) return $.model
			if (message.error === undefined) return $.evolve({admission: undefined})
			return $.evolve({admission: {error: message.error, id: message.id, pending: false}})
		},
		Back: $ => $.run(goBack($.model, AuthRoute.Home({search: {}}), {pane: undefined, person: undefined})),
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
				pipe(
					Admit.make({allow: message.id === 'approve', id: personId}),
					Command.match({
						onFailure: error => Message.Admission({error, id: personId, viewer: viewer.id}),
						onSuccess: () => Message.Admission({id: personId, viewer: viewer.id})
					})
				)
			)
		},
		People: ($, message) => {
			const account = signed($.model.account)
			if (account?.id !== message.viewer || account.role !== 'Admin') return $.model
			return $.evolve({people: message.result}).run(...recoverRead(message.result))
		},
		Retry: ($, message) =>
			$.run(Command.asNoop(Refresh.make({reader: message.reader, viewer: signed($.model.account)?.id}))),
		Route: ($, message) => {
			const next = $.evolve({route: message.route})
			if (isDetail($.model.route) !== isDetail(message.route)) {
				return slide(next, isDetail, $.model.route, message.route)
			}
			if (selectedOf($.model.route) !== selectedOf(message.route)) return next.viewTransition(['design-layout'])
			return next
		},
		Select: ($, message) => {
			if (!isHome($.model.route) || signed($.model.account)?.role !== 'Admin') return $.model
			return $.evolve({hasListBehind: listBehind($.model, isDetail)}).run(
				openItem($.model.route, isDetail, {pane: 'detail', person: message.id})
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
			if ($.model.signOutError === undefined && signed($.model.account)?.signOut !== true) return $.model
			return $.evolve({signOutError: undefined}).run(
				pipe(
					SignOut.make(),
					Command.match({
						onFailure: error => Message.SignOutFailed({error}),
						onSuccess: stays => Message.SignOutFinished({stays})
					})
				)
			)
		},
		SignOutFailed: ($, message) => $.evolve({signOutError: message.error.message}),
		SignOutFinished: ($, message) => {
			if (!message.stays) return $.model
			return $.evolve({
				account: AsyncResult.initial(),
				people: AsyncResult.initial(),
				sessions: AsyncResult.initial()
			}).run(Command.asNoop(Refresh.make({reader: 'account', sessionChanged: true})))
		}
	}
})

export type AuthScreen = AppScreen<Component.Headless.Parts<typeof Screen>>

export const AuthApp = shellApp({
	every: '1 minute',
	missing: 'Page not found',
	name: 'Auth',
	props: Schema.Struct({route: AuthRoute}),
	screen: Screen
})
