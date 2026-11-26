import {Command, Component, Router, Subscription} from '@effect/ui'
import {Html} from '@effect/ui/html'

import {Array, Boolean, DateTime, Function, Layer, Option, Schema, Stream, pipe} from 'effect'

import {AsyncResult, Atom, AtomRegistry} from 'effect/reactivity'

import {clockAtom} from '@deslop/runtime/client/clock'
import {AppShell} from '@deslop/ui/app-shell'
import {SidebarControl} from '@deslop/ui/glass'

import type {Account, SignedAccount} from '#contracts'

import {PersonActions, SignOut} from '#web/auth/actions.ts'
import {accountAtom, peopleAtom, sessionsAtom} from '#web/auth/client.ts'
import {
	Admit,
	Message,
	Model,
	RedirectToSignIn,
	Refresh,
	StartSignIn,
	readValue,
	signInRequested,
	signed
} from '#web/auth/model.ts'
import type {H} from '#web/auth/model.ts'
import {Notice, ReadProblem} from '#web/auth/status.ts'
import {People, PersonDetail} from '#web/people/view.ts'
import {AuthRoute} from '#web/routes.ts'
import {Sessions} from '#web/sessions/view.ts'
import {SignIn} from '#web/sign-ins/controls.ts'

const isHome = AuthRoute.isAnyOf(['Home'])

const SPLIT = matchMedia('(min-width: 640px), (horizontal-viewport-segments: 2)')

function Detail(h: H, model: Model, viewer: SignedAccount, waitingForPeople: boolean, person?: Account) {
	if (person?.id === viewer.id) {
		// The session stream belongs to the caller, not to the directory selection.
		return [...PersonDetail(h, person, viewer, model.admission), Sessions(h, model.sessions, model.now)]
	}
	if (person !== undefined) return PersonDetail(h, person, viewer, model.admission)
	if (!waitingForPeople) return Notice(h, 'Person not found')
	if (!model.split || model.listHidden) return ReadProblem(h, model.people, 'people')
	return undefined
}

function View(h: H, model: Model) {
	const route = model.route
	if (!isHome(route)) {
		return h.main.class('auth-screen').children(h.a.attr('href', '/').children('Back to Auth'))
	}
	const viewer = signed(model.account)
	if (viewer === undefined) {
		const guest = Option.exists(readValue(model.account), Option.isNone)
		return h.main
			.class('auth-screen')
			.children(guest && SignIn(h, route.search.error), ReadProblem(h, model.account, 'account'))
	}
	if (viewer.role === 'Waiting') {
		return AppShell(h, {
			actions: SignOut(h, viewer),
			content: h.main
				.class('auth-screen auth-waiting')
				.children(
					h.section.class('auth-center').children(h.p.attr('role', 'status').children('Waiting for an admin')),
					ReadProblem(h, model.account, 'account')
				),
			sidebar: undefined
		})
	}
	const admin = viewer.role === 'Admin'
	const rows = Option.getOrUndefined(readValue(model.people))
	const selected = route.search.person ?? viewer.id
	const person = Boolean.match(!admin || selected === viewer.id, {
		onFalse: () => Option.getOrUndefined(Array.findFirst(rows ?? [], row => row.id === selected)),
		onTrue: () => viewer
	})
	const showing = Boolean.match(admin, {
		onFalse: Function.constant('detail'),
		onTrue: () => route.search.pane ?? 'detail'
	})
	const listHidden = !admin || (model.split && model.listHidden)
	const listOpen = !listHidden && (model.split || showing === 'list')
	const detailOpen = model.split || showing === 'detail'
	return AppShell(h, {
		actions: pipe(
			Option.fromUndefinedOr(person),
			Option.filter(() => detailOpen),
			Option.map(selection => PersonActions(h, selection, viewer, model.admission)),
			Option.getOrUndefined
		),
		content: h.main
			.class('fold auth')
			.attrs({
				'data-list-hidden': Boolean.match(listHidden, {
					onFalse: Function.constUndefined,
					onTrue: Function.constant('')
				}),
				'data-show': showing
			})
			.children(
				h.section
					.class('fold-list')
					.attr('aria-label', 'People')
					.children(
						admin &&
							h.div
								.class('auth-list')
								.children(People(h, selected, viewer, model.now, rows), ReadProblem(h, model.people, 'people'))
					),
				h.section
					.class('fold-detail')
					.attr('aria-label', 'Selected person and sessions')
					.children(
						h.div
							.class('auth-detail')
							.children(Detail(h, model, viewer, rows === undefined, person), ReadProblem(h, model.account, 'account'))
					)
			),
		sidebar: admin && SidebarControl(h, listOpen, Message.TogglePeople())
	})
}

