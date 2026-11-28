import {promisify} from 'node:util'
import {inflateRaw} from 'node:zlib'

import {Array, Effect, Function, Match, Number, Option, Schema, pipe} from 'effect'

import {FlightsError} from './contract.ts'

const MAX_PASS_BYTES = 240_000
const inflate = promisify(inflateRaw)

// Wallet archives use the central directory: local headers may leave sizes in a trailing data descriptor.
function passBytes(bytes: Uint8Array) {
	return Effect.gen(function* () {
		const zip = Buffer.from(bytes)
		if (zip.length < 22) return yield* FlightsError.make({message: 'The Wallet pass is not a ZIP archive.'})
		const end = yield* pipe(
			zip.length - 21,
			Number.min(65_536),
			Array.makeBy(index => zip.length - 22 - index),
			Array.findFirst(
				offset =>
					zip.readUInt32LE(offset) === 0x06_05_4b_50 && offset + 22 + zip.readUInt16LE(offset + 20) === zip.length
			),
			Effect.fromOption,
			Effect.mapError(() => FlightsError.make({message: 'The Wallet pass is not a ZIP archive.'}))
		)
		if (zip.readUInt16LE(end + 4) !== 0 || zip.readUInt16LE(end + 6) !== 0) {
			return yield* FlightsError.make({message: 'The Wallet pass spans multiple archives.'})
		}
		const directoryStart = zip.readUInt32LE(end + 16)
		const directoryEnd = directoryStart + zip.readUInt32LE(end + 12)
		if (directoryEnd > end) return yield* FlightsError.make({message: 'The Wallet pass directory is invalid.'})
		const count = zip.readUInt16LE(end + 10)
		if (count === 0) return yield* FlightsError.make({message: 'The Wallet pass has no pass.json.'})
		const directory = yield* pipe(
			count,
			Array.makeBy(Function.identity),
			Effect.reduce(
				() => ({offset: directoryStart, pass: Option.none<number>()}),
				entry =>
					Effect.gen(function* () {
						const offset = entry.offset
						if (offset + 46 > directoryEnd || zip.readUInt32LE(offset) !== 0x02_01_4b_50) {
							return yield* FlightsError.make({message: 'The Wallet pass directory is invalid.'})
						}
						const nameLength = zip.readUInt16LE(offset + 28)
						const next = offset + 46 + nameLength + zip.readUInt16LE(offset + 30) + zip.readUInt16LE(offset + 32)
						if (next > directoryEnd) {
							return yield* FlightsError.make({message: 'The Wallet pass directory is invalid.'})
						}
						return {
							offset: next,
							pass: Option.orElse(entry.pass, () =>
								Option.liftPredicate(
									offset,
									candidate => zip.toString('utf8', candidate + 46, candidate + 46 + nameLength) === 'pass.json'
								)
							)
						}
					})
			)
		)
		const offset = yield* pipe(
			directory.pass,
			Effect.fromOption,
			Effect.mapError(() => FlightsError.make({message: 'The Wallet pass has no pass.json.'}))
		)
		const method = zip.readUInt16LE(offset + 10)
		const compressed = zip.readUInt32LE(offset + 20)
		const size = zip.readUInt32LE(offset + 24)
		const local = zip.readUInt32LE(offset + 42)
		if ((zip.readUInt16LE(offset + 8) & 1) !== 0 || size > MAX_PASS_BYTES) {
			return yield* FlightsError.make({message: 'The Wallet pass is encrypted or too large.'})
		}
		if (local + 30 > directoryStart || zip.readUInt32LE(local) !== 0x04_03_4b_50) {
			return yield* FlightsError.make({message: 'The Wallet pass file header is invalid.'})
		}
		const start = local + 30 + zip.readUInt16LE(local + 26) + zip.readUInt16LE(local + 28)
		if (start + compressed > directoryStart) {
			return yield* FlightsError.make({message: 'The Wallet pass file is truncated.'})
		}
		const encoded = zip.subarray(start, start + compressed)
		const decoded = yield* pipe(
			Match.value(method),
			Match.when(0, () => Effect.succeed(encoded)),
			Match.when(8, () =>
				Effect.tryPromise({
					catch: cause => FlightsError.make({cause, message: 'The Wallet pass could not be inflated.'}),
					try: () => inflate(encoded, {maxOutputLength: MAX_PASS_BYTES})
				})
			),
			Match.orElse(() => FlightsError.make({message: 'The Wallet pass compression is unsupported.'}))
		)
		if (decoded.length !== size) return yield* FlightsError.make({message: 'The Wallet pass file size is invalid.'})
		return decoded
	})
}

export const passText = Effect.fn('Flights.passText')(function* (bytes: Uint8Array) {
	const text = (yield* passBytes(bytes)).toString('utf8')
	yield* pipe(
		text,
		Schema.decodeEffect(Schema.fromJsonString(Schema.Record(Schema.String, Schema.Json))),
		Effect.mapError(cause => FlightsError.make({cause, message: 'The Wallet pass JSON could not be read.'}))
	)
	return text
})
