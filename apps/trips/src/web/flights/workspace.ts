import {Command, Component, Router, Subscription} from '@effect/ui'
import {Html} from '@effect/ui/html'

import {Array, Boolean, DateTime, Effect, Function, Layer, Option, Predicate, Queue, Schema, Stream, String, pipe} from 'effect'

import {App} from '@capacitor/app'
import {AsyncResult, AtomRegistry} from 'effect/reactivity'

import {clockAtom} from '@deslop/runtime/client/clock'
import {isDeniedCause, needsSignInCause} from '@deslop/runtime/client/live-stream'
import {isDenied} from '@deslop/runtime/shared/auth'
import {ActionShell} from '@deslop/ui/app-shell'
import type {ShellAction} from '@deslop/ui/app-shell'
import {Loading, Notice, Row} from '@deslop/ui/axis'
import {Button, PressFeedback} from '@deslop/ui/control'
import {Glass} from '@deslop/ui/glass'
import {Split, singlePane, watchPanes} from '@deslop/ui/split'
import type {Pane} from '@deslop/ui/split'
import {observe} from '@deslop/ui/state'
import {SymbolIcon} from '@deslop/ui/symbol'

import type {Flight, FlightId, FlightList, TravelTime} from '#contracts'
import {arrivalClockOf, bookedOf, departureOf, labelled, line, routeOf, titleOf} from '#journey'

import {ReadState, RowContent, WebSignOut, submitWebSignOut} from './axis.ts'
import {FitSheet, hasListBehind} from './viewport.ts'

import {
	AirportMenu,
	AirportBy,
	AirportOptions,
	Board,
	BoardSkeleton,
	dayAt,
	NextStep
} from '#web/flights/boarding-pass.ts'
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
import {Action, Message, Model, Reload, Run} from '#web/flights/model.ts'
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
	const problem = Option.map(troubleOf(flight, now), issue => issue.reason)
	return Row(h, {
		current: selected === flight.id,
		id: flight.id,
		line: Option.getOrElse(problem, () =>
			line([
				Option.some(titleOf(flight)),
				labelled(
					'Gate',
					Option.flatMap(flight.live, live => live.departureGate)
				),
				Option.some(date === today ? `Lands ${arrivalClockOf(flight)}` : date)
			])
		),
		open: Message.Select({id: flight.id}),
		problem: Option.isSome(problem),
		title: routeOf(flight),
		value: [Option.getOrUndefined(Option.map(times.was, was => h.s.children(was))), Option.getOrUndefined(times.value)]
	})
}

function List(h: H, model: Model, flights: FlightList, travel: readonly TravelTime[], selected?: FlightId) {
	const trip = tripOf(flights, model.now)
	const upcoming = [
		...trip.flights,
		...Array.flatMap(datesOf(flights, model.now, trip.flights), date => Array.map(date.rows, row => row.flight))
	]
	const past = pastOf(flights, model.now)
	return [
		Array.isArrayEmpty(upcoming) &&
			Notice(h, 'No upcoming flights', Message.PasteVisibility({open: true}), 'Paste booking'),
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
							h.div.class('axis-row').children(RowContent(h, {line: hero.right, title: 'Leave', value: hero.value}))
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
				.on('click', Message.TogglePast())
				.children(RowContent(h, {title: 'Past flights', value: `${past.length}`})),
		...pipe(
			past,
			Array.filter(() => model.pastOpen),
			Array.map(flight => FlightRow(h, flight, model.now, selected))
		)
	]
}

