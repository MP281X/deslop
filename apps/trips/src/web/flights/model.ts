import {Command, UiSchema} from '@effect/ui'
import {HtmlFiles} from '@effect/ui/html'

import {Cause, Effect, Number, Option, Predicate, Schema, Semaphore, String, pipe} from 'effect'

import {AsyncResult, AtomRegistry} from 'effect/reactivity'

import {writeOutcome} from '@deslop/runtime/client/protocol'
import {Account} from '@deslop/runtime/shared/schema'
import {DateTimeUtcFromFiniteMillis} from '@deslop/runtime/shared/time'

import {Flight, FlightId, FlightsError, IMAGE_BYTES, TicketSource, TravelTime} from '#contracts'

import {ownerAtom, refreshFlights, travelAtom, TravelList} from '#web/flights/data.ts'
import {refreshAccount, resetAccount, RpcClient, signIn, signOut} from '#web/flights/session.ts'
import {TripsRoute} from '#web/routes.ts'

const AccountRead = AsyncResult.Schema({error: Schema.Unknown, success: Account})
const FlightsRead = AsyncResult.Schema({error: Schema.Unknown, success: Schema.Array(Flight.json)})
const TravelRead = AsyncResult.Schema({error: Schema.Unknown, success: TravelList})
type FileRef = typeof FileRef.Type
const FileRef = Schema.instanceOf(File)

export type Model = typeof Model.Type
export const Model = Schema.Struct({
	account: AccountRead,
	airportOpen: Schema.Boolean,
	error: Schema.UndefinedOr(Schema.String),
	flights: FlightsRead,
	listHidden: Schema.Boolean,
	narrow: Schema.Boolean,
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
	Airport: {open: Schema.Boolean},
	Clock: {now: DateTimeUtcFromFiniteMillis},
	Flights: {result: FlightsRead},
	Ignored: {},
	OpenUrl: {url: Schema.String},
	Opened: {day: Schema.Boolean, id: FlightId},
	PasteFile: {file: FileRef},
	PasteSubmit: {},
	PasteText: {text: Schema.String},
	PasteVisibility: {open: Schema.Boolean},
	Posture: {narrow: Schema.Boolean},
	Retry: {},
	Route: {route: TripsRoute},
	Select: {id: FlightId},
	SessionChanged: {message: Schema.UndefinedOr(Schema.String)},
	Sidebar: {},
	SignIn: {},
	SignOut: {},
	TogglePast: {},
	Travel: {result: TravelRead},
	TripTime: {row: TravelTime},
	WriteFailed: {error: Schema.String},
	WriteSaved: {}
})

export class Reload extends Command.Service<Reload>()('Trips/Reload', {
	args: {accountOnly: Schema.optionalKey(Schema.Boolean)},
	success: Schema.Void
}) {
	static readonly layer = this.toLayer(
		Effect.map(
			AtomRegistry.AtomRegistry,
			registry => request =>
				Effect.sync(() => {
					registry.refresh(refreshAccount)
					if (request.accountOnly === true) return
					refreshFlights(registry)
					registry.refresh(travelAtom)
				})
		)
	)
}

export function failed(cause: Cause.Cause<unknown>) {
	const reason = Cause.squash(cause)
	if (Predicate.hasProperty(reason, 'message') && Predicate.isString(reason.message)) return reason.message
	return Cause.pretty(cause)
}

function write<E>(registry: AtomRegistry.AtomRegistry, run: Effect.Effect<void, E, RpcClient>, refreshTravel = false) {
	return Effect.matchCause(
		Effect.gen(function* () {
			if (registry.get(ownerAtom) === undefined) {
				return yield* FlightsError.make({message: 'Sign in to save a booking.'})
			}
			yield* pipe(
				registry,
				AtomRegistry.getResult(RpcClient.runtime, {suspendOnWaiting: true}),
				Effect.flatMap(context => writeOutcome(Effect.provideContext(run, context)))
			)
			if (refreshTravel) registry.refresh(travelAtom)
		}),
		{onFailure: cause => Message.WriteFailed({error: failed(cause)}), onSuccess: () => Message.WriteSaved()}
	)
}

