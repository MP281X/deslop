import {Command, Component, Router, Subscription, UiSchema} from '@effect/ui'

import {
	Array,
	Boolean,
	DateTime,
	Duration,
	Function,
	Number,
	Option,
	Predicate,
	Schema,
	Stream,
	String,
	pipe
} from 'effect'

import {AsyncResult} from 'effect/reactivity'

import type {ToolbarAction, ToolbarMenuItem, ToolbarOptions} from '@deslop/components/model'
import {blockingFailure, isDeniedCause} from '@deslop/runtime/client/live-stream'
import {selection, shellApp, slide} from '@deslop/runtime/client/shell'
import type {AppScreen} from '@deslop/runtime/client/shell'
import {isDenied} from '@deslop/runtime/shared/auth'
import {Account} from '@deslop/runtime/shared/schema'
import {DateTimeUtcFromFiniteMillis} from '@deslop/runtime/shared/time'

import {
	Action,
	CloseFlight,
	OpenUrl,
	Reload,
	Run,
	TripsRoute,
	activated,
	flightRoute,
	pasted,
	readTrips,
	registering,
	tapped,
	targetOf
} from './reads.ts'

import {Flight, FlightId, TravelTime} from '#flights/contract.ts'
import {bookedOf, directionsTo, rideTo, travelLabel, travelTo, TRAVEL_CHOICES} from '#flights/shared.ts'
import {PAST, boardingPass, dayAt, itinerary} from '#itinerary/screen.ts'
import {boardOf, nextBoardOf, openedFlight} from '#itinerary/shared.ts'

const AccountRead = AsyncResult.Schema({error: Schema.Unknown, success: Account})
const FlightsRead = AsyncResult.Schema({error: Schema.Unknown, success: Schema.Array(Flight.json)})
const TravelRead = AsyncResult.Schema({error: Schema.Unknown, success: Schema.Array(TravelTime)})

// The screen's model and messages; the shell owns the clock and the sign-in.
type Model = typeof Model.Type
const Model = Schema.Struct({
	account: AccountRead,
	error: Schema.UndefinedOr(Schema.String),
	flights: FlightsRead,
	pastOpen: Schema.Boolean,
	pasteOpen: Schema.Boolean,
	pastedText: Schema.String,
	route: TripsRoute,
	travel: TravelRead,
	// When the app last came back to the front, which the clock catches up with within the minute.
	woke: Schema.UndefinedOr(DateTimeUtcFromFiniteMillis)
})

const Message = UiSchema.TaggedEnum({
	Account: {result: AccountRead},
	Back: {},
	Flights: {result: FlightsRead},
	OpenUrl: {url: Schema.String},
	Opened: {route: TripsRoute},
	PasteFile: {file: Schema.Unknown},
	PasteSubmit: {},
	PasteText: {text: Schema.String},
	PasteVisibility: {open: Schema.Boolean},
	Reported: {error: Schema.UndefinedOr(Schema.String), saved: Schema.Boolean},
	Reread: {},
	Route: {route: TripsRoute},
	Select: {id: Schema.String},
	SignIn: {},
	SignOut: {},
	Travel: {result: TravelRead},
	TripTime: {row: TravelTime}
})

type Message = typeof Message.Type

function ownerOf(account: Model['account']) {
	return Option.getOrUndefined(Option.map(AsyncResult.value(account), user => user.id))
}

function isOpen(route: TripsRoute) {
	return targetOf(route) !== undefined
}

// A flight opens as a new page from the list, and in place of the flight it replaces.
function navigateTo(from: TripsRoute, to: TripsRoute) {
	if (!isOpen(from)) return Command.asNoop(Router.push(TripsRoute, to))
	return Command.asNoop(Router.replace(TripsRoute, to))
}

