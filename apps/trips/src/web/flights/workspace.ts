import {Command, Component, Router, Subscription} from '@effect/ui'
import {Html} from '@effect/ui/html'

import {
	Array,
	Boolean,
	Cause,
	DateTime,
	Effect,
	Function,
	Layer,
	Option,
	Predicate,
	Queue,
	Schema,
	Stream,
	String,
	pipe
} from 'effect'

import {App} from '@capacitor/app'
import {AsyncResult, AtomRegistry} from 'effect/reactivity'

import {clockAtom} from '@deslop/runtime/client/clock'
import {blockingFailure, needsSignInCause} from '@deslop/runtime/client/live-stream'
import {isDenied} from '@deslop/runtime/shared/auth'
import {AppShell} from '@deslop/ui/app-shell'
import {Button} from '@deslop/ui/control'
import {Glass, GlassPanel, SidebarControl} from '@deslop/ui/glass'

import type {Flight, FlightId, FlightList, TravelTime} from '#contracts'
import {arrivalClockOf, bookedOf, departureOf, labelled, line, routeOf, titleOf} from '#journey'

import {AirportActions, AirportBy, Board, dayAt, NextStep, Row} from '#web/flights/boarding-pass.ts'
import {flightsAtom, travelAtom} from '#web/flights/data.ts'
import {opened} from '#web/flights/deep-links.ts'
import {
	boardOf,
	datesOf,
	departureTimes,
	nextBoardOf,
	nextHero,
	openedFlight,
	pastOf,
	tripOf,
	troubleOf
} from '#web/flights/itinerary.ts'
import {Auth, Message, Model, Reload, SaveFile, SaveText, SetTripTime, failed} from '#web/flights/model.ts'
import {listener, pushAtom} from '#web/flights/notifications.ts'
import {accountAtom, native} from '#web/flights/session.ts'
import {TripsRoute} from '#web/routes.ts'

type H = Html.H<Message>

function FlightRow(h: H, flight: Flight, now: Model['now'], selected?: FlightId) {
	const times = departureTimes(flight)
	const date = DateTime.format(departureOf(flight), {
		day: 'numeric',
		locale: 'en-GB',
		month: 'short',
		timeZone: flight.from.timeZone
	})
	const today = DateTime.format(now, {day: 'numeric', locale: 'en-GB', month: 'short', timeZone: flight.from.timeZone})
	return h.a
		.key(flight.id)
		.class('axis-row')
		.attrs({
			'aria-current': Option.getOrUndefined(Option.liftPredicate('true', () => selected === flight.id)),
			href: `/flight/${flight.id}`
		})
		.on('click', () => Message.Select({id: flight.id}), {preventDefault: true})
		.children(
			Row(h, {
				line: line([
					Option.some(titleOf(flight)),
					labelled(
						'Gate',
						Option.flatMap(flight.live, live => live.departureGate)
					),
					Option.some(
						Boolean.match(date === today, {
							onFalse: Function.constant(date),
							onTrue: () => `Lands ${arrivalClockOf(flight)}`
						})
					)
				]),
				problem: Option.map(troubleOf(flight, now), problem => problem.reason),
				title: routeOf(flight),
				value: times.value,
				was: times.was
			})
		)
}

function List(h: H, model: Model, flights: FlightList, travel: readonly TravelTime[], selected?: FlightId) {
	const trip = tripOf(flights, model.now)
	const upcoming = [
		...trip.flights,
		...Array.flatMap(datesOf(flights, model.now, trip.flights), date => Array.map(date.rows, row => row.flight))
	]
	const past = pastOf(flights, model.now)
	return [
		Array.isArrayEmpty(upcoming) && h.p.class('trips-notice').children('No upcoming flights'),
		...Array.map(upcoming, flight => FlightRow(h, flight, model.now, selected)),
		...pipe(
			Array.head(upcoming),
			Option.map(flight => {
				if (!dayAt(flight, flights, model.now, travel).toAirport) return []
				return [
					pipe(
						nextHero(flights, model.now, travel),
						Option.filter(hero => hero.label === 'Leave by'),
						Option.map(hero =>
							h.div
								.class('axis-row')
								.children(Row(h, {line: hero.right, title: 'Leave', value: Option.some(hero.value)}))
						),
						Option.getOrUndefined
					),
					AirportBy(h, flight)
				]
			}),
			Option.getOrElse(Array.empty)
		),
		Array.isArrayNonEmpty(past) &&
			Button(h)
				.class('axis-row')
				.attr('aria-expanded', `${model.pastOpen}`)
				.on('click', () => Message.TogglePast())
				.children(Row(h, {title: 'Past flights', value: Option.some(`${past.length}`)})),
		...pipe(
			past,
			Array.filter(() => model.pastOpen),
			Array.map(flight => FlightRow(h, flight, model.now, selected))
		)
	]
}

