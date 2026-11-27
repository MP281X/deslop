import {Command, Component, Router, Subscription} from '@effect/ui'
import {Html} from '@effect/ui/html'

import {Array, Boolean, DateTime, Function, Layer, Option, Schema} from 'effect'

import {FetchHttpClient} from 'effect/http'
import {AsyncResult, AtomRegistry} from 'effect/reactivity'

import {clockAtom} from '@deslop/runtime/client/clock'
import {ActionShell} from '@deslop/ui/app-shell'
import type {ShellAction} from '@deslop/ui/app-shell'
import {Loading, Notice} from '@deslop/ui/axis'
import {PressFeedback} from '@deslop/ui/control'
import {isNative} from '@deslop/ui/native'
import {Split, singlePane, watchPanes} from '@deslop/ui/split'
import type {Pane} from '@deslop/ui/split'
import {observe} from '@deslop/ui/state'
import {hasHistoryBehind, historyBack, usedHistoryMotion} from '@deslop/ui/viewport'

import type {Account, SignedAccount} from '#contracts'

import {PersonActions, SignOutControl} from '#web/auth/actions.ts'
import {accountAtom, peopleAtom, sessionsAtom} from '#web/auth/client.ts'
import {
	Admit,
	Message,
	Model,
	RedirectToSignIn,
	Refresh,
	SignOut,
	StartNativeSignIn,
	StartSignIn,
	readValue,
	signInRequested,
	signed
} from '#web/auth/model.ts'
import type {H} from '#web/auth/model.ts'
import {DetailSkeleton, ListSkeleton, ReadPane, ReadProblem} from '#web/auth/reading.ts'
import {PeopleMenu, peopleMenu} from '#web/people/menu.ts'
import {People, PersonDetail} from '#web/people/view.ts'
import {AuthRoute} from '#web/routes.ts'
import {Sessions} from '#web/sessions/view.ts'
import {NativeSignIn, SignIn} from '#web/sign-ins/controls.ts'

function routePane(route: Extract<typeof AuthRoute.Type, {_tag: 'Home'}>) {
	if (route.search.pane !== undefined) return route.search.pane
	if (route.search.person !== undefined) return 'detail'
	return 'list'
}

const isHome = AuthRoute.isAnyOf(['Home'])

function paneOf(model: Model) {
	if (!isHome(model.route)) return 'list'
	if (model.listHidden) return 'detail'
	return routePane(model.route)
}

function sidebar(model: Model, listOpen: boolean) {
	if (model.narrow && paneOf(model) === 'detail') {
		return {
			id: 'sidebar',
			message: Message.TogglePeople(),
			symbol: 'chevron.left',
			title: 'Back'
		} satisfies ShellAction<Message>
	}
	return {
		id: 'sidebar',
		message: Message.TogglePeople(),
		pressed: listOpen,
		symbol: 'sidebar.left',
		title: 'Sidebar'
	} satisfies ShellAction<Message>
}

function detailActions(model: Model, viewer: SignedAccount, person?: Account) {
	if (person === undefined) return []
	if (person.id === viewer.id && viewer.signOut) return [SignOutControl(model.signOut === 'pending')]
	return PersonActions(person, model.admission)
}

function Detail(h: H, model: Model, viewer: SignedAccount, listOpen: boolean, person?: Account) {
	if (person?.id === viewer.id) {
		return [...PersonDetail(h, person, viewer, model.admission), Sessions(h, model.sessions, model.now)]
	}
	if (person !== undefined) return PersonDetail(h, person, viewer, model.admission)
	if (AsyncResult.isInitial(model.people)) return Loading(h, 'Loading person', DetailSkeleton(h, false))
	// A failed directory read has one Retry, in People when that pane is visible.
	if (AsyncResult.isFailure(model.people)) return !listOpen && ReadProblem(h, model.people, 'people')
	const rows = readValue(model.people)
	if (listOpen && Option.exists(rows, Array.isReadonlyArrayEmpty)) return undefined
	return Notice(h, 'Person not found')
}

