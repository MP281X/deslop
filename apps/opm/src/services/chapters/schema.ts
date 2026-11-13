import {DateTime, Option, Schema, SchemaGetter, pipe} from 'effect'

import {Model} from 'effect/schema'

import {DateTimeUtcFromFiniteMillis, DateTimeUtcFromFiniteSeconds} from '@deslop/runtime/shared/time'

export type ChapterNumber = typeof ChapterNumber.Type
export const ChapterNumber = pipe(Schema.Finite, Schema.brand('ChapterNumber'))

export type ChapterKey = typeof ChapterKey.Type
export const ChapterKey = pipe(Schema.String, Schema.brand('ChapterKey'))

export type PostedAt = typeof PostedAt.Type
// The index sends zero for an unknown publication time; it is absence only at this boundary.
export const PostedAt = pipe(
	Schema.Finite,
	Schema.decodeTo(Schema.Option(Schema.DateTimeUtc), {
		decode: SchemaGetter.transform(millis =>
			pipe(
				DateTime.makeUnsafe(0),
				DateTime.mapEpochMillis(() => millis),
				Option.liftPredicate(() => millis !== 0)
			)
		),
		encode: SchemaGetter.transform(Option.match({onNone: () => 0, onSome: DateTime.toEpochMillis}))
	})
)

export class ChaptersError extends Schema.TaggedError<ChaptersError>()('ChaptersError', {
	cause: Schema.optional(Schema.Defect()),
	message: Schema.String
}) {}

// How far the one reader got in a chapter.
export type Reading = typeof Reading.Type
export const Reading = Schema.Struct({done: Schema.Boolean, page: Schema.Finite})

export type Series = typeof Series.Type
export const Series = Schema.Literals(['manga', 'webcomic'])

export type ChapterPath = typeof ChapterPath.Type
export const ChapterPath = Schema.TemplateLiteralParser([
	Series,
	':',
	pipe(Schema.FiniteFromString, Schema.decodeTo(ChapterNumber))
])

// The server's own bookkeeping, which never reaches the iPhone.
const serverOnly = Model.FieldOnly(['select', 'insert', 'update'])

// One row of `chapters`: a fetched chapter, kept because Reddit's feeds show only recent posts and a reader's page must stay on the translation it started; with the one reader's place in it.
export class Chapter extends Model.Class<Chapter>('Chapter')({
	// Set once every registered iPhone has been told, or when the chapter arrived before anyone could be.
	notified: serverOnly(Schema.BooleanFromBit),
	// Extras between two chapters carry a half number, such as 8.5.
	number: ChapterNumber,
	pages: Model.JsonFromString(Schema.Array(Schema.String)),
	postedAt: PostedAt,
	reading: Model.FieldOption(Model.JsonFromString(Reading)),
	// When the revision that supplied the current pages was posted; only a later revision replaces them.
	revisedAt: Model.FieldOption(serverOnly(DateTimeUtcFromFiniteMillis)),
	series: Series,
	// The reader link the pages came from, so a revision that links it again is not read.
	source: serverOnly(Schema.String),
	title: Schema.String
}) {
	static readonly table = 'chapters'
}

// A chapter as the iPhone sees it; the whole list with its page links is a few hundred kilobytes.
export type ChapterItem = typeof Chapter.json.Type

export type ChapterList = readonly ChapterItem[]

// The whole list once per connection, then only the chapters that changed, such as the one being read.
export type ChaptersEvent = typeof ChaptersEvent.Type
export const ChaptersEvent = Schema.Struct({reset: Schema.Boolean, upserted: Schema.Array(Chapter.json)})

export type ReadingUpdate = typeof ReadingUpdate.Type
export const ReadingUpdate = Schema.Struct({
	done: Schema.Boolean,
	number: ChapterNumber,
	page: Schema.Finite,
	series: Series
})

export type ChapterNotification = typeof ChapterNotification.Type
export const ChapterNotification = Schema.Struct({path: ChapterPath})

export type PushToken = typeof PushToken.Type
export const PushToken = pipe(
	Schema.String.check(Schema.isPattern(/^Expo(?:nent)?PushToken\[[\w-]{10,64}\]$/u)),
	Schema.brand('PushToken')
)

// One row of `devices`, and what the iPhone registers: the Expo token new chapters are announced to.
export class Device extends Model.Class<Device>('Device')({
	// A push token is a secret: it never leaves the server and prints redacted.
	token: Model.Sensitive(Schema.RedactedFromValue(PushToken))
}) {
	static readonly table = 'devices'
}

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

// A reader link that answered 404 for its chapter; the sync skips it until the chapter gains another link, and asks again after a restart.
export type DeadLink = typeof DeadLink.Type
export const DeadLink = Schema.Struct({key: ChapterKey, link: Schema.String})

// Expo's answer to a push batch, one ticket per message in order.
export type PushTickets = typeof PushTickets.Type
export const PushTickets = Schema.Struct({
	data: Schema.Array(
		Schema.Struct({
			details: Schema.OptionFromOptionalKey(Schema.Struct({error: Schema.OptionFromOptionalKey(Schema.String)})),
			status: Schema.Literals(['ok', 'error'])
		})
	)
})