function Action(h: H, label: string, message: Message, disabled = false) {
	return Button(h, {disabled})
		.class('trips-control')
		.on('click', () => message)
		.children(label)
}

function Notice(h: H, title: string, action?: ReturnType<typeof Action>, error?: string) {
	return h.div
		.class('trips-notice')
		.attr('role', 'status')
		.children(
			h.p.children(title),
			error !== undefined && h.p.class('axis-muted').children(error),
			action !== undefined && Glass(h).children(action)
		)
}

function Paste(h: H, model: Model) {
	return GlassPanel(
		h,
		'trips-booking',
		'Paste booking',
		h.form
			.class('trips-booking')
			.on('submit', () => Message.PasteSubmit(), {preventDefault: true})
			.children(
				h.label.children(
					'Paste booking text or link',
					h.textarea
						.attrs({disabled: Option.getOrUndefined(Option.liftPredicate('', () => model.pending)), rows: '4'})
						.value(model.pastedText)
						.on('input', event => Message.PasteText({text: event.value}))
				),
				h.label.class('trips-file').children(
					'Or choose an image or PDF',
					h.input
						.key(
							Boolean.match(model.pasteOpen, {onFalse: Function.constant('closed'), onTrue: Function.constant('open')})
						)
						.attrs({
							accept: 'image/*,application/pdf',
							disabled: Option.getOrUndefined(Option.liftPredicate('', () => model.pending)),
							type: 'file'
						})
						.value('')
						.on('change', event =>
							Option.getOrUndefined(Option.map(Array.head(event.files), file => Message.PasteFile({file})))
						)
				),
				model.error !== undefined && h.p.attr('role', 'alert').children(model.error),
				h.div.class('trips-booking-actions').children(
					Action(h, 'Cancel', Message.PasteVisibility({open: false}), model.pending),
					Button(h, {disabled: model.pending || String.isEmpty(String.trim(model.pastedText)), type: 'submit'})
						.class('trips-control')
						.children(
							Boolean.match(model.pending, {onFalse: Function.constant('Add'), onTrue: Function.constant('Adding…')})
						)
				)
			)
	)
		.popover('auto', model.pasteOpen)
		.on('toggle', event => Message.PasteVisibility({open: event.open}))
}

function Itinerary(h: H, model: Model, flights: FlightList, travel: readonly TravelTime[], selected?: FlightId) {
	return h.section
		.class('fold-list')
		.attr('aria-label', 'Flights')
		.children(h.div.class('trips-pane').children(...List(h, model, flights, travel, selected)))
}

function BoardingPass(
	h: H,
	model: Model,
	flights: FlightList,
	travel: readonly TravelTime[],
	view: {flight: Option.Option<Flight>; opened: boolean; posture: ReturnType<typeof nextBoardOf>}
) {
	const stale = AsyncResult.isFailure(model.flights)
	return h.section
		.class('fold-detail')
		.attr('aria-label', 'Boarding pass')
		.children(
			h.div.class('trips-pane').children(
				stale &&
					h.div
						.class('trips-stale')
						.children(h.span.class('axis-dot'), 'Out of date', Action(h, 'Retry', Message.Retry())),
				Option.getOrUndefined(
					Option.map(view.posture, posture =>
						h.div.class('trips-half').children(NextStep(h, posture.hero, Option.getOrUndefined(posture.line)))
					)
				),
				Option.match(view.flight, {
					onNone: () => {
						if (!view.opened) return h.p.class('trips-notice').children('No upcoming flights')
						if (stale) return h.p.class('trips-notice').children('Flight not loaded')
						return h.p.class('trips-notice').children('Flight not found')
					},
					onSome: found =>
						h.div
							.class('trips-pass')
							.attr('data-half-step', Option.getOrUndefined(Option.as(view.posture, '')))
							.children(...Board(h, found, flights, model.now, travel))
				}),
				!model.pasteOpen &&
					model.error !== undefined &&
					h.p.class('trips-notice').attr('role', 'alert').children(model.error)
			)
		)
}

