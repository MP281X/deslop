import {Command, Component, Router, Subscription} from '@effect/ui'
import type {View} from '@effect/ui'

import {Array, DateTime, Duration, Effect, Layer, Number, Option, Schema, Stream, String, pipe} from 'effect'

import {AsyncResult, AtomRegistry} from 'effect/reactivity'
import type {Atom} from 'effect/reactivity'

import type {ToolbarAction, ToolbarMenuItem} from '@deslop/design/model'
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

function observe<A>(atom: Atom.Atom<A>, read: (value: A) => Message) {
	return Stream.unwrap(
		AtomRegistry.AtomRegistry.useSync(registry => Stream.map(AtomRegistry.toStream(registry, atom), read))
	)
}

function targetOf(route: TripsRoute) {
	if (!TripsRoute.isAnyOf(['Day', 'Flight'])(route)) return undefined
	return {day: TripsRoute.isAnyOf(['Day'])(route), id: route.params.id}
}

type MenuItem = ToolbarMenuItem & {onPress: Message}
type ToolbarItem = ToolbarAction & ({onPress: Message} | {menu: readonly MenuItem[]})

function airportMenu(flight: Flight, travel: readonly TravelTime[], pending: boolean): readonly MenuItem[] {
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
	]
}

type Options = Actions & {readonly deviceEvents?: Stream.Stream<Message>; readonly clipboard?: Stream.Stream<Message>}

