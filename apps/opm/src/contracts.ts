import {Order, Schema, SchemaTransformation, pipe} from 'effect'

import {Rpc, RpcGroup} from 'effect/rpc'
import {Model} from 'effect/schema'

import {Device} from '@deslop/runtime/shared/apns'
import {RpcAuth} from '@deslop/runtime/shared/auth'
import {DateTimeUtcFromFiniteMillis} from '@deslop/runtime/shared/time'

export type ChapterNumber = typeof ChapterNumber.Type
export const ChapterNumber = pipe(Schema.Finite, Schema.brand('ChapterNumber'))

export type ChapterNumberFromString = typeof ChapterNumberFromString.Type
// A chapter number as a source writes it, digits with an optional decimal part, so "NaN", "Infinity" or "1e12" names no chapter.
export const ChapterNumberFromString = pipe(
	Schema.String.check(Schema.isPattern(/^\d+(?:\.\d+)?$/u)),
	Schema.decodeTo(ChapterNumber, SchemaTransformation.numberFromString)
)

export type ChapterKey = typeof ChapterKey.Type
export const ChapterKey = pipe(Schema.String, Schema.brand('ChapterKey'))

export class ChaptersError extends Schema.TaggedError<ChaptersError>()('ChaptersError', {
	cause: Schema.optional(Schema.Defect()),
	message: Schema.String
}) {}

export type Series = typeof Series.Type
export const Series = Schema.Literals(['manga', 'webcomic'])

export type ChapterIdentity = typeof ChapterIdentity.Type
export const ChapterIdentity = Schema.Struct({number: ChapterNumber, series: Series})

export const byChapterNumber = Order.mapInput(
	Order.Number,
	(chapter: Pick<ChapterIdentity, 'number'>) => chapter.number
)

export function keyOf(chapter: ChapterIdentity) {
	return ChapterKey.make(`${chapter.series}:${chapter.number}`)
}

export const SERIES_NAMES = {manga: 'Manga', webcomic: 'Webcomic'}

export class ReadingError extends Schema.TaggedError<ReadingError>()('ReadingError', {
	cause: Schema.optional(Schema.Defect()),
	message: Schema.String
}) {}

export class ReadingPosition extends Model.Class<ReadingPosition>('ReadingPosition')({
	done: Schema.BooleanFromBit,
	number: ChapterNumber,
	page: Schema.Natural,
	series: Series
}) {
	static readonly table = 'reading'
}

export type Position = typeof Position.Type
export const Position = Schema.Struct({done: Schema.Boolean, page: Schema.Natural})

export type ReadingChapter = typeof ReadingChapter.Type
// The iPhone's list joins the catalogue with its saved place, without making progress part of a catalogue row.
export const ReadingChapter = Schema.Struct({
	...ChapterIdentity.fields,
	pages: Schema.Array(Schema.String),
	postedAt: Schema.OptionFromOptionalKey(DateTimeUtcFromFiniteMillis),
	reading: Schema.OptionFromOptionalKey(Position),
	title: Schema.String
})

export type ChapterList = readonly ReadingChapter[]

type ChaptersEvent = typeof ChaptersEvent.Type
const ChaptersEvent = Schema.Struct({reset: Schema.Boolean, upserted: Schema.Array(ReadingChapter)})

export type ChapterBundle = typeof ChapterBundle.Type
export const ChapterBundle = Schema.Literals(['xyz.mp281x.opm', 'xyz.mp281x.opm.dev'])

export class ChapterPushError extends Schema.TaggedError<ChapterPushError>()('PushError', {
	cause: Schema.optional(Schema.Defect()),
	message: Schema.String
}) {}

export const ChapterRpcs = RpcGroup.make(
	Rpc.make('chapters.events', {error: ChaptersError, stream: true, success: ChaptersEvent}),
	Rpc.make('chapters.write', {error: ReadingError, payload: ReadingPosition.json})
)

export const PushRpcs = RpcGroup.make(
	Rpc.make('push.register', {
		error: ChapterPushError,
		payload: Device.insert.mapFields(fields => ({...fields, bundle: ChapterBundle, kind: Schema.Literal('start')}))
	})
)

export const RpcContracts = ChapterRpcs.merge(PushRpcs).middleware(RpcAuth)
