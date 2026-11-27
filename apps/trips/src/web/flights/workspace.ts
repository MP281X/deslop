import {Command, Component, Router, Subscription} from '@effect/ui'
import {Html} from '@effect/ui/html'

import {
	Array,
	Boolean,
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
import type {Cause} from 'effect'

import {App} from '@capacitor/app'
import {AsyncResult, AtomRegistry} from 'effect/reactivity'

import {clockAtom} from '@deslop/runtime/client/clock'
import {isDeniedCause, needsSignInCause} from '@deslop/runtime/client/live-stream'
import {isDenied} from '@deslop/runtime/shared/auth'
import {ActionShell} from '@deslop/ui/app-shell'
import type {ShellAction} from '@deslop/ui/app-shell'
import {Loading, Notice, Row, RowContent} from '@deslop/ui/axis'
import {Button, PressFeedback} from '@deslop/ui/control'
import {isNative} from '@deslop/ui/native'
import {WebSignOut, submitWebSignOut} from '@deslop/ui/session'
import {Sheet} from '@deslop/ui/sheet'
import {Split, singlePane, watchPanes} from '@deslop/ui/split'
import type {Pane} from '@deslop/ui/split'
import {ReadState, observe} from '@deslop/ui/state'
import {SymbolIcon} from '@deslop/ui/symbol'
import {hasHistoryBehind, historyBack, usedHistoryMotion} from '@deslop/ui/viewport'

import type {Flight, FlightId, FlightList, TravelTime} from '#contracts'
import {arrivalClockOf, bookedOf, departureOf, labelled, line, routeOf, titleOf} from '#journey'

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
import {accountAtom} from '#web/flights/session.ts'
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
				Option.some(
					Boolean.match(date === today, {onFalse: () => date, onTrue: () => `Lands ${arrivalClockOf(flight)}`})
				)
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
	if (!model.pasteOpen) return undefined
	const pending = h.isRunning(Run)
	return Sheet(h, {
		action: Button(h, {disabled: pending || String.isEmpty(String.trim(model.pastedText)), type: 'submit'})
			.class('axis-control')
			.attr(
				'aria-label',
				Boolean.match(pending, {onFalse: Function.constant('Add booking'), onTrue: Function.constant('Adding…')})
			)
			.children(SymbolIcon(h, 'checkmark')),
		body: [
			h.textarea
				.attrs({'aria-label': 'Paste booking text or link', placeholder: 'Paste booking text or link'})
				.value(model.pastedText)
				.on('input', event => Message.PasteText({text: event.value})),
			model.error !== undefined && h.p.attr('role', 'alert').children(model.error),
			h.label
				.class('axis-control trips-control trips-file-control')
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
		],
		className: 'trips-sheet',
		close: Message.PasteVisibility({open: false}),
		closeDisabled: pending,
		closeLabel: 'Cancel',
		submit: Message.PasteSubmit(),
		title: 'Paste booking',
		titleId: 'booking-title'
	})
}

function ListSkeleton(h: H) {
	return Loading(h, 'Loading flights', h.div.class('trips-skeleton-list').attr('aria-hidden', 'true'))
}

function showOf(route: Model['route']) {
	if (TripsRoute.isAnyOf(['NotFound'])(route)) return 'detail'
	return route.search.pane ?? 'detail'
}

function targetOf(route: Model['route']) {
	return pipe(
		route,
		Option.liftPredicate(TripsRoute.isAnyOf(['Day', 'Flight'])),
		Option.map(link => ({day: TripsRoute.isAnyOf(['Day'])(link), id: link.params.id}))
	)
}

type ShellState = {flight?: Flight; flights?: FlightList; stale?: boolean; notice?: ReturnType<typeof Notice<Message>>}

function BoardPane(
	h: H,
	model: Model,
	board: ShellState,
	show: Pane,
	targeted: boolean,
	travel: readonly TravelTime[]
) {
	if (board.notice !== undefined) return show === 'detail' && model.narrow && board.notice
	if (board.flights === undefined) return BoardSkeleton(h)
	if (board.flight === undefined) {
		return (
			targeted &&
			Notice(
				h,
				Boolean.match(board.stale === true, {
					onFalse: Function.constant('Flight not found'),
					onTrue: Function.constant('Flight not loaded')
				})
			)
		)
	}
	const posture = pipe(
		board.flights,
		Option.liftPredicate(() => !targeted),
		Option.flatMap(flights => nextBoardOf(flights, model.now))
	)
	return [
		Option.getOrUndefined(
			Option.map(posture, step =>
				h.div.class('trips-half').children(NextStep(h, step.hero, Option.getOrUndefined(step.line)))
			)
		),
		h.div
			.class('trips-pass')
			.attr('data-half-step', Option.getOrUndefined(Option.as(posture, '')))
			.children(Board(h, board.flight, board.flights, model.now, travel))
	]
}

