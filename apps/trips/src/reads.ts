import {Command, Route} from '@effect/ui'

import {
	Array,
	Boolean,
	Cause,
	Context,
	Effect,
	Function,
	Layer,
	Option,
	Predicate,
	Redacted,
	Schema,
	Semaphore,
	Stream,
	String,
	pipe
} from 'effect'

import {AsyncResult, Atom, AtomRegistry, AtomRpc} from 'effect/reactivity'

import {backOrHome} from '@deslop/components/navigation'
import {observe} from '@deslop/runtime/client/atom'
import {isDeniedCause, keepValueThroughOutages, reconnectOnDrop} from '@deslop/runtime/client/live-stream'
import {writeOutcome} from '@deslop/runtime/client/protocol'
import {registerPushToken} from '@deslop/runtime/client/push'
import {Authenticate, Refresh, Shell, SignOut, observeRead} from '@deslop/runtime/client/shell'
import {ApnsToken} from '@deslop/runtime/shared/apns'
import type {Device} from '@deslop/runtime/shared/apns'
import {UserId} from '@deslop/runtime/shared/auth'
import {listReducer} from '@deslop/runtime/shared/list'
import {RpcStream} from '@deslop/runtime/shared/rpc'

import {RpcContracts} from '#contracts'

import {Flight, FlightId, FlightsError, TicketSource, TravelTime} from '#flights/contract.ts'
import {byDeparture} from '#flights/shared.ts'
import {PhoneId, PushBundle} from '#push/contract.ts'

const search = {pane: Schema.optionalKey(Schema.Literals(['list', 'detail']))}
export type TripsRoute = typeof TripsRoute.Type
export const TripsRoute = Route.union({
	Day: Route.make('/day/:id', {params: {id: FlightId}, search}),
	Flight: Route.make('/flight/:id', {params: {id: FlightId}, search}),
	Home: Route.make('/', {search}),
	NotFound: Route.make('/*')
})

export function flightRoute(id: FlightId) {
	return TripsRoute.Flight({params: {id}, search: {}})
}

// The flight a route opens, and whether it is the day the Live Activity links to.
export function targetOf(route: TripsRoute) {
	if (!TripsRoute.isAnyOf(['Day', 'Flight'])(route)) return undefined
	return {day: TripsRoute.isAnyOf(['Day'])(route), id: route.params.id}
}

type Cached = typeof Cached.Type
const Cached = Schema.fromJsonString(Schema.Struct({account: UserId, flights: Schema.Array(Flight.json)}))
const reduce = listReducer(byDeparture, flight => flight.id)

// The board kept on the iPhone for a start without a network.
export type BoardCache = {
	readonly clear: Effect.Effect<void>
	readonly read: Effect.Effect<Option.Option<string>>
	readonly write: (text: string) => Effect.Effect<void>
}

type PushPhone = typeof PushPhone.Type
export const PushPhone = Schema.Struct({bundle: PushBundle, phone: PhoneId})

// The tokens an iPhone reports for its alerts and for the Live Activities started on it.
type PushSource = {
	readonly alerts: Stream.Stream<string, FlightsError>
	readonly device: Effect.Effect<PushPhone, FlightsError | Schema.SchemaError>
	readonly starts: Stream.Stream<string, FlightsError>
}

// A flight a notification opens, and the link its action leads to.
export type Tap = {readonly route: TripsRoute; readonly url: Option.Option<string>}

// What each host does on its own: the iPhone keeps the board and registers for push, the web reads pasted files.
export class Handset extends Context.Service<
	Handset,
	{
		readonly activation: Stream.Stream<void>
		readonly cache: Option.Option<BoardCache>
		readonly notifications: Stream.Stream<Tap>
		readonly openUrl: (url: string) => Effect.Effect<void, FlightsError>
		readonly paste: Stream.Stream<unknown>
		readonly push: Option.Option<PushSource>
		readonly ticket: (file: unknown) => Effect.Effect<Option.Option<TicketSource>, FlightsError>
	}
>()('@deslop/trips/reads/Handset') {}

