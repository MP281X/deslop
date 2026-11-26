import {Schema, Struct} from 'effect'

import {Model} from 'effect/schema'

import {DateTimeUtcFromFiniteMillis, DateTimeUtcFromFiniteSeconds} from '@deslop/runtime/shared/time'

import {ChapterIdentity, ChapterKey, ChapterNumber, Series} from '#contracts'

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