function ListPane(h: H, model: Model, board: ShellState, travel: readonly TravelTime[]) {
	if (board.notice !== undefined) return board.notice
	if (board.flights === undefined) return ListSkeleton(h)
	return List(
		h,
		model,
		board.flights,
		travel,
		Boolean.match(!model.narrow && !model.listHidden, {
			onFalse: Function.constUndefined,
			onTrue: () => board.flight?.id
		})
	)
}

function sheetAirport(h: H, model: Model, board: ShellState, show: Pane, travel: readonly TravelTime[]) {
	if (board.flight === undefined || board.flights === undefined) return undefined
	if (!Option.isSome(board.flight.from.code) && !bookedOf(board.flight)) return undefined
	if (model.narrow && show === 'list') return undefined
	if (!dayAt(board.flight, board.flights, model.now, travel).toAirport) return undefined
	return AirportOptions(board.flight, travel, h.isRunning(Run))
}

function FlightActions(
	h: H,
	model: Model,
	board: ShellState,
	signOut: boolean,
	airport?: ReturnType<typeof AirportOptions>
) {
	const pending = h.isRunning(Run)
	return Array.filter(
		[
			board.flights !== undefined &&
				({
					disabled: pending,
					id: 'paste',
					message: Message.PasteVisibility({open: true}),
					symbol: 'document.on.clipboard',
					title: 'Paste booking'
				} satisfies ShellAction<Message>),
			airport !== undefined &&
				({
					id: 'airport',
					menu: airport,
					message: Message.Airport({open: !model.airportOpen}),
					symbol: 'location',
					title: 'Airport travel'
				} satisfies ShellAction<Message>),
			board.flights !== undefined &&
				signOut &&
				({
					disabled: pending,
					id: 'sign-out',
					message: Message.SignOut(),
					symbol: 'rectangle.portrait.and.arrow.right',
					title: 'Sign out'
				} satisfies ShellAction<Message>),
			board.stale === true &&
				({
					id: 'retry',
					message: Message.Retry(),
					symbol: 'exclamationmark.circle',
					title: 'Out of date. Retry'
				} satisfies ShellAction<Message>)
		],
		action => action !== false
	)
}

function Shell(h: H, model: Model, options: ShellState) {
	const target = targetOf(model.route)
	const show = Boolean.match(Option.isNone(target) && options.flights !== undefined && options.flight === undefined, {
		onFalse: () => showOf(model.route),
		onTrue: Function.constant<Pane>('list')
	})
	const travel = Option.getOrElse(AsyncResult.value(model.travel), Array.empty<TravelTime>)
	const hasDetail = options.flight !== undefined || Option.isSome(target)
	const airport = sheetAirport(h, model, options, show, travel)
	const signOut = Option.exists(AsyncResult.value(model.account), account => account.signOut)
	const sidebar = Boolean.match(model.narrow && show === 'detail', {
		onFalse: () =>
			({
				disabled: !hasDetail,
				id: 'sidebar',
				message: Message.Sidebar(),
				pressed: !model.listHidden,
				symbol: 'sidebar.left',
				title: 'Sidebar'
			}) satisfies ShellAction<Message>,
		onTrue: () =>
			({
				id: 'sidebar',
				message: Message.Sidebar(),
				symbol: 'chevron.left',
				title: 'Back'
			}) satisfies ShellAction<Message>
	})
	return ActionShell(h, {
		actions: FlightActions(h, model, options, signOut, airport),
		content: Split(h, {
			detail: {
				content: h.div.class('trips-pane').children(BoardPane(h, model, options, show, Option.isSome(target), travel)),
				key: Option.getOrUndefined(Option.map(target, link => link.id)) ?? options.flight?.id ?? 'board',
				label: 'Boarding pass'
			},
			list: {
				content: h.div.class('trips-pane').children(ListPane(h, model, options, travel)),
				label: 'Flights',
				position: {key: 'flights', ready: options.flights !== undefined}
			},
			listHidden: !model.narrow && hasDetail && model.listHidden,
			narrow: model.narrow,
			show
		}),
		overlays: [
			options.flights !== undefined && Paste(h, model),
			!isNative && airport !== undefined && AirportMenu(h, airport, model.airportOpen),
			!isNative && signOut && WebSignOut(h, {toolbar: true}),
			!model.pasteOpen &&
				model.error !== undefined &&
				h.p.class('trips-report').attr('role', 'alert').children(model.error)
		],
		sidebar
	})
}

