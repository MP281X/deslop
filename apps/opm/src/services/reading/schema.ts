import {Schema, Struct} from 'effect'

import {Model} from 'effect/schema'

import {Chapter, ChapterNumber, Series} from '#services/chapters/schema.ts'

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

type Position = typeof Position.Type
const Position = Schema.Struct({...Struct.pick(ReadingPosition.json.fields, ['done', 'page']), done: Schema.Boolean})

// The iPhone's list joins the catalogue with its saved place, without making progress part of a catalogue row.
export class ReadingChapter extends Model.Class<ReadingChapter>('ReadingChapter')({
	...Model.fields(Chapter),
	reading: Model.Field({
		json: Schema.OptionFromOptionalKey(Position),
		select: Schema.OptionFromNullOr(Schema.fromJsonString(Position))
	})
}) {}

export type ChapterItem = typeof ReadingChapter.json.Type
export type ChapterList = readonly ChapterItem[]

export type ChaptersEvent = typeof ChaptersEvent.Type
export const ChaptersEvent = Schema.Struct({reset: Schema.Boolean, upserted: Schema.Array(ReadingChapter.json)})
