import {Command, Component, Router, Subscription} from '@effect/ui'
import type {View} from '@effect/ui'

import type {Stream} from 'effect'
import {
	Array,
	Boolean,
	DateTime,
	Duration,
	Function,
	Layer,
	Number,
	Option,
	Predicate,
	Schema,
	String,
	pipe
} from 'effect'

import {AsyncResult, AtomRegistry} from 'effect/reactivity'

import type {ToolbarAction, ToolbarMenuItem, ToolbarOptions} from '@deslop/design/model'
import {observe} from '@deslop/runtime/client/atom'
import {clockAtom} from '@deslop/runtime/client/clock'
import {blockingFailure, isDeniedCause, needsSignInCause} from '@deslop/runtime/client/live-stream'
import {isDenied} from '@deslop/runtime/shared/auth'

import {FlightId, TravelTime} from '#contracts'
import type {Flight} from '#contracts'
import {bookedOf, travelTo} from '#journey'

import {PAST, boardingPass, dayAt, itinerary} from '#screens/board.ts'
import type {TripsData} from '#screens/data.ts'
import {directionsTo, rideTo} from '#screens/directions.ts'
import {boardOf, nextBoardOf, openedFlight} from '#screens/itinerary.ts'
import {Action, Message, Model, OpenUrl, Reload, Run, initial, layerCommands} from '#screens/model.ts'
import type {Actions} from '#screens/model.ts'
import {CloseFlight, TripsRoute, flightRoute} from '#screens/routes.ts'
import {TRAVEL_CHOICES, travelLabel} from '#screens/travel.ts'

function ownerOf(account: Model['account']) {
	return Option.getOrUndefined(Option.map(AsyncResult.value(account), user => user.id))
}

function targetOf(route: TripsRoute) {
	if (!TripsRoute.isAnyOf(['Day', 'Flight'])(route)) return undefined
	return {day: TripsRoute.isAnyOf(['Day'])(route), id: route.params.id}
}

function navigateTo(from: TripsRoute, to: TripsRoute) {
	if (targetOf(from) === undefined) return Command.asNoop(Router.push(TripsRoute, to))
	return Command.asNoop(Router.replace(TripsRoute, to))
}

type MenuItem = ToolbarMenuItem & {onPress: Message}
type ToolbarItem = {action: ToolbarAction; messages: readonly {id: string; onPress: Message}[]}

function toolbarButton(action: ToolbarAction, onPress: Message) {
	return {action, messages: [{id: action.id, onPress}]} satisfies ToolbarItem
}

function airportMenu(flight: Flight, travel: readonly TravelTime[], pending: boolean) {
	const saved = Option.map(travelTo(flight, travel), Duration.toMinutes)
	const times = pipe(
		flight.from.code,
		Option.map(airport =>
			pipe(
				Array.dedupe([...TRAVEL_CHOICES, ...Option.toArray(saved)]),
				Array.sort(Number.Order),
				Array.map(minutes => ({
					checked: Option.contains(saved, minutes),
					disabled: pending,
					id: `airport-${minutes}`,
					label: travelLabel(minutes),
					onPress: Message.TripTime({row: TravelTime.make({airport, minutes})})
				}))
			)
		),
		Option.getOrElse(Array.empty<MenuItem>)
	)
	if (!bookedOf(flight)) return times
	return [
		...times,
		{id: 'directions', label: 'Directions', onPress: Message.OpenUrl({url: directionsTo(flight.from)})},
		...Option.toArray(
			Option.map(rideTo(flight.from), url => ({id: 'ride', label: 'Ride', onPress: Message.OpenUrl({url})}))
		)
	] satisfies readonly MenuItem[]
}

export type TripsOptions = Actions & {
	readonly deviceEvents?: Stream.Stream<Message>
	readonly clipboard?: Stream.Stream<Message>
}

