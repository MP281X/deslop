import {UiSchema} from '@effect/ui'

import {Schema} from 'effect'

import {AsyncResult} from 'effect/reactivity'

import {Account} from '@deslop/runtime/shared/schema'
import {DateTimeUtcFromFiniteMillis} from '@deslop/runtime/shared/time'

import {ChapterIdentity, ChapterKey, ChapterNumber, Position, ReadingChapter, Series} from '#contracts'

import {OpmRoute} from '#screens/routes.ts'

const CatalogueRead = AsyncResult.Schema({error: Schema.Unknown, success: Schema.Array(ReadingChapter)})
const AccountRead = AsyncResult.Schema({error: Schema.Unknown, success: Account})
const Press = {pointerId: Schema.Int, x: Schema.Finite, y: Schema.Finite}

export type Step = typeof Step.Type
const Step = Schema.Literals([-1, 1])

export type Reader = typeof Reader.Type
const Reader = Schema.Struct({
	bars: Schema.Boolean,
	expired: Schema.Boolean,
	finished: Schema.HashSet(ChapterNumber),
	inView: Schema.Option(ChapterNumber),
	page: Schema.UndefinedOr(Schema.Natural),
	press: Schema.UndefinedOr(Schema.Struct(Press)),
	strip: Schema.Array(ReadingChapter)
})

export type Model = typeof Model.Type
export const Model = Schema.Struct({
	account: AccountRead,
	authProblem: Schema.UndefinedOr(Schema.String),
	busy: Schema.Boolean,
	canBack: Schema.Boolean,
	catalogue: CatalogueRead,
	failed: Schema.HashSet(Schema.String),
	height: Schema.Finite,
	listHidden: Schema.Boolean,
	now: DateTimeUtcFromFiniteMillis,
	reader: Schema.UndefinedOr(Reader),
	route: OpmRoute,
	unsaved: Schema.HashMap(ChapterKey, Position),
	width: Schema.Finite,
	shapes: Schema.HashMap(Schema.String, Schema.Finite)
})

export type Message = typeof Message.Type
export const Message = UiSchema.TaggedEnum({
	Account: {account: AccountRead},
	AuthDone: {problem: Schema.UndefinedOr(Schema.String)},
	Catalogue: {catalogue: CatalogueRead},
	Clock: {now: DateTimeUtcFromFiniteMillis},
	Close: {},
	Expired: {chapter: ChapterIdentity},
	Gesture: {dx: Schema.Finite, dy: Schema.Finite},
	Image: {aspect: Schema.Finite, src: Schema.String},
	Layout: {height: Schema.Finite, width: Schema.Finite},
	Move: {step: Step},
	Open: {chapter: ChapterIdentity},
	PointerCancel: {pointerId: Press.pointerId},
	PointerDown: Press,
	PointerUp: Press,
	Retry: {},
	RetryPage: {src: Schema.String},
	Route: {route: OpmRoute},
	Series: {series: Series},
	Sidebar: {},
	SignIn: {},
	SignOut: {},
	Unsaved: {unsaved: Model.fields.unsaved}
})
