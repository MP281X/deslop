import {Array, DateTime, Effect, Option, Schema, Stream, String, pipe} from 'effect'

import {Machine} from '@typeonce/effect-machine'
import {AtomMachine} from '@typeonce/effect-machine/reactivity'
import {Atom} from 'effect/reactivity'
import * as Clipboard from 'expo-clipboard'
import {File, Paths} from 'expo-file-system'

import {makeClipboard, readClipboard} from '@deslop/components-mobile/clipboard'
import type {ClipboardCopy, ClipboardKind} from '@deslop/components-mobile/clipboard'
import {alert, cachedList} from '@deslop/components-mobile/utils'
import {activationsAtom} from '@deslop/runtime/mobile/activations'
import {listReducer} from '@deslop/runtime/schema'

import {RpcClient, session, withClient} from '#lib/session.ts'
import {byStart} from '#services/bookings/lib/utils.ts'
import type {BookingSource} from '#services/bookings/schema.ts'
import {Booking, BookingsError, IMAGE_BYTES} from '#services/bookings/schema.ts'

const bookingsFile = new File(Paths.document, 'bookings.json')

const apply = listReducer(byStart)

// The copy on the iPhone opens the trip at the gate even without a network.
export const bookingsAtom = Atom.keepAlive(
	RpcClient.runtime.atom(get => {
		if (!session.signedIn(get)) return Stream.never
		return cachedList(
			get,
			bookingsFile,
			Booking,
			pipe(
				Stream.unwrap(Effect.map(RpcClient, client => client('bookings.watch', undefined))),
				Stream.scan(Array.empty<Booking>, apply),
				Stream.drop(1)
			),
			session.reopening
		)
	})
)

const bookingFromClipboard = Effect.fnUntraced(function* (offer: ClipboardCopy) {
	if (offer.kind === 'image') {
		const copied = yield* Effect.tryPromise({
			catch: cause => BookingsError.make({cause, message: 'The copied screenshot could not be read.'}),
			try: () => Clipboard.getImageAsync({format: 'jpeg', jpegQuality: 0.85})
		})
		if (copied === null) return yield* BookingsError.make({message: 'The clipboard no longer holds an image.'})
		const image = yield* pipe(
			Schema.decodeEffect(Schema.Uint8ArrayFromBase64)(String.replace(/^data:[^,]*,/u, '')(copied.data)),
			Effect.mapError(cause => BookingsError.make({cause, message: 'The copied screenshot could not be read.'}))
		)
		if (image.byteLength === 0 || image.byteLength > IMAGE_BYTES) {
			return yield* BookingsError.make({message: 'Copy a screenshot smaller than 4 MB and try again.'})
		}
		return {image} satisfies BookingSource
	}
	const text = pipe(
		yield* Effect.tryPromise({
			catch: cause => BookingsError.make({cause, message: 'The copied text could not be read.'}),
			try: () => Clipboard.getStringAsync()
		}),
		String.trim,
		String.slice(0, 60_000)
	)
	if (String.isEmpty(text)) return yield* BookingsError.make({message: 'The clipboard no longer holds text.'})
	return {text} satisfies BookingSource
})

export const clipboard = makeClipboard({
	// A refused booking is answered, but a lost connection offers the same copy on the next return.
	answered: error => error._tag === 'BookingsError',
	detect: Effect.gen(function* () {
		if (yield* Effect.promise(() => Clipboard.hasImageAsync())) return Option.some<ClipboardKind>('image')
		if (yield* Effect.promise(() => Clipboard.hasStringAsync())) return Option.some<ClipboardKind>('text')
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
	save: (copy, get) =>
		Effect.gen(function* () {
			const source = yield* readClipboard(copy.count, bookingFromClipboard(copy))
			yield* Effect.provideContext(
				Effect.flatMap(RpcClient, client => client('bookings.save', source)),
				yield* get.result(RpcClient.runtime)
			)
		})
})

export const undoAtom = AtomMachine.make(
	Machine.make({
		events: Machine.events({Deleted: {booking: Booking}, Restored: {id: Schema.String}}),
		root: Machine.state({states: {Idle: {}, Offered: {fields: {booking: Booking}}}}),
		timers: {expire: '8 seconds'}
	}).handle({
		initial: {target: 'Idle'},
		states: {
			Idle: {on: {Deleted: {data: transition => ({booking: transition.event.booking}), target: 'Offered'}}},
			Offered: {
				invoke: {onDone: {target: 'Idle'}, src: 'expire'},
				on: {
					Deleted: {data: transition => ({booking: transition.event.booking}), reenter: true, target: 'Offered'},
					Restored: {guard: transition => transition.state.booking.id === transition.event.id, target: 'Idle'}
				}
			}
		}
	})
)

export const removeAtom = Atom.keepAlive(
	Atom.fn(
		(booking: Booking, get) =>
			pipe(
				withClient(
					get,
					Effect.flatMap(RpcClient, client => client('bookings.remove', {id: booking.id}))
				),
				Effect.tap(() => Effect.sync(() => get.set(undoAtom.send, {_tag: 'Deleted', booking}))),
				alert('Not Deleted')
			),
		// A second swipe deletes its booking too instead of interrupting the first.
		{concurrent: true}
	)
)

export const restoreAtom = Atom.keepAlive(
	Atom.fn((booking: Booking, get) =>
		pipe(
			withClient(
				get,
				Effect.flatMap(RpcClient, client => client('bookings.restore', booking))
			),
			Effect.tap(() => Effect.sync(() => get.set(undoAtom.send, {_tag: 'Restored', id: booking.id}))),
			alert('Not Restored')
		)
	)
)

export const refreshAtom = Atom.fn((id: Booking['id'], get) =>
	pipe(
		withClient(
			get,
			Effect.flatMap(RpcClient, client => client('bookings.refresh', {id}))
		),
		// Offline the call waits for a connection, and the pull spinner would never stop.
		Effect.timeoutOrElse({
			duration: '30 seconds',
			orElse: () => BookingsError.make({message: 'The server did not answer.'})
		}),
		alert('Not Refreshed')
	)
)

export const nowAtom = Atom.make(get => {
	get(activationsAtom)
	return Stream.map(Stream.tick('1 minute'), () => DateTime.toEpochMillis(DateTime.nowUnsafe()))
})
