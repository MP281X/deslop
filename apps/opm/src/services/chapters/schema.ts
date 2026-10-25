import {Effect, Schema, Struct, pipe} from 'effect'

export class ChaptersError extends Schema.TaggedError<ChaptersError>()('ChaptersError', {
	cause: Schema.optional(Schema.Defect()),
	message: Schema.String
}) {}

// How far the one reader got in a chapter; `at` orders chapters by when they were last read.
export type Reading = typeof Reading.Type
export const Reading = Schema.Struct({at: Schema.Finite, done: Schema.Boolean, page: Schema.Finite})

export type Series = typeof Series.Type
export const Series = Schema.Literals(['manga', 'webcomic'])

export type ChapterPath = typeof ChapterPath.Type
export const ChapterPath = Schema.TemplateLiteralParser([Series, ':', Schema.FiniteFromString])

export type Chapter = typeof Chapter.Type
export const Chapter = Schema.Struct({
	// Set once every registered iPhone has been told, or when the chapter arrived before anyone could be.
	notified: Schema.Boolean,
	// Extras between two chapters carry a half number, such as 8.5.
	number: Schema.Finite,
	pages: Schema.Array(Schema.String),
	postedAt: Schema.Finite,
	reading: Schema.optionalKey(Reading),
	// When the revision that supplied the current pages was posted; only a later revision replaces them.
	revisedAt: Schema.optionalKey(Schema.Finite),
	// The previous release stored manga only, on the server and in the iPhone's cache.
	series: pipe(Series, Schema.withDecodingDefaultKey(Effect.succeed('manga'))),
	// The cubari reader link the pages came from; a revision of the same chapter replaces it.
	source: Schema.String,
	// The chapter's name where the source has one, such as "Fury"; empty otherwise.
	title: Schema.String
})

// A chapter as the iPhone sees it; the whole list with its page links is a few hundred kilobytes.
export type ChapterItem = typeof ChapterItem.Type
export const ChapterItem = Chapter.mapFields(Struct.omit(['notified']))

export type ChapterList = typeof ChapterList.Type
export const ChapterList = Schema.Array(ChapterItem)

// The whole list once per connection, then only the chapters that changed, such as the one being read.
export type ChaptersEvent = typeof ChaptersEvent.Type
export const ChaptersEvent = Schema.Struct({reset: Schema.Boolean, upserted: ChapterList})

export type ReadingUpdate = typeof ReadingUpdate.Type
export const ReadingUpdate = Schema.Struct({
	done: Schema.Boolean,
	number: Schema.Finite,
	opened: Schema.Boolean,
	page: Schema.Finite,
	series: Series
})

export type ChapterNotification = typeof ChapterNotification.Type
export const ChapterNotification = Schema.Struct({path: ChapterPath})

export type MangaNotification = typeof MangaNotification.Type
// Chapter-only notifications already delivered by the previous release always refer to manga.
export const MangaNotification = Schema.Struct({chapter: Schema.Finite})

export type PushToken = typeof PushToken.Type
export const PushToken = Schema.String.check(Schema.isPattern(/^Expo(?:nent)?PushToken\[[\w-]{10,64}\]$/u))

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
			release_date: Schema.optionalKey(Schema.Record(Schema.String, Schema.Finite)),
			title: Schema.optionalKey(Schema.String)
		})
	)
})

// One Reddit post that links a chapter translation.
export type Post = typeof Post.Type
export const Post = Schema.Struct({
	link: Schema.String,
	number: Schema.Finite,
	postedAt: Schema.Finite,
	revised: Schema.Boolean,
	series: Series
})

// Expo's answer to a push batch, one ticket per message in order.
export type PushTickets = typeof PushTickets.Type
export const PushTickets = Schema.Struct({
	data: Schema.Array(
		Schema.Struct({
			details: Schema.optionalKey(Schema.Struct({error: Schema.optionalKey(Schema.String)})),
			status: Schema.Literals(['ok', 'error'])
		})
	)
})
