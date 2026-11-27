import {Command, UiSchema} from '@effect/ui'

import {Cause, DateTime, Effect, Layer, Option, Predicate, Schema, Semaphore, String, pipe} from 'effect'

import {AsyncResult, AtomRegistry} from 'effect/reactivity'

import type {AuthError} from '@deslop/runtime/shared/auth'
import {Account} from '@deslop/runtime/shared/schema'
import {DateTimeUtcFromFiniteMillis} from '@deslop/runtime/shared/time'

import {Flight, FlightId, FlightsError, TicketSource, TravelTime} from '#contracts'

import type {TripsData} from '#screens/data.ts'
import {TripsRoute} from '#screens/routes.ts'

const AccountRead = AsyncResult.Schema({error: Schema.Unknown, success: Account})
const FlightsRead = AsyncResult.Schema({error: Schema.Unknown, success: Schema.Array(Flight.json)})
const TravelRead = AsyncResult.Schema({error: Schema.Unknown, success: Schema.Array(TravelTime)})

export type Model = typeof Model.Type
export const Model = Schema.Struct({
	account: AccountRead,
	error: Schema.UndefinedOr(Schema.String),
	flights: FlightsRead,
	now: DateTimeUtcFromFiniteMillis,
	pastOpen: Schema.Boolean,
	pasteOpen: Schema.Boolean,
	pastedText: Schema.String,
	route: TripsRoute,
	travel: TravelRead
})

export type Message = typeof Message.Type
export const Message = UiSchema.TaggedEnum({
	Account: {result: AccountRead},
	Back: {},
	Clock: {now: DateTimeUtcFromFiniteMillis},
	Flights: {result: FlightsRead},
	Ignored: {},
	OpenUrl: {url: Schema.String},
	Opened: {route: TripsRoute},
	PasteFile: {file: Schema.Unknown},
	PasteSubmit: {},
	PasteText: {text: Schema.String},
	PasteVisibility: {open: Schema.Boolean},
	Retry: {},
	Route: {route: TripsRoute},
	Select: {id: FlightId},
	SessionChanged: {message: Schema.UndefinedOr(Schema.String)},
	SignIn: {},
	SignOut: {},
	TogglePast: {},
	Travel: {result: TravelRead},
	TripTime: {row: TravelTime},
	WriteFailed: {error: Schema.String},
	WriteSaved: {}
})

export function initial(route: TripsRoute): Model {
	return {
		account: AsyncResult.initial(),
		error: undefined,
		flights: AsyncResult.initial(),
		now: DateTime.nowUnsafe(),
		pastOpen: false,
		pasteOpen: false,
		pastedText: '',
		route,
		travel: AsyncResult.initial()
	}
}

export const Action = UiSchema.TaggedEnum({
	File: {file: Schema.Unknown},
	Session: {logout: Schema.Boolean},
	Text: {text: Schema.String},
	TripTime: {row: TravelTime}
})

export type Actions = {
	readonly openUrl: (url: string) => Effect.Effect<void, FlightsError>
	readonly signIn: Effect.Effect<boolean, AuthError>
	readonly signOut: (registry: AtomRegistry.AtomRegistry) => Effect.Effect<Model['error'], AuthError>
	readonly ticket: (file: unknown) => Effect.Effect<Option.Option<TicketSource>, FlightsError>
}

function failed(cause: Cause.Cause<unknown>) {
	const reason = Cause.squash(cause)
	if (Predicate.hasProperty(reason, 'message') && Predicate.isString(reason.message)) return reason.message
	return Cause.pretty(cause)
}

export class Reload extends Command.Service<Reload>()('Trips/Reload', {
	args: {accountOnly: Schema.optionalKey(Schema.Boolean)}
}) {}

export class OpenUrl extends Command.Service<OpenUrl>()('Trips/OpenUrl', {
	args: {url: Schema.String},
	error: FlightsError
}) {}

export class Run extends Command.Service<Run>()('Trips/Run', {args: {action: Action}, success: Message}) {}

export function layerCommands(board: TripsData, options: Actions) {
	function write<E>(registry: AtomRegistry.AtomRegistry, run: Effect.Effect<void, E>, refreshTravel = false) {
		return Effect.matchCause(
			Effect.gen(function* () {
				if (registry.get(board.ownerAtom) === undefined) {
					return yield* FlightsError.make({message: 'Sign in to save a booking.'})
				}
				yield* run
				if (refreshTravel) registry.refresh(board.travelAtom)
			}),
			{onFailure: cause => Message.WriteFailed({error: failed(cause)}), onSuccess: () => Message.WriteSaved()}
		)
	}

	return Layer.mergeAll(
		Run.toLayer(
			Effect.gen(function* () {
				const registry = yield* AtomRegistry.AtomRegistry
				const exclusive = yield* Semaphore.make(1)
				function save(source: Effect.Effect<Option.Option<TicketSource>, FlightsError>) {
					return Effect.matchEffect(source, {
						onFailure: error => Effect.succeed(Message.WriteFailed({error: error.message})),
						onSuccess: ticket =>
							Option.match(ticket, {
								onNone: () => Effect.succeed<Message>(Message.Ignored()),
								onSome: value => write(registry, board.save(registry, value))
							})
					})
				}

				function session(logout: boolean) {
					return Effect.matchCause(
						Effect.gen(function* () {
							if (logout) return yield* options.signOut(registry)
							if (yield* options.signIn) board.refresh(registry, true)
							return undefined
						}),
						{
							onFailure: cause => Message.SessionChanged({message: failed(cause)}),
							onSuccess: message => Message.SessionChanged({message})
						}
					)
				}
				return request =>
					pipe(
						Action.match(request.action, {
							File: input => save(options.ticket(input.file)),
							Session: input => session(input.logout),
							Text: input =>
								save(
									Effect.mapBoth(TicketSource.cases.text.makeEffect({text: String.trim(input.text)}), {
										onFailure: cause =>
											FlightsError.make({cause, message: 'Paste booking text or a link, up to 60,000 characters.'}),
										onSuccess: Option.some
									})
								),
							TripTime: input => write(registry, board.setTravel(registry, input.row), true)
						}),
						exclusive.withPermitsIfAvailable(1),
						Effect.map(Option.getOrElse<Message>(Message.Ignored))
					)
			})
		),
		OpenUrl.toLayer(request => options.openUrl(request.url)),
		Reload.toLayer(
			AtomRegistry.AtomRegistry.useSync(
				registry => request => Effect.sync(() => board.refresh(registry, request.accountOnly === true))
			)
		)
	)
}
