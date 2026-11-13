import {Array, DateTime, Effect, Option, Schema, Stream, String, pipe} from 'effect'

import {Atom} from 'effect/reactivity'
import {getImageAsync, getStringAsync, hasImageAsync, hasStringAsync} from 'expo-clipboard'
import {File, Paths} from 'expo-file-system'

import {alertFailure} from '@deslop/components-mobile/alerts'
import {makeClipboard, readClipboard} from '@deslop/components-mobile/clipboard'
import type {ClipboardCopy, ClipboardKind} from '@deslop/components-mobile/clipboard'
import {cachedList} from '@deslop/components-mobile/files'
import {makeRemoval} from '@deslop/components-mobile/removal'
import {liveStream} from '@deslop/runtime/client/live-stream'
import {activationsAtom} from '@deslop/runtime/mobile/activations'
import {provideRuntimeOnce} from '@deslop/runtime/mobile/session'
import {listReducer} from '@deslop/runtime/shared/list'

import {RpcClient, session} from '#lib/session.ts'
import {byStart} from '#services/bookings/lib/utils.ts'
import type {BookingSource} from '#services/bookings/schema.ts'
import {Booking, BookingId, BookingsError, IMAGE_BYTES} from '#services/bookings/schema.ts'

const bookingsFile = new File(Paths.document, 'bookings.json')

const apply = listReducer(byStart)

// The copy on the iPhone opens the trip at the gate even without a network.
export const bookingsAtom = Atom.keepAlive(
	RpcClient.runtime.atom(get => {
		if (!session.signedIn(get)) return Stream.never
		return cachedList(
			get,
			bookingsFile,
			Booking.json,
			pipe(liveStream(RpcClient, 'bookings.events'), Stream.scan(Array.empty<Booking>, apply), Stream.drop(1)),
			session.reconnectOrSignOut
		)
	})
)

const bookingFromClipboard = Effect.fnUntraced(function* (offer: ClipboardCopy) {
	if (offer.kind === 'image') {
		const copied = yield* Effect.tryPromise({
			catch: cause => BookingsError.make({cause, message: 'The copied screenshot could not be read.'}),
			try: () => getImageAsync({format: 'jpeg', jpegQuality: 0.85})
		})
		if (copied === null) return yield* BookingsError.make({message: 'The clipboard no longer holds an image.'})
		const image = yield* Effect.mapError(
			Schema.decodeEffect(Schema.Uint8ArrayFromBase64)(String.replace(/^data:[^,]*,/u, '')(copied.data)),
			cause => BookingsError.make({cause, message: 'The copied screenshot could not be read.'})
		)
		if (image.byteLength === 0 || image.byteLength > IMAGE_BYTES) {
			return yield* BookingsError.make({message: 'Copy a screenshot smaller than 4 MB and try again.'})
		}
		return {_tag: 'image', image} satisfies BookingSource
	}
	const text = pipe(
		yield* Effect.tryPromise({
			catch: cause => BookingsError.make({cause, message: 'The copied text could not be read.'}),
			try: () => getStringAsync()
		}),
		String.trim,
		String.slice(0, 60_000)
	)
	if (String.isEmpty(text)) return yield* BookingsError.make({message: 'The clipboard no longer holds text.'})
	return {_tag: 'text', text} satisfies BookingSource
})

export const clipboard = makeClipboard({
	// A refused booking is answered, but a lost connection offers the same copy on the next return.
	answered: error => error._tag === 'BookingsError',
	detect: Effect.gen(function* () {
		if (yield* Effect.promise(() => hasImageAsync())) return Option.some<ClipboardKind>('image')
		if (yield* Effect.promise(() => hasStringAsync())) return Option.some<ClipboardKind>('text')
		return Option.none<ClipboardKind>()
	}),
	labels: {
		confirm: 'Add',
		notSaved: 'Not saved',
		questions: {
			image: 'Add a booking from the copied screenshot?',
			link: 'Add a booking from the copied text?',
			text: 'Add a booking from the copied text?'
		}
	},
	save: Effect.fnUntraced(function* (copy, get) {
		const source = yield* readClipboard(copy.count, bookingFromClipboard(copy))
		yield* provideRuntimeOnce(
			get,
			RpcClient.runtime,
			Effect.flatMap(RpcClient, client => client('bookings.save', source))
		)
	})
})

export const removal = makeRemoval({
	notRemoved: 'Not Deleted',
	remove: (id, get) =>
		provideRuntimeOnce(
			get,
			RpcClient.runtime,
			Effect.flatMap(RpcClient, client => client('bookings.remove', {id: BookingId.make(id)}))
		)
})

export const refreshAtom = Atom.fn((id: Booking['id'], get) =>
	pipe(
		provideRuntimeOnce(
			get,
			RpcClient.runtime,
			Effect.flatMap(RpcClient, client => client('tracking.refresh', {id}))
		),
		// Offline the call waits for a connection, and the pull spinner would never stop.
		Effect.timeoutOrElse({
			duration: '30 seconds',
			orElse: () => BookingsError.make({message: 'The server did not answer.'})
		}),
		alertFailure('Not Refreshed')
	)
)

export const nowAtom = Atom.make(get => {
	get(activationsAtom)
	return Stream.mapEffect(Stream.tick('1 minute'), () => DateTime.now)
})