function Paste(h: H, model: Model) {
	const pending = h.isRunning(Run)
	return h.dialog
		.class('trips-sheet')
		.attr('aria-labelledby', 'booking-title')
		.modal(model.pasteOpen)
		.onMount(FitSheet({}))
		.on('cancel', () => (pending ? undefined : Message.PasteVisibility({open: false})), {preventDefault: true})
		.children(
			h.form
				.class('trips-booking')
				.on('submit', Message.PasteSubmit(), {preventDefault: true})
				.children(
					h.div.class('trips-booking-actions').children(
						Glass(h).children(
							Button(h, {disabled: pending})
								.attrs({'aria-label': 'Cancel', autofocus: ''})
								.on('click', Message.PasteVisibility({open: false}))
								.children(SymbolIcon(h, 'xmark'))
						),
						h.h2.id('booking-title').children('Paste booking'),
						Glass(h).children(
							Button(h, {disabled: pending || String.isEmpty(String.trim(model.pastedText)), type: 'submit'})
								.attr('aria-label', pending ? 'Adding…' : 'Add booking')
								.children(SymbolIcon(h, 'checkmark'))
						)
					),
					h.textarea
						.attrs({'aria-label': 'Paste booking text or link', placeholder: 'Paste booking text or link'})
						.value(model.pastedText)
						.on('input', event => Message.PasteText({text: event.value})),
					model.error !== undefined && h.p.attr('role', 'alert').children(model.error),
					Glass(h, 'trips-file').children(
						h.label
							.class('trips-control trips-file-control')
							.attrs({'aria-disabled': `${pending}`, 'data-pressable': ''})
							.children(
								SymbolIcon(h, 'paperclip'),
								'Choose an image or PDF',
								h.input
									.attrs({
										accept: 'image/*,application/pdf',
										'aria-label': 'Choose an image or PDF',
										disabled: Option.getOrUndefined(Option.liftPredicate('', () => pending)),
										type: 'file'
									})
									.value('')
									.on('change', event =>
										Option.getOrUndefined(Option.map(Array.head(event.files), file => Message.PasteFile({file})))
									)
							)
					)
				)
		)
}

function ListSkeleton(h: H) {
	return Loading(h, 'Loading flights', h.div.class('trips-skeleton-list').attr('aria-hidden', 'true'))
}

function showOf(route: Model['route']): Pane {
	return TripsRoute.match(route, {
		Day: route => route.search.pane ?? 'detail',
		Flight: route => route.search.pane ?? 'detail',
		Home: route => route.search.pane ?? 'detail',
		NotFound: Function.constant('detail')
	})
}

function targetOf(route: Model['route']) {
	return TripsRoute.match(route, {
		Day: route => Option.some({day: true, id: route.params.id}),
		Flight: route => Option.some({day: false, id: route.params.id}),
		Home: () => Option.none(),
		NotFound: () => Option.none()
	})
}

function Shell(
	h: H,
	model: Model,
	options: {flight?: Flight; flights?: FlightList; stale?: boolean; notice?: ReturnType<typeof Notice>}
) {
	const target = targetOf(model.route)
	const show =
		Option.isNone(target) && options.flights !== undefined && options.flight === undefined
			? 'list'
			: showOf(model.route)
	const travel = Option.getOrElse(AsyncResult.value(model.travel), Array.empty<TravelTime>)
	const hasDetail = options.flight !== undefined || Option.isSome(target)
	const selectedBesideList = !model.narrow && !model.listHidden
	const flight = options.flight
	const flights = options.flights
	const pending = h.isRunning(Run)
	const airport =
		flight !== undefined &&
		flights !== undefined &&
		(Option.isSome(flight.from.code) || bookedOf(flight)) &&
		dayAt(flight, flights, model.now, travel).toAirport &&
		(!model.narrow || show === 'detail')
			? AirportOptions(flight, travel, pending)
			: undefined
	const signOut = Option.exists(AsyncResult.value(model.account), account => account.signOut)
	const actions = Array.empty<ShellAction<Message>>()
	if (flights !== undefined) {
		actions.push({
			disabled: pending,
			id: 'paste',
			message: Message.PasteVisibility({open: true}),
			symbol: 'document.on.clipboard',
			title: 'Paste booking'
		})
		if (airport !== undefined)
			{actions.push({
				id: 'airport',
				menu: airport,
				message: Message.Airport({open: !model.airportOpen}),
				symbol: 'location',
				title: 'Airport travel'
			})}
		if (signOut)
			{actions.push({
				disabled: pending,
				id: 'sign-out',
				message: Message.SignOut(),
				symbol: 'rectangle.portrait.and.arrow.right',
				title: 'Sign out'
			})}
	}
	if (options.stale === true)
		{actions.push({id: 'retry', message: Message.Retry(), symbol: 'exclamationmark.circle', title: 'Out of date. Retry'})}
	const back = model.narrow && show === 'detail'
	const sidebar: ShellAction<Message> = back
		? {id: 'sidebar', message: Message.Sidebar(), symbol: 'chevron.left', title: 'Back'}
		: {
				disabled: !hasDetail,
				id: 'sidebar',
				message: Message.Sidebar(),
				pressed: !model.listHidden,
				symbol: 'sidebar.left',
				title: 'Sidebar'
			}
	const posture = flights !== undefined && Option.isNone(target) ? nextBoardOf(flights, model.now) : Option.none()
	return ActionShell(h, {
		actions,
		content: Split(h, {
			detail: {
				content: h.div.class('trips-pane').children(
					options.notice === undefined
						? flights === undefined
							? BoardSkeleton(h)
							: flight !== undefined
								? [
										Option.getOrUndefined(
											Option.map(posture, step =>
												h.div.class('trips-half').children(NextStep(h, step.hero, Option.getOrUndefined(step.line)))
											)
										),
										h.div
											.class('trips-pass')
											.attr('data-half-step', Option.getOrUndefined(Option.as(posture, '')))
											.children(...Board(h, flight, flights, model.now, travel))
									]
								: Option.isSome(target) && Notice(h, options.stale === true ? 'Flight not loaded' : 'Flight not found')
						: show === 'detail' && model.narrow && options.notice
				),
				key: Option.getOrUndefined(Option.map(target, link => link.id)) ?? flight?.id ?? 'board',
				label: 'Boarding pass'
			},
			list: {
				content: h.div
					.class('trips-pane')
					.children(
						options.notice ??
							(flights === undefined
								? ListSkeleton(h)
								: List(h, model, flights, travel, selectedBesideList ? flight?.id : undefined))
					),
				label: 'Flights'
			},
			listHidden: !model.narrow && hasDetail && model.listHidden,
			narrow: model.narrow,
			show
		}),
		overlays: [
			flights !== undefined && Paste(h, model),
			!native && airport !== undefined && AirportMenu(h, airport, model.airportOpen),
			!native && signOut && WebSignOut(h, location.href),
			!model.pasteOpen &&
				model.error !== undefined &&
				Glass(h, 'trips-report').attr('role', 'alert').children(model.error)
		],
		sidebar
	})
}