export function makeTrips(data: TripsData, options: Options) {
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
			const id = flights === undefined || target === undefined ? target?.id : openedFlight(flights, target, model.now)
			const flight =
				flights === undefined
					? undefined
					: Option.getOrUndefined(
							id === undefined ? boardOf(flights, model.now) : Array.findFirst(flights, item => item.id === id)
						)
			const problem = Option.getOrUndefined(Option.orElse(account, () => flightFailure))
			const signIn = problem !== undefined && needsSignInCause(problem)
			const missing = target !== undefined && flights !== undefined && flight === undefined
			const notFound = TripsRoute.isAnyOf(['NotFound'])(model.route)
			const loaded = problem === undefined && flights !== undefined && !notFound
			const stale = loaded && AsyncResult.isFailure(model.flights)
			const pane = TripsRoute.isAnyOf(['NotFound'])(model.route) ? undefined : model.route.search.pane
			const selection = {
				back: p.part((el, event: string) => el.on(event, Message.Back())),
				id: pane === 'list' ? undefined : (id ?? (pane === 'detail' ? (flight?.id ?? 'board') : undefined)),
				select: p.part((el, event: string, rowId: string) =>
					el.on(
						event,
						rowId === PAST
							? Message.TogglePast()
							: Option.getOrElse(
									Option.map(Schema.decodeUnknownOption(FlightId)(rowId), found => Message.Select({id: found})),
									Message.Ignored
								)
					)
				)
			}
			const toolbar: ToolbarItem[] = []
			const detailToolbar: ToolbarItem[] = []
			if (loaded) {
				toolbar.push({
					disabled: pending,
					id: 'paste',
					label: 'Paste booking',
					onPress: Message.PasteVisibility({open: true}),
					symbol: 'document.on.clipboard'
				})
				if (flight !== undefined && dayAt(flight, flights, model.now, travel).toAirport) {
					const menu = airportMenu(flight, travel, pending)
					if (Array.isReadonlyArrayNonEmpty(menu))
						detailToolbar.push({id: 'airport', label: 'Airport travel', menu, symbol: 'location'})
				}
				if (Option.exists(AsyncResult.value(model.account), user => user.signOut)) {
					toolbar.push({
						disabled: pending,
						id: 'sign-out',
						label: 'Sign out',
						onPress: Message.SignOut(),
						symbol: 'rectangle.portrait.and.arrow.right'
					})
				}
			}
			if (stale)
				toolbar.push({
					id: 'retry',
					label: 'Out of date. Retry',
					onPress: Message.Retry(),
					symbol: 'exclamationmark.circle'
				})
			function notice() {
				if (notFound) return 'Page not found'
				if (problem === undefined) return undefined
				if (signIn) return 'Sign in with Auth'
				if (isDeniedCause(problem)) return 'Access denied'
				if (Option.isSome(account)) return 'Couldn’t load Trips'
				return 'Couldn’t load flights'
			}

			function descriptors(actions: readonly ToolbarItem[]): readonly ToolbarAction[] {
				return Array.map(actions, action => {
					if ('onPress' in action) {
						const {onPress: _, ...item} = action
						return item
					}
					return {...action, menu: Array.map(action.menu, ({onPress: _, ...item}) => item)}
				})
			}

			return {
				back: selection.back,
				board: loaded && flight !== undefined ? boardingPass(flight, flights, model.now, travel) : undefined,
				cancel: p.part((el, event: string) =>
					el.on(event, Message.PasteVisibility({open: false}), event === 'cancel' ? {preventDefault: true} : undefined)
				),
				error: model.error,
				file: p.part((el, event: string, fileOf: (value: unknown) => unknown) =>
					el.on(event, value => {
						if (pending) return undefined
						const file = fileOf(value)
						if (file === undefined) return undefined
						return Message.PasteFile({file})
					})
				),
				choose: p.part((el, event: string) => el.on(event, Message.PasteFile({file: null}))),
				itinerary: loaded ? itinerary(flights, model.now, travel, model.pastOpen) : undefined,
				halfStep: loaded && target === undefined ? Option.getOrUndefined(nextBoardOf(flights, model.now)) : undefined,
				loading: problem === undefined && flights === undefined && !notFound,
				missing,
				notice: notice(),
				paste: p.part((el, event: string) => el.on(event, Message.PasteVisibility({open: true}))),
				pasteOpen: model.pasteOpen,
				pastedText: model.pastedText,
				pending,
				retry: p.part((el, event: string) => el.on(event, signIn ? Message.SignIn() : Message.Retry())),
				selection,
				signIn,
				stale,
				submit: p.part((el, event: string) => el.on(event, Message.PasteSubmit(), {preventDefault: true})),
				submitDisabled: pending || String.isEmpty(String.trim(model.pastedText)),
				text: p.part((el, event: string, textOf: (value: unknown) => string | undefined) =>
					el.on(event, value => {
						const text = textOf(value)
						if (text === undefined) return undefined
						return Message.PasteText({text})
					})
				),
				defaultId: flight?.id,
				detailToolbar: descriptors(detailToolbar),
				toolbar: {
					actions: descriptors(toolbar),
					choose: p.part((el, event: string, idOf: (payload: unknown) => string | undefined) =>
						el.on(event, payload => {
							const id = idOf(payload)
							const actions = Array.flatMap<ToolbarItem, {id: string; onPress: Message}>(
								[...toolbar, ...detailToolbar],
								action => ('onPress' in action ? [action] : action.menu)
							)
							return Option.getOrUndefined(
								Option.map(
									Array.findFirst(actions, item => item.id === id),
									item => item.onPress
								)
							)
						})
					)
				}
			}
		},
		subscriptions: $ => {
			const account = Option.getOrUndefined(Option.map(AsyncResult.value($.model.account), user => user.id))
			return [
				Router.subscription(TripsRoute, $.model.route, route => Message.Route({route})),
				Subscription.make(
					'account',
					observe(data.account, result => Message.Account({result}))
				),
				account !== undefined &&
					Subscription.make('flights', account, () => observe(data.flights, result => Message.Flights({result}))),
				account !== undefined &&
					Subscription.make('travel', account, () => observe(data.travel, result => Message.Travel({result}))),
				account !== undefined && Subscription.make('push', account, () => observe(data.push, Message.Ignored)),
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
				const before = Option.getOrUndefined(Option.map(AsyncResult.value($.model.account), user => user.id))
				const after = Option.getOrUndefined(Option.map(AsyncResult.value(message.result), user => user.id))
				if (before === after) return $.evolve({account: message.result})
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
				const next = $.evolve({flights: message.result})
				if (Option.exists(AsyncResult.error(message.result), isDenied)) {
					return next.run(Command.asNoop(Reload.make({accountOnly: true})))
				}
				return next
			},
			Ignored: $ => $.model,
			OpenUrl: ($, message) =>
				$.run(
					pipe(
						OpenUrl.make({url: message.url}),
						Command.match({onFailure: error => Message.WriteFailed({error: error.message}), onSuccess: Message.Ignored})
					)
				),
			Opened: ($, message) => {
				const navigate = targetOf($.model.route) === undefined ? Router.push : Router.replace
				return $.run(Command.asNoop(navigate(TripsRoute, message.route)))
			},
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
			Select: ($, message) => {
				const navigate = targetOf($.model.route) === undefined ? Router.push : Router.replace
				return $.run(Command.asNoop(navigate(TripsRoute, flightRoute(message.id))))
			},
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
	return {layer: Layer.provideMerge(layerCommands(data, options), AtomRegistry.layer), view}
}

export type ScreenParts = Parameters<Parameters<ReturnType<typeof makeTrips>['view']>[2]>[0]