function run(action: Action) {
	return Command.map(Run.make({action}), written => Message.Reported(written))
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

const Screen = Component.define({
	message: Message,
	model: Model,
	name: 'Trips',
	props: Schema.Struct({now: DateTimeUtcFromFiniteMillis, route: TripsRoute})
}).make({
	init: $ => ({
		account: AsyncResult.initial(),
		error: undefined,
		flights: AsyncResult.initial(),
		pastOpen: false,
		pasteOpen: false,
		pastedText: '',
		route: $.props.route,
		travel: AsyncResult.initial(),
		woke: undefined
	}),
	parts: (p, model) => {
		const pending = p.isRunning(Run)
		const now = Option.match(Option.fromUndefinedOr(model.woke), {
			onNone: () => p.props.now,
			onSome: woke => DateTime.max(p.props.now, woke)
		})
		const accountFailure = blockingFailure(model.account)
		const problem = Option.getOrUndefined(Option.orElse(accountFailure, () => blockingFailure(model.flights)))
		const flights = Option.getOrUndefined(AsyncResult.value(model.flights))
		const travel = Option.getOrElse(AsyncResult.value(model.travel), Array.empty<TravelTime>)
		const target = targetOf(model.route)
		function resolvedId() {
			if (flights === undefined || target === undefined) return target?.id
			return openedFlight(flights, target, now)
		}
		const id = resolvedId()
		function findFlight() {
			if (flights === undefined) return undefined
			if (id === undefined) return Option.getOrUndefined(boardOf(flights, now))
			return Option.getOrUndefined(Array.findFirst(flights, item => item.id === id))
		}
		const flight = findFlight()
		const missing = target !== undefined && flights !== undefined && flight === undefined
		const notFound = TripsRoute.isAnyOf(['NotFound'])(model.route)
		const loaded = problem === undefined && flights !== undefined && !notFound
		const stale = loaded && AsyncResult.isFailure(model.flights)
		function selectedId() {
			if (notFound) return id
			if (model.route.search.pane === 'list') return undefined
			if (id !== undefined) return id
			if (model.route.search.pane === 'detail') return flight?.id ?? 'board'
			return undefined
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
				toolbarButton({id: 'retry', label: 'Out of date. Retry', symbol: 'exclamationmark.circle'}, Message.Reread()),
				() => stale
			)
		])
		function airport() {
			if (!loaded || flight === undefined || !dayAt(flight, flights, now, travel).toAirport) return []
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
		// What the page says when the flights did not load for a reason the shell does not answer.
		function failure() {
			if (problem === undefined || isDeniedCause(problem)) return undefined
			if (Option.isSome(accountFailure)) return 'Couldn’t load Trips'
			return 'Couldn’t load flights'
		}
		function readBoard() {
			if (!loaded || flight === undefined) return undefined
			return boardingPass(flight, flights, now, travel)
		}
		function readHalfStep() {
			if (!loaded || target !== undefined) return undefined
			return Option.getOrUndefined(nextBoardOf(flights, now))
		}
		function readItinerary() {
			if (!loaded) return undefined
			return itinerary(flights, now, travel, model.pastOpen)
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
			failure: failure(),
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
			past: p.part((el, event: string, rowId: string) =>
				el.attr('aria-expanded', `${model.pastOpen}`).on(event, Message.Select({id: rowId}))
			),
			paste: p.part((el, event: string) => el.on(event, Message.PasteVisibility({open: true}))),
			pasteOpen: model.pasteOpen,
			pastedText: model.pastedText,
			pending,
			// A route the page does not answer comes before whatever failed to load.
			reads: Boolean.match(notFound, {
				onFalse: () => [model.account, model.flights],
				onTrue: () => Array.empty<AsyncResult.AsyncResult<unknown, unknown>>()
			}),
			reload: p.part((el, event: string) => el.on(event, Message.Reread())),
			routeMissing: notFound,
			selection: selection(p, {
				back: Message.Back(),
				id: selectedId(),
				open: true,
				select: rowId => Message.Select({id: rowId})
			}),
			signIn: p.part((el, event: string) => el.on(event, Message.SignIn())),
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
				readTrips(
					reads => reads.account,
					result => Message.Account({result})
				)
			),
			account !== undefined &&
				Subscription.make('flights', account, () =>
					readTrips(
						reads => reads.flightsAtoms(account),
						result => Message.Flights({result})
					)
				),
			account !== undefined &&
				Subscription.make('travel', account, () =>
					readTrips(
						reads => reads.travelAtom,
						result => Message.Travel({result})
					)
				),
			account !== undefined && Subscription.make('push', account, () => registering),
			Subscription.make(
				'foreground',
				Stream.map(activated, () => Message.Reread())
			),
			Subscription.make(
				'notifications',
				Stream.flatMap(tapped, tap =>
					Stream.make(
						Message.Opened({route: tap.route}),
						...Option.toArray(Option.map(tap.url, url => Message.OpenUrl({url})))
					)
				)
			),
			$.model.pasteOpen &&
				Subscription.make(
					'paste',
					Stream.map(pasted, file => Message.PasteFile({file}))
				)
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
		Flights: ($, message) => {
			if (Option.exists(AsyncResult.error(message.result), isDenied)) {
				return $.evolve({flights: message.result}).run(Command.asNoop(Reload.make({accountOnly: true})))
			}
			return $.evolve({flights: message.result})
		},
		OpenUrl: ($, message) =>
			$.run(Command.map(OpenUrl.make({url: message.url}), error => Message.Reported({error, saved: false}))),
		Opened: ($, message) => $.run(navigateTo($.model.route, message.route)),
		PasteFile: ($, message) => {
			if (!$.model.pasteOpen) return $.model
			return $.evolve({error: undefined}).run(run(Action.cases.File.make({file: message.file})))
		},
		PasteSubmit: $ => {
			if (String.isEmpty(String.trim($.model.pastedText))) return $.model
			return $.evolve({error: undefined}).run(run(Action.cases.Text.make({text: $.model.pastedText})))
		},
		PasteText: ($, message) => $.evolve({pastedText: message.text}),
		PasteVisibility: ($, message) => {
			if (message.open === $.model.pasteOpen) return $.model
			return $.evolve({error: undefined, pasteOpen: message.open, pastedText: ''})
		},
		Reported: ($, message) => {
			if (message.error !== undefined) return $.evolve({error: message.error})
			if (!message.saved) return $.model
			return $.evolve({error: undefined, pasteOpen: false, pastedText: ''})
		},
		Reread: $ => $.evolve({error: undefined, woke: DateTime.nowUnsafe()}).run(Command.asNoop(Reload.make({}))),
		Route: ($, message) => slide($.evolve({route: message.route}), isOpen, $.model.route, message.route),
		Select: ($, message) => {
			if (message.id === PAST) return $.evolve({pastOpen: !$.model.pastOpen})
			return Option.match(Schema.decodeOption(FlightId)(message.id), {
				onNone: () => $.model,
				onSome: found => $.run(navigateTo($.model.route, flightRoute(found)))
			})
		},
		SignIn: $ => $.evolve({error: undefined}).run(run(Action.cases.Session.make({logout: false}))),
		SignOut: $ => $.evolve({error: undefined}).run(run(Action.cases.Session.make({logout: true}))),
		Travel: ($, message) => $.evolve({travel: message.result}),
		TripTime: ($, message) => $.evolve({error: undefined}).run(run(Action.cases.TripTime.make({row: message.row})))
	}
})

export type TripsScreen = AppScreen<Component.Headless.Parts<typeof Screen>>

export const TripsApp = shellApp({
	every: '1 minute',
	missing: 'Page not found',
	name: 'Trips',
	props: Schema.Struct({route: TripsRoute}),
	screen: Screen
})