function save(registry: AtomRegistry.AtomRegistry, source: Effect.Effect<TicketSource, FlightsError>) {
	return write(
		registry,
		Effect.flatMap(source, ticket => Effect.flatMap(RpcClient, call => call('flights.save', ticket)))
	)
}

const bookingJpeg = Effect.fnUntraced(function* (file: File) {
	const image = yield* Effect.acquireRelease(
		Effect.tryPromise({
			catch: cause => FlightsError.make({cause, message: 'The booking image could not be read.'}),
			try: () => createImageBitmap(file)
		}),
		bitmap => Effect.sync(() => bitmap.close())
	)
	const size = Number.min(1, 1800 / Number.max(image.width, image.height))
	const canvas = document.createElement('canvas')
	canvas.width = Number.max(1, Number.round(size * image.width, 0))
	canvas.height = Number.max(1, Number.round(size * image.height, 0))
	const context = canvas.getContext('2d')
	if (Predicate.isNull(context)) return yield* FlightsError.make({message: 'The image canvas is not available.'})
	context.fillStyle = '#fff'
	context.fillRect(0, 0, canvas.width, canvas.height)
	context.drawImage(image, 0, 0, canvas.width, canvas.height)
	return yield* Effect.callback<Blob, FlightsError>(resume => {
		canvas.toBlob(
			blob => {
				if (blob === null) resume(Effect.fail(FlightsError.make({message: 'The booking image could not be read.'})))
				else resume(Effect.succeed(blob))
			},
			'image/jpeg',
			0.88
		)
	})
})

const ticketFromFile = Effect.fnUntraced(function* (file: File) {
	if (file.size === 0 || file.size > IMAGE_BYTES) {
		return yield* FlightsError.make({message: 'Choose an image or PDF up to 4 MB.'})
	}
	if (file.type === 'application/pdf') {
		const pdf = yield* Effect.mapError(HtmlFiles.readAsBytes(file), cause =>
			FlightsError.make({cause, message: 'The booking PDF could not be read.'})
		)
		return TicketSource.cases.pdf.make({pdf})
	}
	const image = yield* pipe(
		Effect.scoped(bookingJpeg(file)),
		Effect.flatMap(HtmlFiles.readAsBytes),
		Effect.mapError(cause => FlightsError.make({cause, message: 'The booking image could not be read.'}))
	)
	return yield* Effect.mapError(TicketSource.cases.image.makeEffect({image}), cause =>
		FlightsError.make({cause, message: 'The booking image is too large.'})
	)
})

export const Action = UiSchema.TaggedEnum({
	File: {file: FileRef},
	Session: {logout: Schema.Boolean},
	Text: {text: Schema.String},
	TripTime: {row: TravelTime}
})

function session(registry: AtomRegistry.AtomRegistry, logout: boolean) {
	return Effect.matchCause(
		Effect.gen(function* () {
			if (!logout) {
				if (yield* signIn) registry.refresh(refreshAccount)
				return undefined
			}
			const status = yield* signOut
			resetAccount(registry)
			if (status >= 200 && status < 300) return undefined
			return 'Signed out on this iPhone. Auth did not confirm signing out elsewhere.'
		}),
		{
			onFailure: cause => Message.SessionChanged({message: failed(cause)}),
			onSuccess: message => Message.SessionChanged({message})
		}
	)
}

export class Run extends Command.Service<Run>()('Trips/Run', {args: {action: Action}, success: Message}) {
	static readonly layer = this.toLayer(
		Effect.gen(function* () {
			const registry = yield* AtomRegistry.AtomRegistry
			const exclusive = yield* Semaphore.make(1)
			return ({action}) =>
				pipe(
					Action.match(action, {
						File: ({file}) => save(registry, ticketFromFile(file)),
						Session: ({logout}) => session(registry, logout),
						Text: ({text}) =>
							save(
								registry,
								Effect.mapError(TicketSource.cases.text.makeEffect({text: String.trim(text)}), cause =>
									FlightsError.make({cause, message: 'Paste booking text or a link, up to 60,000 characters.'})
								)
							),
						TripTime: ({row}) =>
							write(
								registry,
								Effect.flatMap(RpcClient, call => call('travel.set', row)),
								true
							)
					}),
					exclusive.withPermitsIfAvailable(1),
					Effect.map(Option.getOrElse(() => Message.Ignored()))
				)
		})
	)
}
