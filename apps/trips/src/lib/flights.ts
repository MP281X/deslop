import {Array, DateTime, Effect, Option, Schema, Stream, String, pipe} from 'effect'

import {AsyncResult, Atom} from 'effect/reactivity'
import {getStringAsync, hasImageAsync, hasStringAsync} from 'expo-clipboard'
import {File, Paths} from 'expo-file-system'

import {alertFailure} from '@deslop/components-mobile/lib/alerts'
import {ClipboardError, copiedImage, makeClipboard, readClipboard} from '@deslop/components-mobile/lib/clipboard'
import type {ClipboardCopy, ClipboardKind} from '@deslop/components-mobile/lib/clipboard'
import {cachedList} from '@deslop/components-mobile/lib/files'
import {makeRemoval} from '@deslop/components-mobile/lib/removal'
import {clockAtom} from '@deslop/runtime/client/clock'
import {liveStream, reconnectOnDrop} from '@deslop/runtime/client/live-stream'
import {activationsAtom} from '@deslop/runtime/mobile/activations'
import {provideRuntimeOnce} from '@deslop/runtime/mobile/session'
import {listReducer} from '@deslop/runtime/shared/list'

import {boardOf} from '#lib/day.ts'
import {RpcClient, session} from '#lib/session.ts'
import {byDeparture} from '#services/flights/lib/utils.ts'
import {FlightId, TicketSource, FlightsError, Flight, IMAGE_BYTES} from '#services/flights/schema.ts'

const flightsFile = new File(Paths.document, 'flights.json')

const apply = listReducer(byDeparture, flight => flight.id)

// The copy on the iPhone opens the trip at the gate even without a network.
export const flightsAtom = Atom.keepAlive(
	RpcClient.runtime.atom(get =>
		cachedList(
			get,
			session,
			flightsFile,
			Flight.json,
			pipe(liveStream(RpcClient, 'flights.events'), Stream.scan(Array.empty<Flight>, apply), Stream.drop(1)),
			reconnectOnDrop
		)
	)
)

// The image is read and sized natively into a temporary JPEG, refused there when it is over the ticket limit, and its bytes are read only once it fits.
function copiedScreenshot(count: string) {
	return Effect.scoped(
		Effect.flatMap(copiedImage(count, IMAGE_BYTES), file =>
			Effect.tryPromise({
				catch: cause => FlightsError.make({cause, message: 'The copied screenshot could not be read.'}),
				try: () => file.arrayBuffer()
			})
		)
	)
}

const ticketFromClipboard = Effect.fnUntraced(function* (offer: ClipboardCopy) {
	if (offer.kind === 'image') {
		return TicketSource.cases.image.make({image: new Uint8Array(yield* copiedScreenshot(offer.count))})
	}
	const text = pipe(
		yield* readClipboard(
			offer.count,
			Effect.tryPromise({
				catch: cause => FlightsError.make({cause, message: 'The copied text could not be read.'}),
				try: () => getStringAsync()
			})
		),
		String.trim,
		String.slice(0, 60_000)
	)
	if (String.isEmpty(text)) return yield* FlightsError.make({message: 'The clipboard no longer holds text.'})
	return TicketSource.cases.text.make({text})
})

export const clipboard = makeClipboard({
	// A refused flight or a copy that cannot be read is answered, but a lost connection offers the same copy on the next return.
	answered: error => Schema.is(FlightsError)(error) || Schema.is(ClipboardError)(error),
	detect: Effect.gen(function* () {
		if (yield* Effect.promise(() => hasImageAsync())) return Option.some<ClipboardKind>('image')
		if (yield* Effect.promise(() => hasStringAsync())) return Option.some<ClipboardKind>('text')
		return Option.none<ClipboardKind>()
	}),
	labels: {
		confirm: 'Add',
		notSaved: 'Not Saved',
		questions: {
			image: 'Add a flight from the copied screenshot?',
			link: 'Add a flight from the copied text?',
			text: 'Add a flight from the copied text?'
		}
	},
	save: Effect.fnUntraced(function* (copy, get) {
		const source = yield* ticketFromClipboard(copy)
		yield* provideRuntimeOnce(
			get,
			RpcClient.runtime,
			Effect.flatMap(RpcClient, client => client('flights.save', source))
		)
	})
})

export const removal = makeRemoval({
	notRemoved: 'Not Deleted',
	remove: Effect.fnUntraced(function* (key: string, get: Atom.AtomContext) {
		const id = yield* Effect.mapError(Schema.decodeEffect(FlightId)(key), cause =>
			FlightsError.make({cause, message: 'The flight to delete could not be read.'})
		)
		return yield* Effect.mapError(
			provideRuntimeOnce(
				get,
				RpcClient.runtime,
				Effect.flatMap(RpcClient, client => client('flights.remove', {id}))
			),
			cause => {
				if (Schema.is(FlightsError)(cause)) return cause
				return FlightsError.make({
					cause,
					message: 'The server did not confirm whether the flight was deleted. Reconnect to check.'
				})
			}
		)
	})
})

// Every request gets its first answer within a minute or fails, so the pull spinner always stops.
export const refreshAtom = Atom.fn((id: FlightId, get) =>
	pipe(
		provideRuntimeOnce(
			get,
			RpcClient.runtime,
			Effect.flatMap(RpcClient, client => client('tracking.refresh', {id}))
		),
		alertFailure('Not Refreshed')
	)
)

// A return reads the time again, as each tick does. Refreshing the clock from a listener of this atom rebuilt it, which added the listener again while the return was still calling them: the app never yielded.
export const nowAtom = Atom.make(get => {
	get(activationsAtom)
	get(clockAtom('1 minute'))
	return DateTime.nowUnsafe()
})

// The flight under way or next, the one the board shows.
export const boardAtom = Atom.make(get =>
	pipe(
		get(flightsAtom),
		AsyncResult.value,
		Option.flatMap(flights => boardOf(flights, get(nowAtom)))
	)
)