function accountFailure(h: H, cause: Cause.Cause<unknown>) {
	if (needsSignInCause(cause)) {
		return Notice(
			h,
			'Sign in with Auth',
			Message.SignIn(),
			Boolean.match(h.isRunning(Run), {
				onFalse: Function.constant('Sign in'),
				onTrue: Function.constant('Opening Auth…')
			})
		)
	}

	return Notice(
		h,
		Boolean.match(isDeniedCause(cause), {
			onFalse: Function.constant('Couldn’t load Trips'),
			onTrue: Function.constant('Access denied')
		}),
		Message.Retry()
	)
}

function Workspace(h: H, model: Model) {
	const main = h.main.class('trips axis-controls').onMount(PressFeedback({}))
	if (TripsRoute.isAnyOf(['NotFound'])(model.route)) {
		return main.children(
			h.a.class('axis-control trips-control').attrs({'data-pressable': '', href: '/'}).children('Back to Trips')
		)
	}
	return main.children(
		ReadState(model.account, {
			failed: cause => Shell(h, model, {notice: accountFailure(h, cause)}),
			loading: () => Shell(h, model, {}),
			ready: () =>
				ReadState(model.flights, {
					failed: () => Shell(h, model, {notice: Notice(h, 'Couldn’t load flights', Message.Retry())}),
					loading: () => Shell(h, model, {}),
					ready: (flights, stale) => {
						const flight = Option.getOrUndefined(
							Option.match(targetOf(model.route), {
								onNone: () => boardOf(flights, model.now),
								onSome: link => Array.findFirst(flights, item => item.id === openedFlight(flights, link, model.now))
							})
						)
						return Shell(h, model, {flights, stale, ...(flight !== undefined && {flight})})
					}
				})
		})
	)
}

const OpenUrl = Command.make('Trips/OpenUrl', {args: {url: Schema.String}}, request =>
	Effect.sync(() => location.assign(request.url))
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
				isNative &&
					Subscription.make(
						'push',
						pipe(
							AtomRegistry.AtomRegistry,
							Effect.flatMap(registry => pipe(registry, AtomRegistry.mount(pushAtom), Effect.as(Stream.never))),
							Stream.unwrap
						)
					),
				isNative && Subscription.make('opened', Stream.map(opened, Message.Opened)),
				isNative && Subscription.make('foreground', foreground),
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
				if (update.open) {
					return $.evolve({airportOpen: false, error: undefined, pasteOpen: true}).viewTransition(['axis-sheet-open'])
				}
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
				if (usedHistoryMotion()) return next
				if (!$.model.narrow) return next.viewTransition(['axis-layout'])
				if (from === to) return next
				if (to === 'detail') return next.viewTransition(['axis-open'])
				return next.viewTransition(['axis-back'])
			},
			Select: ($, update) =>
				$.evolve({listHidden: false}).run(
					Command.asNoop(Router.push(TripsRoute, TripsRoute.Flight({params: {id: update.id}, search: {}})))
				),
			SessionChanged: ($, update) => $.evolve({error: update.message}),
			Sidebar: $ => {
				if (!$.model.narrow) {
					return $.evolve({airportOpen: false, listHidden: !$.model.listHidden}).viewTransition(['axis-layout'])
				}
				if (TripsRoute.isAnyOf(['NotFound'])($.model.route)) return $.model
				if (showOf($.model.route) === 'list') {
					return $.run(
						Command.asNoop(Router.patchSearch(TripsRoute, $.model.route, {pane: 'detail'}, {history: 'push'}))
					)
				}
				if (hasHistoryBehind(previous => previous.searchParams.get('pane') === 'list')) return $.run(historyBack)
				return $.run(
					Command.asNoop(Router.patchSearch(TripsRoute, $.model.route, {pane: 'list'}, {history: 'replace'}))
				)
			},
			SignIn: $ => $.evolve({error: undefined}).run(Run.make({action: Action.Session({logout: false})})),
			SignOut: $ => {
				if (!isNative) return $.run(submitWebSignOut)
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
