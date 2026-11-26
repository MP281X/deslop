import {Command, Component, Router, Subscription} from '@effect/ui'
import {Html} from '@effect/ui/html'

import {Array, Boolean, DateTime, Function, Layer, Option, Schema, Stream, pipe} from 'effect'

import {AsyncResult, Atom, AtomRegistry} from 'effect/reactivity'

import {clockAtom} from '@deslop/runtime/client/clock'
import type {UserId} from '@deslop/runtime/shared/auth'

import {accountAtom, peopleAtom, sessionsAtom} from '#lib/auth.ts'
import {
	Admit,
	AuthRoute,
	Message,
	Model,
	RedirectToSignIn,
	Refresh,
	StartSignIn,
	readValue,
	signInRequested,
	signed
} from '#routes/(home)/-model.ts'
import {Notice, People, PersonDetail, ReadProblem, Sessions, Sidebar, SignIn, SignOut} from '#routes/(home)/-panes.ts'
import type {Person, SignedAccount} from '#services/people/schema.ts'

const isHome = AuthRoute.isAnyOf(['Home'])

type H = Html.H<Message>

function Detail(h: H, model: Model, viewer: SignedAccount, selected: UserId, rows?: readonly Person[]) {
	// The session stream belongs to the caller, not to the directory selection.
	if (selected === viewer.id) {
		return [...PersonDetail(h, viewer, viewer, model.admission), Sessions(h, model.sessions, model.now)]
	}
	if (rows === undefined) {
		return h.div.class(!model.listHidden && 'auth-narrow').children(ReadProblem(h, model.people, 'people'))
	}
	return pipe(
		rows,
		Array.findFirst(person => person.id === selected),
		Option.match({
			onNone: () => Notice(h, 'Person not found'),
			onSome: person => PersonDetail(h, person, viewer, model.admission)
		})
	)
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
		return h.main
			.class('auth-screen')
			.children(
				h.section
					.class('auth-center')
					.children(h.p.attr('role', 'status').children('Waiting for an admin'), SignOut(h, viewer)),
				ReadProblem(h, model.account, 'account')
			)
	}
	const admin = viewer.role === 'Admin'
	const rows = Option.getOrUndefined(readValue(model.people))
	const selected = Boolean.match(admin, {onFalse: () => viewer.id, onTrue: () => route.search.person ?? viewer.id})
	const showing = Boolean.match(admin, {
		onFalse: Function.constant('detail'),
		onTrue: () => route.search.pane ?? 'detail'
	})
	return h.main
		.class('fold auth')
		.attrs({
			'data-list-hidden': Boolean.match(!admin || model.listHidden, {
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
							.children(
								Sidebar(h, true, Message.TogglePeople(), 'auth-wide'),
								Sidebar(h, true, Message.ShowPane({pane: 'detail'}), 'auth-narrow'),
								People(h, selected, viewer, model.now, rows),
								ReadProblem(h, model.people, 'people')
							)
				),
			h.section
				.class('fold-detail')
				.attr('aria-label', 'Selected person and sessions')
				.children(
					h.div
						.class('auth-detail')
						.children(
							admin && Sidebar(h, false, Message.ShowPane({pane: 'list'}), 'auth-narrow'),
							admin && model.listHidden && Sidebar(h, false, Message.TogglePeople(), 'auth-wide'),
							Detail(h, model, viewer, selected, rows),
							ReadProblem(h, model.account, 'account')
						)
				)
		)
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
			sessions: AsyncResult.initial()
		}),
		subscriptions: $ => {
			const viewer = signed($.model.account)
			const home = isHome($.model.route)
			return [
				Router.subscription(AuthRoute, $.model.route, route => Message.Route({route})),
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
			ShowPane: ($, message) => {
				if (!isHome($.model.route)) return $.model
				return $.evolve({listHidden: false}).run(
					Command.asNoop(Router.patchSearch(AuthRoute, $.model.route, {pane: message.pane}, {history: 'push'}))
				)
			},
			StartSignIn: $ => {
				if (!isHome($.model.route)) return $.model
				return $.run(Command.asNoop(StartSignIn.make({next: $.model.route.search.next})))
			},
			TogglePeople: $ => $.evolve({listHidden: !$.model.listHidden})
		},
		view: View
	}),
	pipe(Admit.layer, Layer.merge(Refresh.layer), Layer.provideMerge(AtomRegistry.layer))
)