const AuthDef = Html.component({message: Message, model: Model, name: 'Auth', props: Schema.Struct({route: AuthRoute})})

export const Auth = Component.provide(
	AuthDef.make({
		init: $ => ({
			account: AsyncResult.initial(),
			listHidden: false,
			now: DateTime.nowUnsafe(),
			people: AsyncResult.initial(),
			route: $.props.route,
			sessions: AsyncResult.initial(),
			split: SPLIT.matches
		}),
		subscriptions: $ => {
			const viewer = signed($.model.account)
			const home = isHome($.model.route)
			return [
				Router.subscription(AuthRoute, $.model.route, route => Message.Route({route})),
				Subscription.make(
					'layout',
					Stream.map(Stream.fromEventListener<MediaQueryListEvent>(SPLIT, 'change'), event =>
						Message.Split({split: event.matches})
					)
				),
				home &&
					Subscription.make(
						'account',
						Stream.map(Atom.toStream(accountAtom), result => Message.Account({result}))
					),
				home &&
					viewer?.role === 'Admin' &&
					Subscription.make('people', viewer.id, id =>
						Stream.map(Atom.toStream(peopleAtom(id)), result => Message.People({result, viewer: id}))
					),
				home &&
					viewer !== undefined &&
					viewer.role !== 'Waiting' &&
					Subscription.make('sessions', viewer.id, id =>
						Stream.map(Atom.toStream(sessionsAtom(id)), result => Message.Sessions({result, viewer: id}))
					),
				home &&
					viewer !== undefined &&
					Subscription.make(
						'clock',
						Stream.map(Atom.toStream(clockAtom('1 minute')), now => Message.Clock({now}))
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
					})
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
			People: ($, message) => {
				const account = signed($.model.account)
				if (account?.id !== message.viewer || account.role !== 'Admin') return $.model
				const next = $.evolve({people: message.result})
				if (signInRequested(message.result)) return next.run(Command.asNoop(RedirectToSignIn.make({})))
				return next
			},
			Retry: ($, message) =>
				$.run(Command.asNoop(Refresh.make({reader: message.reader, viewer: signed($.model.account)?.id}))),
			Route: ($, message) => $.evolve({route: message.route}),
			Select: ($, message) => {
				if (!isHome($.model.route)) return $.model
				return $.run(
					Command.asNoop(
						Router.patchSearch(AuthRoute, $.model.route, {pane: 'detail', person: message.id}, {history: 'push'})
					)
				)
			},
			Sessions: ($, message) => {
				const account = signed($.model.account)
				if (account?.id !== message.viewer || account.role === 'Waiting') return $.model
				const next = $.evolve({sessions: message.result})
				if (signInRequested(message.result)) return next.run(Command.asNoop(RedirectToSignIn.make({})))
				return next
			},
			Split: ($, message) => $.evolve({split: message.split}),
			StartSignIn: $ => {
				if (!isHome($.model.route)) return $.model
				return $.run(Command.asNoop(StartSignIn.make({next: $.model.route.search.next})))
			},
			TogglePeople: $ => {
				if ($.model.split) return $.evolve({listHidden: !$.model.listHidden})
				if (!isHome($.model.route)) return $.model
				const pane = Boolean.match($.model.route.search.pane === 'list', {
					onFalse: Function.constant('list' as const),
					onTrue: Function.constant('detail' as const)
				})
				return $.evolve({listHidden: false}).run(
					Command.asNoop(Router.patchSearch(AuthRoute, $.model.route, {pane}, {history: 'push'}))
				)
			}
		},
		view: View
	}),
	pipe(Admit.layer, Layer.merge(Refresh.layer), Layer.provideMerge(AtomRegistry.layer))
)