function AccountFailureNotice(h: H, model: Model) {
	if (!AsyncResult.isFailure(model.account) || Option.isSome(AsyncResult.value(model.account))) return undefined
	if (needsSignInCause(model.account.cause)) {
		return Notice(
			h,
			'Sign in with Auth',
			Action(
				h,
				Boolean.match(model.pending, {
					onFalse: Function.constant('Sign in'),
					onTrue: Function.constant('Opening Auth…')
				}),
				Message.SignIn(),
				model.pending
			),
			model.error
		)
	}
	if (isDenied(Cause.squash(model.account.cause))) {
		return Notice(h, 'Access denied', Action(h, 'Retry', Message.Retry()))
	}
	return Notice(h, 'Couldn’t load Trips', Action(h, 'Retry', Message.Retry()))
}

function ActionIcon(h: H, path: string) {
	return h
		.el('svg')
		.attrs({'aria-hidden': 'true', fill: 'none', stroke: 'currentColor', 'stroke-width': '1.5', viewBox: '0 0 24 24'})
		.children(h.el('path').attr('d', path))
}

function SignOut(h: H, model: Model) {
	if (!Option.exists(AsyncResult.value(model.account), account => account.signOut)) return undefined
	const icon = ActionIcon(h, 'M10 5H4v14h6m-1-7h12m-5-5 5 5-5 5')
	if (native) {
		return Button(h, {disabled: model.pending})
			.attr('aria-label', 'Sign out')
			.on('click', () => Message.SignOut())
			.children(icon)
	}
	return h.form
		.attrs({action: '/auth/sign-out', method: 'post'})
		.children(Button(h, {type: 'submit'}).attr('aria-label', 'Sign out').children(icon))
}

function Workspace(h: H, model: Model) {
	const accountFailure = AccountFailureNotice(h, model)
	if (accountFailure !== undefined) return accountFailure
	if (Option.isNone(AsyncResult.value(model.account))) return Notice(h, 'Loading Trips…')
	const blocking = Option.getOrUndefined(blockingFailure(model.flights))
	if (blocking !== undefined) {
		return Notice(h, 'Couldn’t load flights', Action(h, 'Retry', Message.Retry()), failed(blocking))
	}
	const flights = Option.getOrUndefined(AsyncResult.value(model.flights))
	if (flights === undefined) return Notice(h, 'Loading flights…')
	if (TripsRoute.isAnyOf(['NotFound'])(model.route)) {
		return h.div
			.class('trips-notice')
			.children(h.p.children('Flight not found'), h.a.attr('href', '/').children('Back to Trips'))
	}
	const travel = Option.getOrElse(AsyncResult.value(model.travel), Array.empty<TravelTime>)
	const board = boardOf(flights, model.now)
	const target = TripsRoute.match(model.route, {
		Day: route => Option.some({day: true, id: route.params.id}),
		Flight: route => Option.some({day: false, id: route.params.id}),
		Home: () => Option.none(),
		NotFound: () => Option.none()
	})
	const selected = Option.match(target, {
		onNone: () => Option.map(board, flight => flight.id),
		onSome: link => Option.some(openedFlight(flights, link, model.now))
	})
	const flight = Option.flatMap(selected, id => Array.findFirst(flights, item => item.id === id))
	const hasDetail = Option.isSome(flight) || Option.isSome(target)
	const hideList = hasDetail && model.listHidden
	const showList = !hasDetail || model.showList
	const airport = Option.filter(
		flight,
		found => (Option.isSome(found.from.code) || bookedOf(found)) && dayAt(found, flights, model.now, travel).toAirport
	)
	return AppShell(h, {
		actions: [
			Button(h, {disabled: model.pending})
				.attrs({'aria-label': 'Paste booking', popovertarget: 'trips-booking'})
				.children(ActionIcon(h, 'M9 5H5v16h14V5h-4m-6-2h6v4H9zM9 14h6m-3-3v6')),
			Option.isSome(airport) &&
				Button(h, {disabled: model.pending})
					.attrs({'aria-label': 'Airport travel', popovertarget: 'trips-airport'})
					.children(ActionIcon(h, 'm3 11 18-8-8 18-3-7z')),
			SignOut(h, model)
		],
		content: h.main
			.class('fold trips')
			.attrs({
				'data-list-hidden': Option.getOrUndefined(Option.liftPredicate('', () => hideList)),
				'data-show': Boolean.match(showList, {onFalse: Function.constant('detail'), onTrue: Function.constant('list')})
			})
			.children(
				Itinerary(h, model, flights, travel, Option.getOrUndefined(selected)),
				BoardingPass(h, model, flights, travel, {
					flight,
					opened: Option.isSome(target),
					posture: Option.filter(nextBoardOf(flights, model.now), () => Option.isNone(target))
				}),
				Paste(h, model),
				Option.getOrUndefined(Option.map(airport, found => AirportActions(h, found, travel, model.pending)))
			),
		sidebar: h.div
			.class('trips-sidebar')
			.children(
				hasDetail &&
					h.div
						.class('trips-sidebar-compact')
						.children(SidebarControl(h, showList && !hideList, Message.ShowList({list: !showList || hideList}))),
				hasDetail && h.div.class('trips-sidebar-wide').children(SidebarControl(h, !hideList, Message.ToggleList()))
			)
	})
}

