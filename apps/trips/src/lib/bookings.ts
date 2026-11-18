import {Array, Effect, Option, Schema, Stream, String, pipe} from 'effect'

import {Atom} from 'effect/reactivity'
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

import {RpcClient, session} from '#lib/session.ts'
import {byStart} from '#services/bookings/lib/utils.ts'
import type {Booking} from '#services/bookings/schema.ts'
import {BookingIds, BookingModel, BookingSource, BookingsError, IMAGE_BYTES} from '#services/bookings/schema.ts'

const bookingsFile = new File(Paths.document, 'bookings.json')

const apply = listReducer(byStart, booking => booking.id)

// The copy on the iPhone opens the trip at the gate even without a network.
export const bookingsAtom = Atom.keepAlive(
	RpcClient.runtime.atom(get =>
		cachedList(
			get,
			session,
			bookingsFile,
			BookingModel.json,
			pipe(liveStream(RpcClient, 'bookings.events'), Stream.scan(Array.empty<Booking>, apply), Stream.drop(1)),
			reconnectOnDrop
		)
	)
)

// The image is read and sized natively into a temporary JPEG, refused there when it is over the ticket limit, and its bytes are read only once it fits.
function copiedScreenshot(count: string) {
	return Effect.scoped(
		Effect.flatMap(copiedImage(count, IMAGE_BYTES), file =>
			Effect.tryPromise({
				catch: cause => BookingsError.make({cause, message: 'The copied screenshot could not be read.'}),
				try: () => file.arrayBuffer()
			})
		)
	)
}

const bookingFromClipboard = Effect.fnUntraced(function* (offer: ClipboardCopy) {
	if (offer.kind === 'image') {
		return BookingSource.cases.image.make({image: new Uint8Array(yield* copiedScreenshot(offer.count))})
	}
	const text = pipe(
		yield* readClipboard(
			offer.count,
			Effect.tryPromise({
				catch: cause => BookingsError.make({cause, message: 'The copied text could not be read.'}),
				try: () => getStringAsync()
			})
		),
		String.trim,
		String.slice(0, 60_000)
	)
	if (String.isEmpty(text)) return yield* BookingsError.make({message: 'The clipboard no longer holds text.'})
	return BookingSource.cases.text.make({text})
})

export const clipboard = makeClipboard({
	// A refused booking or a copy that cannot be read is answered, but a lost connection offers the same copy on the next return.
	answered: error => Schema.is(BookingsError)(error) || Schema.is(ClipboardError)(error),
	detect: Effect.gen(function* () {
		if (yield* Effect.promise(() => hasImageAsync())) return Option.some<ClipboardKind>('image')
		if (yield* Effect.promise(() => hasStringAsync())) return Option.some<ClipboardKind>('text')
		return Option.none<ClipboardKind>()
	}),
	labels: {
		confirm: 'Add',
		notSaved: 'Not Saved',
		questions: {
			image: 'Add a booking from the copied screenshot?',
			link: 'Add a booking from the copied text?',
			text: 'Add a booking from the copied text?'
		}
	},
	save: Effect.fnUntraced(function* (copy, get) {
		const source = yield* bookingFromClipboard(copy)
		yield* provideRuntimeOnce(
			get,
			RpcClient.runtime,
			Effect.flatMap(RpcClient, client => client('bookings.save', source))
		)
	})
})

// A journey's removal is keyed by the legs it showed, the only ones the server deletes, so a ticket shared during the undo wait stays.
export function journeyKey(journey: readonly Booking[]) {
	return pipe(
		journey,
		Array.map(leg => leg.id),
		Array.join(' ')
	)
}

export const removal = makeRemoval({
	notRemoved: 'Not Deleted',
	// Bookings deletes the legs in one transaction.
	remove: Effect.fnUntraced(function* (key: string, get: Atom.AtomContext) {
		const ids = yield* Effect.mapError(Schema.decodeEffect(BookingIds)(String.split(key, ' ')), cause =>
			BookingsError.make({cause, message: 'The journey to delete could not be read.'})
		)
		return yield* Effect.mapError(
			provideRuntimeOnce(
				get,
				RpcClient.runtime,
				Effect.flatMap(RpcClient, client => client('bookings.remove', {ids}))
			),
			cause => {
				if (Schema.is(BookingsError)(cause)) return cause
				return BookingsError.make({
					cause,
					message: 'The server did not confirm whether the journey was deleted. Reconnect to check.'
				})
			}
		)
	})
})

// Every request gets its first answer within a minute or fails, so the pull spinner always stops.
export const refreshAtom = Atom.fn((id: Booking['id'], get) =>
	pipe(
		provideRuntimeOnce(
			get,
			RpcClient.runtime,
			Effect.flatMap(RpcClient, client => client('tracking.refresh', {id}))
		),
		alertFailure('Not Refreshed')
	)
)

export const startAtom = Atom.fn((id: Booking['id'], get) =>
	pipe(
		provideRuntimeOnce(
			get,
			RpcClient.runtime,
			Effect.flatMap(RpcClient, client => client('push.start', {id}))
		),
		alertFailure('Not Started')
	)
)

export const nowAtom = Atom.make(get => {
	get.subscribe(activationsAtom, () => get.refresh(clockAtom('1 minute')))
	return get(clockAtom('1 minute'))
})