export function makeTrips(boardReads: TripsData, options: TripsOptions) {
	const Trips = Component.define({
		message: Message,
		model: Model,
		name: 'Trips',
		props: Schema.Struct({route: TripsRoute})
	}).make({
		init: $ => initial($.props.route),
		parts: (p, model) => {
			const pending = p.isRunning(Run)
			const account = blockingFailure(model.account)
			const flightFailure = blockingFailure(model.flights)
			const flights = Option.getOrUndefined(AsyncResult.value(model.flights))
			const travel = Option.getOrElse(AsyncResult.value(model.travel), Array.empty<TravelTime>)
			const target = targetOf(model.route)
			function resolvedId() {
				if (flights === undefined || target === undefined) return target?.id
				return openedFlight(flights, target, model.now)
			}
			const id = resolvedId()
			function findFlight() {
				if (flights === undefined) return undefined
				if (id === undefined) return Option.getOrUndefined(boardOf(flights, model.now))
				return Option.getOrUndefined(Array.findFirst(flights, item => item.id === id))
			}
			const flight = findFlight()
			const problem = Option.getOrUndefined(Option.orElse(account, () => flightFailure))
			const signIn = problem !== undefined && needsSignInCause(problem)
			const missing = target !== undefined && flights !== undefined && flight === undefined
			const notFound = TripsRoute.isAnyOf(['NotFound'])(model.route)
			const loaded = problem === undefined && flights !== undefined && !notFound
			const stale = loaded && AsyncResult.isFailure(model.flights)
			function selectedId() {
				if (TripsRoute.isAnyOf(['NotFound'])(model.route)) return id
				if (model.route.search.pane === 'list') return undefined
				if (id !== undefined) return id
				if (model.route.search.pane === 'detail') return flight?.id ?? 'board'
				return undefined
			}
			const selection = {
				back: p.part((el, event: string) => el.on(event, Message.Back())),
				id: selectedId(),
				select: p.part((el, event: string, rowId: string) =>
					el.on(
						event,
						Boolean.match(rowId === PAST, {
							onFalse: () =>
								pipe(
									Schema.decodeOption(FlightId)(rowId),
									Option.map(found => Message.Select({id: found})),
									Option.getOrElse(Message.Ignored)
								),
							onTrue: Message.TogglePast
						})
					)
				)
			}
			const toolbar = Array.getSomes([
				Option.liftPredicate(
					toolbarButton(
						{disabled: pending, id: 'paste', label: 'Paste booking', symbol: 'document.on.clipboard'},
						Message.PasteVisibility({open: true})
					),
					() => loaded
				),
				Option.liftPredicate(
					toolbarButton(
						{disabled: pending, id: 'sign-out', label: 'Sign out', symbol: 'rectangle.portrait.and.arrow.right'},
						Message.SignOut()
					),
					() => loaded && Option.exists(AsyncResult.value(model.account), user => user.signOut)
				),
				Option.liftPredicate(
					toolbarButton({id: 'retry', label: 'Out of date. Retry', symbol: 'exclamationmark.circle'}, Message.Retry()),
					() => stale
				)
			])
			function airport() {
				if (!loaded || flight === undefined || !dayAt(flight, flights, model.now, travel).toAirport) return []
				const menu = airportMenu(flight, travel, pending)
				if (Array.isReadonlyArrayEmpty(menu)) return []
				return [
					{
						action: {
							id: 'airport',
							label: 'Airport travel',
							menu: Array.map(menu, item => ({
								...(Predicate.hasProperty(item, 'checked') && {checked: item.checked}),
								...(Predicate.hasProperty(item, 'disabled') && {disabled: item.disabled}),
								id: item.id,
								label: item.label
							})),
							symbol: 'location'
						},
						messages: menu
					} satisfies ToolbarItem
				]
			}
			const detailToolbar = airport()
			function notice() {
				if (notFound) return 'Page not found'
				if (problem === undefined) return undefined
				if (signIn) return 'Sign in with Auth'
				if (isDeniedCause(problem)) return 'Access denied'
				if (Option.isSome(account)) return 'Couldn’t load Trips'
				return 'Couldn’t load flights'
			}

			function readBoard() {
				if (!loaded || flight === undefined) return undefined
				return boardingPass(flight, flights, model.now, travel)
			}
			function readHalfStep() {
				if (!loaded || target !== undefined) return undefined
				return Option.getOrUndefined(nextBoardOf(flights, model.now))
			}
			function readItinerary() {
				if (!loaded) return undefined
				return itinerary(flights, model.now, travel, model.pastOpen)
			}

			return {
				board: readBoard(),
				cancel: p.part((el, event: string) =>
					el.on(
						event,
						Message.PasteVisibility({open: false}),
						Boolean.match(event === 'cancel', {
							onFalse: Function.constUndefined,
							onTrue: () => ({preventDefault: true as const})
						})
					)
				),
				choose: p.part((el, event: string) => el.on(event, Message.PasteFile({file: undefined}))),
				defaultId: flight?.id,
				detailToolbar: Array.map(detailToolbar, item => item.action),
				error: model.error,
				file: p.part((el, event: string, fileOf: (value: unknown) => unknown) =>
					el.on(event, value => {
						if (pending) return undefined
						const file = fileOf(value)
						if (file === undefined) return undefined
						return Message.PasteFile({file})
					})
				),
				halfStep: readHalfStep(),
				itinerary: readItinerary(),
				loading: problem === undefined && flights === undefined && !notFound,
				missing,
				notice: notice(),
				past: p.part((el, event: string) =>
					el.attr('aria-expanded', `${model.pastOpen}`).on(event, Message.TogglePast())
				),
				paste: p.part((el, event: string) => el.on(event, Message.PasteVisibility({open: true}))),
				pasteOpen: model.pasteOpen,
				pastedText: model.pastedText,
				pending,
				retry: p.part((el, event: string) =>
					el.on(event, Boolean.match(signIn, {onFalse: Message.Retry, onTrue: Message.SignIn}))
				),
				selection,
				signIn,
				stale,
				submit: p.part((el, event: string) => el.on(event, Message.PasteSubmit(), {preventDefault: true})),
				submitDisabled: pending || String.isEmpty(String.trim(model.pastedText)),
				text: p.part((el, event: string) =>
					el.on(event, value => {
						if (!Predicate.hasProperty(value, 'value') || !Predicate.isString(value.value)) return undefined
						return Message.PasteText({text: value.value})
					})
				),
				toolbar: {
					actions: Array.map(toolbar, item => item.action),
					choose: p.part((el, event: string, idOf: Parameters<ToolbarOptions['choose']>[2]) =>
						el.on(event, payload => {
							const actionId = idOf(payload)
							return pipe(
								[...toolbar, ...detailToolbar],
								Array.flatMap(item => item.messages),
								Array.findFirst(item => item.id === actionId),
								Option.map(item => item.onPress),
								Option.getOrUndefined
							)
						})
					)
				}
			}
		},
		subscriptions: $ => {
			const account = ownerOf($.model.account)
			return [
				Router.subscription(TripsRoute, $.model.route, route => Message.Route({route})),
				Subscription.make(
					'account',
					observe(boardReads.accountAtom, result => Message.Account({result}))
				),
				account !== undefined &&
					Subscription.make('flights', account, () =>
						observe(boardReads.flightsAtom, result => Message.Flights({result}))
					),
				account !== undefined &&
					Subscription.make('travel', account, () =>
						observe(boardReads.travelAtom, result => Message.Travel({result}))
					),
				account !== undefined &&
					Subscription.make('push', account, () => observe(boardReads.pushAtom, () => Message.Ignored())),
				Subscription.make(
					'clock',
					observe(clockAtom('1 minute'), now => Message.Clock({now}))
				),
				options.deviceEvents !== undefined && Subscription.make('device', options.deviceEvents),
				options.clipboard !== undefined && $.model.pasteOpen && Subscription.make('paste', options.clipboard)
			]
		},
		update: {
			Account: ($, message) => {
				if (ownerOf($.model.account) === ownerOf(message.result)) {
					return $.evolve({account: message.result})
				}
				return $.evolve({
					account: message.result,
					flights: AsyncResult.initial(),
					pasteOpen: false,
					pastedText: '',
					travel: AsyncResult.initial()
				})
			},
			Back: $ => $.run(Command.asNoop(CloseFlight.make({}))),
			Clock: ($, message) => $.evolve({now: message.now}),
			Flights: ($, message) => {
				if (Option.exists(AsyncResult.error(message.result), isDenied)) {
					return $.evolve({flights: message.result}).run(Command.asNoop(Reload.make({accountOnly: true})))
				}
				return $.evolve({flights: message.result})
			},
			Ignored: $ => $.model,
			OpenUrl: ($, message) =>
				$.run(
					pipe(
						OpenUrl.make({url: message.url}),
						Command.match({onFailure: error => Message.WriteFailed({error: error.message}), onSuccess: Message.Ignored})
					)
				),
			Opened: ($, message) => $.run(navigateTo($.model.route, message.route)),
			PasteFile: ($, message) => {
				if (!$.model.pasteOpen) return $.model
				return $.evolve({error: undefined}).run(Run.make({action: Action.File({file: message.file})}))
			},
			PasteSubmit: $ => {
				if (String.isEmpty(String.trim($.model.pastedText))) return $.model
				return $.evolve({error: undefined}).run(Run.make({action: Action.Text({text: $.model.pastedText})}))
			},
			PasteText: ($, message) => $.evolve({pastedText: message.text}),
			PasteVisibility: ($, message) => {
				if (message.open === $.model.pasteOpen) return $.model
				return $.evolve({error: undefined, pasteOpen: message.open, pastedText: ''})
			},
			Retry: $ => $.evolve({error: undefined, now: DateTime.nowUnsafe()}).run(Command.asNoop(Reload.make({}))),
			Route: ($, message) => {
				const next = $.evolve({route: message.route})
				const previous = targetOf($.model.route)
				const current = targetOf(message.route)
				if (previous === undefined && current !== undefined) return next.viewTransition(['design-detail-in'])
				if (previous !== undefined && current === undefined) return next.viewTransition(['design-detail-out'])
				return next
			},
			Select: ($, message) => $.run(navigateTo($.model.route, flightRoute(message.id))),
			SessionChanged: ($, message) => $.evolve({error: message.message}),
			SignIn: $ => $.evolve({error: undefined}).run(Run.make({action: Action.Session({logout: false})})),
			SignOut: $ => $.evolve({error: undefined}).run(Run.make({action: Action.Session({logout: true})})),
			TogglePast: $ => $.evolve({pastOpen: !$.model.pastOpen}),
			Travel: ($, message) => $.evolve({travel: message.result}),
			TripTime: ($, message) =>
				$.evolve({error: undefined}).run(Run.make({action: Action.TripTime({row: message.row})})),
			WriteFailed: ($, message) => $.evolve({error: message.error}),
			WriteSaved: $ => $.evolve({error: undefined, pasteOpen: false, pastedText: ''})
		}
	})

	type Parts = Component.Headless.Parts<typeof Trips>
	function view<M, R>(
		h: View.HelperBase<M, unknown>,
		props: {readonly route: TripsRoute},
		display: (parts: Parts) => View.Content<M, R>
	) {
		return Trips(h, {props, view: display})
	}
	return {layer: Layer.provideMerge(layerCommands(boardReads, options), AtomRegistry.layer), view}
}

export type ScreenParts = Parameters<Parameters<ReturnType<typeof makeTrips>['view']>[2]>[0]