function AccountLoading(h: H, model: Model, selected?: string) {
	return ActionShell(h, {
		actions: [],
		content: Split(h, {
			detail: {
				content: Loading(h, 'Loading person', DetailSkeleton(h, selected === undefined)),
				key: selected ?? 'detail',
				label: 'Selected person and sessions'
			},
			list: {content: Loading(h, 'Loading people', ListSkeleton(h)), label: 'People'},
			listHidden: false,
			narrow: model.narrow,
			show: paneOf(model)
		})
	})
}

function SignOutProblem(h: H, model: Model) {
	return model.signOut === 'failed' && Notice(h, 'Couldn’t sign out', Message.EndSession())
}

function AccessScreen(
	h: H,
	model: Model,
	search: Extract<Model['route'], {_tag: 'Home'}>['search'],
	viewer?: SignedAccount
) {
	if (viewer !== undefined) {
		return ActionShell(h, {
			actions: Boolean.match(viewer.signOut, {
				onFalse: () => [],
				onTrue: () => [SignOutControl(model.signOut === 'pending')]
			}),
			content: h.section
				.class('auth-screen auth-waiting')
				.attr('aria-label', 'Sign-ins')
				.children(Notice(h, 'Waiting for an admin'), SignOutProblem(h, model), ReadProblem(h, model.account, 'account'))
		})
	}
	if (AsyncResult.isInitial(model.account)) return AccountLoading(h, model, search.person)
	const canSignIn = Option.exists(readValue(model.account), Option.isNone)
	if (isNative) return NativeSignIn(h, model, canSignIn)
	return h.div
		.class('auth-screen')
		.children(canSignIn && SignIn(h, search.error), ReadProblem(h, model.account, 'account'))
}

function Directory(h: H, model: Model, viewer: SignedAccount, selected: Account['id']) {
	const admin = viewer.role === 'Admin'
	const person = Boolean.match(!admin || selected === viewer.id, {
		onFalse: () =>
			Option.getOrUndefined(
				Option.flatMap(readValue(model.people), rows => Array.findFirst(rows, row => row.id === selected))
			),
		onTrue: () => viewer
	})
	const show = Boolean.match(admin, {onFalse: Function.constant<Pane>('detail'), onTrue: () => paneOf(model)})
	const listHidden = !admin || model.listHidden
	const listOpen = !listHidden && (!model.narrow || show === 'list')
	const detailOpen = !model.narrow || show === 'detail'
	const menu = peopleMenu(model)
	const actions = detailActions(
		model,
		viewer,
		Boolean.match(detailOpen, {onFalse: Function.constUndefined, onTrue: () => person})
	)

	return ActionShell(h, {
		actions: Boolean.match(listOpen, {onFalse: () => actions, onTrue: () => [menu, ...actions]}),
		content: Split(h, {
			detail: {
				content: h.div.children(
					Detail(h, model, viewer, listOpen, person),
					SignOutProblem(h, model),
					detailOpen && ReadProblem(h, model.account, 'account')
				),
				key: selected,
				label: 'Selected person and sessions'
			},
			list: {
				content:
					admin &&
					h.div.children(
						ReadPane(h, model.people, 'people', ListSkeleton(h), rows =>
							People(
								h,
								rows,
								viewer,
								model.now,
								model.waitingOnly,
								Boolean.match(listOpen && detailOpen, {onFalse: Function.constUndefined, onTrue: () => person?.id})
							)
						),
						!detailOpen && ReadProblem(h, model.account, 'account')
					),
				label: 'People'
			},
			listHidden,
			narrow: model.narrow,
			show
		}),
		overlays: !isNative && listOpen && PeopleMenu(h, model, menu),
		...(admin && {sidebar: sidebar(model, listOpen)})
	})
}