function Workspace(h: H, model: Model) {
	const content = TripsRoute.isAnyOf(['NotFound'])(model.route)
		? Glass(h).children(h.a.class('trips-control').attrs({'data-pressable': '', href: '/'}).children('Back to Trips'))
		: ReadState(model.account, {
				failed: cause =>
					Shell(h, model, {
						notice: needsSignInCause(cause)
							? Notice(h, 'Sign in with Auth', Message.SignIn(), h.isRunning(Run) ? 'Opening Auth…' : 'Sign in')
							: Notice(h, isDeniedCause(cause) ? 'Access denied' : 'Couldn’t load Trips', Message.Retry())
					}),
				loading: () => Shell(h, model, {}),
				ready: () =>
					ReadState(model.flights, {
						failed: () => Shell(h, model, {notice: Notice(h, 'Couldn’t load flights', Message.Retry())}),
						loading: () => Shell(h, model, {}),
						ready: (flights, stale) => {
							const target = targetOf(model.route)
							const flight = Option.match(target, {
								onNone: () => boardOf(flights, model.now),
								onSome: link => Array.findFirst(flights, item => item.id === openedFlight(flights, link, model.now))
							})
							return Shell(h, model, {flight: Option.getOrUndefined(flight), flights, stale})
						}
					})
			})
	return h.main.class('trips axis-controls').onMount(PressFeedback({})).children(content)
}