function makeReads(shell: Context.Service.Shape<typeof Shell>, device: Context.Service.Shape<typeof Handset>) {
	class Client extends AtomRpc.Service<Client>()('Trips/Rpc', {
		group: RpcContracts.middleware(RpcStream),
		protocol: shell.protocol
	}) {}

	const ownerAtom = Atom.map(shell.account, result =>
		Option.getOrUndefined(Option.map(AsyncResult.value(result), user => user.id))
	)
	const flightsAtoms = Atom.family((account: UserId) =>
		Client.runtime.atom(get => {
			const live = pipe(
				Stream.unwrap(Effect.map(Client, call => call('flights.events', undefined))),
				Stream.scan(Array.empty<Flight>, reduce),
				Stream.drop(1)
			)
			return Option.match(device.cache, {
				onNone: () => keepValueThroughOutages(get, live, reconnectOnDrop),
				onSome: cache =>
					Stream.concat(
						pipe(
							cache.read,
							Effect.map(text =>
								pipe(
									text,
									Option.flatMap(Schema.decodeOption(Cached)),
									Option.filter(copy => copy.account === account),
									Option.map(copy => copy.flights),
									Option.toArray
								)
							),
							Stream.fromEffect,
							Stream.flattenIterable
						),
						keepValueThroughOutages(
							get,
							pipe(
								live,
								Stream.tap(flights =>
									pipe(
										Schema.encodeEffect(Cached)({account, flights}),
										Effect.flatMap(cache.write),
										Effect.ignore({log: 'Warn', message: 'The offline board could not be saved'})
									)
								),
								Stream.tapCause(cause => {
									if (isDeniedCause(cause)) return cache.clear
									return Effect.void
								})
							),
							reconnectOnDrop
						)
					)
			})
		})
	)
	const travelAtom = Client.runtime.atom(get => {
		if (get(ownerAtom) === undefined) return Effect.never
		return Effect.flatMap(Client, call => call('travel.list', undefined))
	})
	// Registers the iPhone's tokens for as long as someone is signed in.
	const pushAtom = Client.runtime.atom(get => {
		const source = Option.getOrUndefined(device.push)
		if (source === undefined || get(ownerAtom) === undefined) return Effect.void
		return Effect.ignore(
			Effect.gen(function* () {
				const phone = yield* source.device
				const call = yield* Client
				function register(stream: PushSource['alerts'], kind: Device['kind']) {
					return pipe(
						stream,
						Stream.changes,
						Stream.switchMap(value =>
							Stream.fromEffectDrain(
								Effect.flatMap(Schema.decodeEffect(ApnsToken)(value), token =>
									registerPushToken(call('push.register', {...phone, kind, token: Redacted.make(token)}))
								)
							)
						),
						Stream.runDrain,
						Effect.ignore({log: 'Warn', message: `The ${kind} token could not be read`})
					)
				}
				yield* Effect.all([register(source.alerts, 'alert'), register(source.starts, 'start')], {
					concurrency: 'unbounded',
					discard: true
				})
			}),
			{log: 'Warn', message: 'Trips could not register this iPhone'}
		)
	})
	// Reads the account again and, unless `accountOnly`, the flights and travel times.
	function refresh(registry: AtomRegistry.AtomRegistry, accountOnly: boolean) {
		registry.refresh(shell.account)
		if (accountOnly) return
		const account = registry.get(ownerAtom)
		if (account !== undefined) registry.refresh(flightsAtoms(account))
		registry.refresh(travelAtom)
	}
	function write<E>(registry: AtomRegistry.AtomRegistry, effect: Effect.Effect<void, E, Client>) {
		return pipe(
			registry,
			AtomRegistry.getResult(Client.runtime, {suspendOnWaiting: true}),
			Effect.flatMap(context => writeOutcome(Effect.provideContext(effect, context)))
		)
	}
	return {
		account: shell.account,
		flightsAtoms,
		owner: ownerAtom,
		pushAtom,
		refresh,
		save: (registry: AtomRegistry.AtomRegistry, ticket: TicketSource) =>
			write(
				registry,
				Effect.flatMap(Client, call => call('flights.save', ticket))
			),
		setTravel: (registry: AtomRegistry.AtomRegistry, row: TravelTime) =>
			write(
				registry,
				Effect.flatMap(Client, call => call('travel.set', row))
			),
		travelAtom
	}
}

class TripsReads extends Context.Service<TripsReads, ReturnType<typeof makeReads>>()('@deslop/trips/reads/TripsReads') {
	static readonly layer = Layer.effect(
		this,
		Effect.gen(function* () {
			return makeReads(yield* Shell, yield* Handset)
		})
	)
}

export function readTrips<A extends AsyncResult.AsyncResult<unknown, unknown>, M>(
	pick: (reads: ReturnType<typeof makeReads>) => Atom.Atom<A>,
	read: (value: A) => M
) {
	return Stream.unwrap(TripsReads.useSync(reads => observeRead(pick(reads), read)))
}

// The registration of this iPhone's tokens, running while someone is signed in.
export const registering = Stream.unwrap(
	TripsReads.useSync(reads => Stream.drain(observe(reads.pushAtom, Function.identity)))
)

// Each time the app comes to the front, and once as it starts.
export const activated = Stream.unwrap(Effect.map(Handset, device => device.activation))
export const tapped = Stream.unwrap(Effect.map(Handset, device => device.notifications))
export const pasted = Stream.unwrap(Effect.map(Handset, device => device.paste))

export type Action = typeof Action.Type
export const Action = Schema.TaggedUnion({
	File: {file: Schema.Unknown},
	Session: {logout: Schema.Boolean},
	Text: {text: Schema.String},
	TripTime: {row: TravelTime}
})