const Def = Html.component({message: Message, model: Model, name: 'Trips', props: Schema.Struct({route: TripsRoute})})

const pastedImage = Stream.callback<Message>(queue => {
	function paste(event: ClipboardEvent) {
		const file = event.clipboardData?.files.item(0)
		if (Predicate.isNullish(file)) return
		event.preventDefault()
		Queue.offerUnsafe(queue, Message.PasteFile({file}))
	}
	return Effect.acquireRelease(
		Effect.sync(() => document.addEventListener('paste', paste)),
		() => Effect.sync(() => document.removeEventListener('paste', paste))
	)
})

const foreground = Stream.callback<Message>(queue =>
	Effect.ignore(
		listener(() =>
			App.addListener('appStateChange', state => {
				if (state.isActive) Queue.offerUnsafe(queue, Message.Retry())
			})
		),
		{log: 'Warn', message: 'Trips could not listen for a return to the app'}
	)
)

export const Trips = pipe(
	Def.make({
		init: input => ({
			account: AsyncResult.initial(),
			error: undefined,
			flights: AsyncResult.initial(),
			listHidden: false,
			now: DateTime.nowUnsafe(),
			pastOpen: false,
			pasteOpen: false,
			pastedText: '',
			pending: false,
			route: input.props.route,
			showList: false,
			travel: AsyncResult.initial()
		}),
		subscriptions: input => {
			const account = Option.getOrUndefined(Option.map(AsyncResult.value(input.model.account), user => user.id))
			return [
				Router.subscription(TripsRoute, input.model.route, route => Message.Route({route})),
				Subscription.make(
					'account',
					Stream.unwrap(
						AtomRegistry.AtomRegistry.useSync(registry =>
							pipe(
								registry,
								AtomRegistry.toStream(accountAtom),
								Stream.map(result => Message.Account({result}))
							)
						)
					)
				),
				account !== undefined &&
					Subscription.make('flights', account, () =>
						Stream.unwrap(
							AtomRegistry.AtomRegistry.useSync(registry =>
								pipe(
									registry,
									AtomRegistry.toStream(flightsAtom),
									Stream.map(result => Message.Flights({result}))
								)
							)
						)
					),
				account !== undefined &&
					Subscription.make('travel', account, () =>
						Stream.unwrap(
							AtomRegistry.AtomRegistry.useSync(registry =>
								pipe(
									registry,
									AtomRegistry.toStream(travelAtom),
									Stream.map(result => Message.Travel({result}))
								)
							)
						)
					),
				Subscription.make(
					'clock',
					Stream.unwrap(
						AtomRegistry.AtomRegistry.useSync(registry =>
							pipe(
								registry,
								AtomRegistry.toStream(clockAtom('1 minute')),
								Stream.map(now => Message.Clock({now}))
							)
						)
					)
				),
				native &&
					Subscription.make(
						'push',
						pipe(
							AtomRegistry.AtomRegistry,
							Effect.flatMap(registry => pipe(registry, AtomRegistry.mount(pushAtom), Effect.as(Stream.never))),
							Stream.unwrap
						)
					),
				native && Subscription.make('opened', Stream.map(opened, Message.Opened)),
				native && Subscription.make('foreground', foreground),
				input.model.pasteOpen && Subscription.make('pastedImage', pastedImage)
			]
		},
		update: {
			Account: ($, update) => {
				const before = Option.map(AsyncResult.value($.model.account), account => account.id)
				const after = Option.map(AsyncResult.value(update.result), account => account.id)
				if (Option.getOrUndefined(before) === Option.getOrUndefined(after)) return $.evolve({account: update.result})
				return $.evolve({
					account: update.result,
					flights: AsyncResult.initial(),
					pasteOpen: false,
					pastedText: '',
					travel: AsyncResult.initial()
				})
			},
			Clock: ($, update) => $.evolve({now: update.now}),
			Flights: ($, update) => {
				const next = $.evolve({flights: update.result})
				if (Option.exists(AsyncResult.error(update.result), isDenied)) {
					return next.run(Command.asNoop(Reload.make({accountOnly: true})))
				}
				return next
			},
			Opened: ($, update) =>
				$.evolve({showList: false}).run(
					Command.asNoop(
						Router.push(
							TripsRoute,
							Boolean.match(update.day, {
								onFalse: () => TripsRoute.Flight({params: {id: update.id}}),
								onTrue: () => TripsRoute.Day({params: {id: update.id}})
							})
						)
					)
				),
			PasteFile: ($, update) => {
				if ($.model.pending) return $.model
				return $.evolve({error: undefined, pending: true}).run(SaveFile.make({file: update.file}))
			},
			PasteSubmit: $ => {
				if ($.model.pending || String.isEmpty(String.trim($.model.pastedText))) return $.model
				return $.evolve({error: undefined, pending: true}).run(SaveText.make({text: $.model.pastedText}))
			},
			PasteText: ($, update) => $.evolve({pastedText: update.text}),
			PasteVisibility: ($, update) => {
				if (update.open === $.model.pasteOpen) return $.model
				if (update.open) return $.evolve({error: undefined, pasteOpen: true})
				return $.evolve({error: undefined, pasteOpen: false, pastedText: ''})
			},
			Retry: $ => $.evolve({error: undefined, now: DateTime.nowUnsafe()}).run(Command.asNoop(Reload.make({}))),
			Route: ($, update) => $.evolve({route: update.route, showList: false}),
			Select: ($, update) =>
				$.evolve({showList: false}).run(
					Command.asNoop(Router.push(TripsRoute, TripsRoute.Flight({params: {id: update.id}})))
				),
			SessionChanged: ($, update) => $.evolve({error: update.message, pending: false}),
			ShowList: ($, update) => $.evolve({listHidden: false, showList: update.list}),
			SignIn: $ => {
				if ($.model.pending) return $.model
				return $.evolve({error: undefined, pending: true}).run(Auth.make({logout: false}))
			},
			SignOut: $ => {
				if ($.model.pending) return $.model
				return $.evolve({error: undefined, pending: true}).run(Auth.make({logout: true}))
			},
			ToggleList: $ => $.evolve({listHidden: !$.model.listHidden}),
			TogglePast: $ => $.evolve({pastOpen: !$.model.pastOpen}),
			Travel: ($, update) => $.evolve({travel: update.result}),
			TripTime: ($, update) => {
				if ($.model.pending) return $.model
				return $.evolve({error: undefined, pending: true}).run(SetTripTime.make({row: update.row}))
			},
			WriteFailed: ($, update) => $.evolve({error: update.error, pending: false}),
			WriteSaved: $ => $.evolve({error: undefined, pasteOpen: false, pastedText: '', pending: false})
		},
		view: Workspace
	}),
	Component.provide(
		Layer.provideMerge(
			Layer.mergeAll(Auth.layer, Reload.layer, SaveFile.layer, SaveText.layer, SetTripTime.layer),
			AtomRegistry.layer
		)
	)
)