const OpenUrl = Command.make('Trips/OpenUrl', {args: {url: Schema.String}}, ({url}) =>
	Effect.sync(() => location.assign(url))
)

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
			airportOpen: false,
			error: undefined,
			flights: AsyncResult.initial(),
			listHidden: false,
			narrow: singlePane(),
			now: DateTime.nowUnsafe(),
			pastOpen: false,
			pasteOpen: false,
			pastedText: '',
			route: input.props.route,
			travel: AsyncResult.initial()
		}),
		subscriptions: input => {
			const account = Option.getOrUndefined(Option.map(AsyncResult.value(input.model.account), user => user.id))
			return [
				...watchPanes(() => Message.Posture({narrow: singlePane()})),
				Router.subscription(TripsRoute, input.model.route, route => Message.Route({route})),
				Subscription.make(
					'account',
					observe(accountAtom, result => Message.Account({result}))
				),
				account !== undefined &&
					Subscription.make('flights', account, () => observe(flightsAtom, result => Message.Flights({result}))),
				account !== undefined &&
					Subscription.make('travel', account, () => observe(travelAtom, result => Message.Travel({result}))),
				Subscription.make(
					'clock',
					observe(clockAtom('1 minute'), now => Message.Clock({now}))
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
					airportOpen: false,
					flights: AsyncResult.initial(),
					pasteOpen: false,
					pastedText: '',
					travel: AsyncResult.initial()
				})
			},
			Airport: ($, update) => $.evolve({airportOpen: update.open}),
			Clock: ($, update) => $.evolve({now: update.now}),
			Flights: ($, update) => {
				const next = $.evolve({flights: update.result})
				if (Option.exists(AsyncResult.error(update.result), isDenied)) {
					return next.run(Command.asNoop(Reload.make({accountOnly: true})))
				}
				return next
			},
			Ignored: $ => $.model,
			OpenUrl: ($, update) => $.evolve({airportOpen: false}).run(Command.asNoop(OpenUrl.make({url: update.url}))),
			Opened: ($, update) =>
				$.run(
					Command.asNoop(
						Router.push(
							TripsRoute,
							Boolean.match(update.day, {
								onFalse: () => TripsRoute.Flight({params: {id: update.id}, search: {}}),
								onTrue: () => TripsRoute.Day({params: {id: update.id}, search: {}})
							})
						)
					)
				),
			PasteFile: ($, update) => {
				if (!$.model.pasteOpen) return $.model
				return $.evolve({error: undefined}).run(Run.make({action: Action.File({file: update.file})}))
			},
			PasteSubmit: $ => {
				if (String.isEmpty(String.trim($.model.pastedText))) return $.model
				return $.evolve({error: undefined}).run(Run.make({action: Action.Text({text: $.model.pastedText})}))
			},
			PasteText: ($, update) => $.evolve({pastedText: update.text}),
			PasteVisibility: ($, update) => {
				if (update.open === $.model.pasteOpen) return $.model
				if (update.open)
					return $.evolve({airportOpen: false, error: undefined, pasteOpen: true}).viewTransition(['axis-sheet-open'])
				return $.evolve({error: undefined, pasteOpen: false, pastedText: ''}).viewTransition(['axis-sheet-close'])
			},
			Posture: ($, update) => {
				if (update.narrow === $.model.narrow) return $.model
				return $.evolve({airportOpen: false, narrow: update.narrow}).viewTransition(['axis-layout'])
			},
			Retry: $ => $.evolve({error: undefined, now: DateTime.nowUnsafe()}).run(Command.asNoop(Reload.make({}))),
			Route: ($, update) => {
				const from = showOf($.model.route)
				const to = showOf(update.route)
				const next = $.evolve({airportOpen: false, route: update.route})
				if (!$.model.narrow) return next.viewTransition(['axis-layout'])
				if (from === to) return next
				return next.viewTransition([to === 'detail' ? 'axis-open' : 'axis-back'])
			},
			Select: ($, update) =>
				$.evolve({listHidden: false}).run(
					Command.asNoop(Router.push(TripsRoute, TripsRoute.Flight({params: {id: update.id}, search: {}})))
				),
			SessionChanged: ($, update) => $.evolve({error: update.message}),
			Sidebar: $ => {
				const {model} = $
				if (!model.narrow)
					return $.evolve({airportOpen: false, listHidden: !model.listHidden}).viewTransition(['axis-layout'])
				if (TripsRoute.isAnyOf(['NotFound'])(model.route)) return $.model
				if (showOf(model.route) === 'list') {
					return $.run(Command.asNoop(Router.patchSearch(TripsRoute, model.route, {pane: 'detail'}, {history: 'push'})))
				}
				if (hasListBehind()) return $.run(Command.asNoop(Router.Back.make({})))
				return $.run(Command.asNoop(Router.patchSearch(TripsRoute, model.route, {pane: 'list'}, {history: 'replace'})))
			},
			SignIn: $ => $.evolve({error: undefined}).run(Run.make({action: Action.Session({logout: false})})),
			SignOut: $ => {
				if (!native) return $.run(submitWebSignOut)
				return $.evolve({error: undefined}).run(Run.make({action: Action.Session({logout: true})}))
			},
			TogglePast: $ => $.evolve({pastOpen: !$.model.pastOpen}),
			Travel: ($, update) => $.evolve({travel: update.result}),
			TripTime: ($, update) =>
				$.evolve({airportOpen: false, error: undefined}).run(Run.make({action: Action.TripTime({row: update.row})})),
			WriteFailed: ($, update) => $.evolve({error: update.error}),
			WriteSaved: $ => {
				if (!$.model.pasteOpen) return $.model
				return $.evolve({error: undefined, pasteOpen: false, pastedText: ''}).viewTransition(['axis-sheet-close'])
			}
		},
		view: Workspace
	}),
	Component.provide(Layer.provideMerge(Layer.mergeAll(Reload.layer, Run.layer), AtomRegistry.layer))
)