// What a write came to: the text of what went wrong, and whether it was saved; neither when it was left alone.
type Written = typeof Written.Type
const Written = Schema.Struct({error: Schema.UndefinedOr(Schema.String), saved: Schema.Boolean})

function failed(cause: Cause.Cause<unknown>) {
	const reason = Cause.squash(cause)
	if (Predicate.hasProperty(reason, 'message') && Predicate.isString(reason.message)) return reason.message
	return Cause.pretty(cause)
}

// What signing in or out came to: the text of what went wrong, if anything.
function settled<A, E, R>(change: Effect.Effect<A, E, R>) {
	return Effect.matchCause(change, {
		onFailure: cause => ({error: failed(cause), saved: false}),
		onSuccess: () => ({error: undefined, saved: false})
	})
}

// Runs what the person asked: one at a time, and only while someone is signed in.
export class Run extends Command.Service<Run>()('Trips/Run', {args: {action: Action}, success: Written}) {
	static readonly layer = this.toLayer(
		Effect.gen(function* () {
			const reads = yield* TripsReads
			const device = yield* Handset
			const registry = yield* AtomRegistry.AtomRegistry
			const authenticate = yield* Authenticate
			const refresh = yield* Refresh
			const signOut = yield* SignOut
			const exclusive = yield* Semaphore.make(1)
			function write<E>(run: Effect.Effect<void, E>, refreshTravel = false) {
				return Effect.matchCause(
					Effect.gen(function* () {
						if (registry.get(reads.owner) === undefined) {
							return yield* FlightsError.make({message: 'Sign in to save a booking.'})
						}
						yield* run
						if (refreshTravel) registry.refresh(reads.travelAtom)
					}),
					{
						onFailure: cause => ({error: failed(cause), saved: false}),
						onSuccess: () => ({error: undefined, saved: true})
					}
				)
			}
			function save(source: Effect.Effect<Option.Option<TicketSource>, FlightsError>) {
				return Effect.matchEffect(source, {
					onFailure: error => Effect.succeed({error: error.message, saved: false}),
					onSuccess: ticket =>
						Option.match(ticket, {
							onNone: () => Effect.succeed({error: undefined, saved: false}),
							onSome: value => write(reads.save(registry, value))
						})
				})
			}
			// Signing in or out is one of the person's asks, so it waits its turn with the others.
			const signedIn = Effect.flatMap(authenticate({}), began =>
				Boolean.match(began, {onFalse: () => Effect.void, onTrue: () => refresh({authenticated: true})})
			)
			const signedOut = Effect.asVoid(signOut({}))
			return request =>
				pipe(
					Action.match(request.action, {
						File: input => save(device.ticket(input.file)),
						Session: input => settled(Boolean.match(input.logout, {onFalse: () => signedIn, onTrue: () => signedOut})),
						Text: input =>
							save(
								Effect.mapBoth(TicketSource.cases.text.makeEffect({text: String.trim(input.text)}), {
									onFailure: cause =>
										FlightsError.make({cause, message: 'Paste booking text or a link, up to 60,000 characters.'}),
									onSuccess: Option.some
								})
							),
						TripTime: input => write(reads.setTravel(registry, input.row), true)
					}),
					exclusive.withPermitsIfAvailable(1),
					Effect.map(Option.getOrElse(() => ({error: undefined, saved: false})))
				)
		})
	)
}

// Reads again after the app came back, or after a refusal the account may have changed.
export class Reload extends Command.Service<Reload>()('Trips/Reload', {
	args: {accountOnly: Schema.optionalKey(Schema.Boolean)}
}) {
	static readonly layer = this.toLayer(
		Effect.gen(function* () {
			const reads = yield* TripsReads
			const registry = yield* AtomRegistry.AtomRegistry
			return request => Effect.sync(() => reads.refresh(registry, request.accountOnly === true))
		})
	)
}

// Opens a link in the host, and says what went wrong, if anything.
export class OpenUrl extends Command.Service<OpenUrl>()('Trips/OpenUrl', {
	args: {url: Schema.String},
	success: Schema.UndefinedOr(Schema.String)
}) {
	static readonly layer = this.toLayer(
		Effect.map(
			Handset,
			device => request =>
				Effect.match(device.openUrl(request.url), {
					onFailure: error => error.message,
					onSuccess: Function.constUndefined
				})
		)
	)
}

// Back from a flight: one step in the history, or the list itself when the flight was the way in.
export class CloseFlight extends Command.Service<CloseFlight>()('Trips/CloseFlight', {args: {}}) {
	static readonly layer = this.toLayer(backOrHome(TripsRoute.Home({search: {}})))
}

// Trips' own part of what a host mounts on: its reads, and the commands that run on them and on the device.
export const layerTrips = Layer.provideMerge(
	Layer.mergeAll(Run.layer, Reload.layer, OpenUrl.layer, CloseFlight.layer),
	TripsReads.layer
)