function Workspace(h: H, model: Model) {
	if (!isHome(model.route)) {
		return h.div
			.class('auth-screen')
			.children(h.a.class('axis-control auth-action').attrs({'data-pressable': '', href: '/'}).children('Back to Auth'))
	}
	const viewer = signed(model.account)
	if (viewer === undefined || viewer.role === 'Waiting') return AccessScreen(h, model, model.route.search, viewer)
	return Directory(h, model, viewer, model.route.search.person ?? viewer.id)
}

function View(h: H, model: Model) {
	return h.main.class('auth axis-controls').onMount(PressFeedback({})).children(Workspace(h, model))
}

function recoverSignIn() {
	if (isNative) return Command.asNoop(Refresh.make({reader: 'account'}))
	return Command.asNoop(RedirectToSignIn.make({}))
}

const AuthDef = Html.component({message: Message, model: Model, name: 'Auth', props: Schema.Struct({route: AuthRoute})})

export const Auth = Component.provide(
	AuthDef.make({
		init: $ => ({
			account: AsyncResult.initial(),
			listHidden: false,
			narrow: singlePane(),
			now: DateTime.nowUnsafe(),
			people: AsyncResult.initial(),
			peopleMenuOpen: false,
			route: $.props.route,
			sessions: AsyncResult.initial(),
			waitingOnly: false
		}),
		subscriptions: $ => {
			const viewer = signed($.model.account)
			const home = isHome($.model.route)
			return [
				Router.subscription(AuthRoute, $.model.route, route => Message.Route({route})),
				...watchPanes(() => Message.Posture({narrow: singlePane()})),
				home &&
					Subscription.make(
						'account',
						observe(accountAtom, result => Message.Account({result}))
					),
				home &&
					viewer?.role === 'Admin' &&
					Subscription.make('people', viewer.id, id =>
						observe(peopleAtom(id), result => Message.People({result, viewer: id}))
					),
				home &&
					viewer !== undefined &&
					viewer.role !== 'Waiting' &&
					Subscription.make('sessions', viewer.id, id =>
						observe(sessionsAtom(id), result => Message.Sessions({result, viewer: id}))
					),
				home &&
					viewer !== undefined &&
					Subscription.make(
						'clock',
						observe(clockAtom('1 minute'), now => Message.Clock({now}))
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
					peopleMenuOpen: false,
					sessions: Boolean.match(sameSessionOwner, {
						onFalse: () => AsyncResult.initial(),
						onTrue: () => $.model.sessions
					}),
					signIn: undefined,
					signOut: undefined,
					waitingOnly: false
				})
			},
			Admission: ($, message) => {
				if (signed($.model.account)?.id !== message.viewer || $.model.admission?.id !== message.id) return $.model
				if (message.error === undefined) return $.evolve({admission: undefined})
				return $.evolve({admission: {error: message.error, id: message.id, pending: false}})
			},
			Answer: ($, message) => {
				const viewer = signed($.model.account)
				if (
					viewer?.role !== 'Admin' ||
					$.model.admission?.pending === true ||
					!isHome($.model.route) ||
					$.model.route.search.person !== message.id ||
					!Option.exists(readValue($.model.people), rows =>
						Array.some(rows, person => person.id === message.id && person.role === 'Waiting')
					)
				) {
					return $.model
				}
				return $.evolve({admission: {id: message.id, pending: true}}).run(
					Admit.make({allow: message.allow, id: message.id, viewer: viewer.id})
				)
			},
			Clock: ($, message) => $.evolve({now: message.now}),
			EndSession: $ => {
				if (signed($.model.account)?.signOut !== true || $.model.signOut === 'pending') return $.model
				return $.evolve({signOut: 'pending'}).run(SignOut.make({}))
			},
			FilterPeople: ($, message) => $.evolve({peopleMenuOpen: false, waitingOnly: message.waitingOnly}),
			People: ($, message) => {
				const account = signed($.model.account)
				if (account?.id !== message.viewer || account.role !== 'Admin') return $.model
				const next = $.evolve({people: message.result})
				if (signInRequested(message.result)) return next.run(recoverSignIn())
				return next
			},
			PeopleMenu: ($, message) => $.evolve({peopleMenuOpen: message.open}),
			Posture: ($, message) => {
				if ($.model.narrow === message.narrow) return $.model
				return $.evolve({narrow: message.narrow, peopleMenuOpen: false}).viewTransition(['axis-layout'])
			},
			Retry: ($, message) =>
				$.run(Command.asNoop(Refresh.make({reader: message.reader, viewer: signed($.model.account)?.id}))),
			Route: ($, message) => {
				const after = {
					...$.model,
					listHidden: isHome(message.route) && routePane(message.route) === 'detail' && $.model.listHidden,
					peopleMenuOpen: false,
					route: message.route
				}
				const next = $.set(after)
				if (usedHistoryMotion()) return next
				const pane = paneOf(after)
				if (after.narrow) {
					if (pane === paneOf($.model)) return next
					if (pane === 'detail') return next.viewTransition(['axis-open'])
					return next.viewTransition(['axis-back'])
				}
				if (isHome($.model.route) && isHome(after.route) && $.model.route.search.person !== after.route.search.person) {
					return next.viewTransition(['axis-layout'])
				}
				return next
			},
			Select: ($, message) => {
				if (!isHome($.model.route)) return $.model
				const history = Boolean.match(routePane($.model.route) === 'list', {
					onFalse: Function.constant('replace' as const),
					onTrue: Function.constant('push' as const)
				})
				return $.run(
					Command.asNoop(Router.patchSearch(AuthRoute, $.model.route, {pane: 'detail', person: message.id}, {history}))
				)
			},
			Sessions: ($, message) => {
				const account = signed($.model.account)
				if (account?.id !== message.viewer || account.role === 'Waiting') return $.model
				const next = $.evolve({sessions: message.result})
				if (signInRequested(message.result)) return next.run(recoverSignIn())
				return next
			},
			SignInSettled: ($, message) => {
				if (message.failed) return $.evolve({signIn: 'failed'})
				const next = $.evolve({signIn: undefined})
				if (message.signedIn) return next.run(Command.asNoop(Refresh.make({reader: 'account', sessionChanged: true})))
				return next
			},
			SignOutSettled: ($, message) => {
				if (message.failed) return $.evolve({signOut: 'failed'})
				const next = $.evolve({signOut: undefined})
				if (isNative) return next.run(Command.asNoop(Refresh.make({reader: 'account', sessionChanged: true})))
				return next
			},
			StartSignIn: $ => {
				if (!isHome($.model.route)) return $.model
				if (isNative) {
					if ($.model.signIn === 'pending') return $.model
					return $.evolve({signIn: 'pending'}).run(StartNativeSignIn.make({}))
				}
				return $.run(Command.asNoop(StartSignIn.make({next: $.model.route.search.next})))
			},
			TogglePeople: $ => {
				if (!isHome($.model.route)) return $.model
				if (!$.model.narrow) {
					return $.evolve({listHidden: !$.model.listHidden, peopleMenuOpen: false}).viewTransition(['axis-layout'])
				}
				if (paneOf($.model) === 'detail') {
					if (routePane($.model.route) === 'list') {
						return $.evolve({listHidden: false}).viewTransition(['axis-back'])
					}
					if (
						hasHistoryBehind(previous => {
							if (previous.pathname !== '/') return false
							const pane = previous.searchParams.get('pane')
							return pane === 'list' || (pane === null && !previous.searchParams.has('person'))
						})
					) {
						return $.run(historyBack)
					}
					return $.run(Command.asNoop(Router.patchSearch(AuthRoute, $.model.route, {pane: 'list', person: undefined})))
				}
				return $.run(Command.asNoop(Router.patchSearch(AuthRoute, $.model.route, {pane: 'detail'}, {history: 'push'})))
			}
		},
		view: View
	}),
	Layer.provideMerge(
		Layer.mergeAll(Admit.layer, Refresh.layer, SignOut.layer),
		Layer.merge(AtomRegistry.layer, FetchHttpClient.layer)
	)
)
