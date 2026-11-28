import {Order, Schema, SchemaTransformation, Struct, pipe} from 'effect'

import {Rpc, RpcGroup} from 'effect/rpc'
import {Model} from 'effect/schema'

import {DateTimeUtcFromFiniteMillis, DateTimeUtcFromFiniteSeconds} from '@deslop/runtime/shared/time'

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

export const ChaptersRpcs = RpcGroup.make(
	Rpc.make('chapters.events', {error: ChaptersError, stream: true, success: ChaptersEvent}),
	Rpc.make('chapters.write', {error: ReadingError, payload: ReadingPosition.json})
)

// One row of `chapters`: catalogue and provenance. Reading progress lives in its own table.
export class Chapter extends Model.Class<Chapter>('Chapter')({
	// Set once every iPhone registered when the chapter was saved has been told, or when the chapter arrived before anyone could be.
	notified: Schema.BooleanFromBit,
	...ChapterIdentity.fields,
	pages: Model.JsonFromString(Schema.Array(Schema.String)),
	postedAt: Model.FieldOption(DateTimeUtcFromFiniteMillis),
	// When the revision that supplied the current pages was posted; only a later revision replaces them.
	revisedAt: Model.FieldOption(DateTimeUtcFromFiniteMillis),
	// The reader link the pages came from, so a revision that links it again is not read.
	source: Schema.String,
	title: Schema.String
}) {
	static readonly table = 'chapters'
}

// What discovery compares a source against: a chapter without its pages, so a round does not read every page list.
export type ChapterState = typeof ChapterState.Type
export const ChapterState = Chapter.select.mapFields(
	Struct.pick(['notified', 'number', 'postedAt', 'revisedAt', 'series', 'source'])
)

// The catalogue as the iPhone sees it, read apart from reading progress so a page turn does not decode every page list again.
export const CatalogueRow = Chapter.select.mapFields(Struct.pick(['number', 'pages', 'postedAt', 'series', 'title']))

// A cubari series answer: imgur pages are objects, every other source's pages are links.
export type CubariSeries = typeof CubariSeries.Type
export const CubariSeries = Schema.Struct({
	chapters: Schema.Record(
		Schema.String,
		Schema.Struct({
			groups: Schema.Record(
				Schema.String,
				Schema.Array(Schema.Union([Schema.String, Schema.Struct({src: Schema.String})]))
			),
			release_date: Schema.OptionFromOptionalKey(Schema.Record(Schema.String, DateTimeUtcFromFiniteSeconds)),
			// imgchest albums without a name answer null.
			title: Schema.OptionFromOptionalKey(Schema.OptionFromNullOr(Schema.String))
		})
	)
})

export type Post = typeof Post.Type
export const Post = Schema.Struct({
	links: Schema.NonEmptyArray(Schema.String),
	number: ChapterNumber,
	postedAt: DateTimeUtcFromFiniteMillis,
	revised: Schema.Boolean,
	series: Series
})

// A reader link that answered 404 for its chapter, and when; skipped for a while as long as the discovery posts still reference it.
export type DeadLink = typeof DeadLink.Type
export const DeadLink = Schema.Struct({at: Schema.DateTimeUtc, key: ChapterKey, link: Schema.String})
