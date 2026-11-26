import {Array, Option, Schema, String, Struct, pipe} from 'effect'

import {Rpc, RpcGroup} from 'effect/rpc'
import {Model} from 'effect/schema'

import {RpcAuth, User} from '@deslop/runtime/shared/auth'

const X_HOSTS = ['twitter.com', 'www.twitter.com', 'mobile.twitter.com', 'x.com', 'www.x.com', 'mobile.x.com']

const TRACKING_PARAMETERS = [
	'fbclid',
	'gclid',
	'igsh',
	'igshid',
	'mc_cid',
	'mc_eid',
	'si',
	'utm_campaign',
	'utm_content',
	'utm_id',
	'utm_medium',
	'utm_source',
	'utm_term'
]

export const URL_PATTERN = /https?:\/\/[^\s<>"]+/iu

export class NotesError extends Schema.TaggedError<NotesError>()('NotesError', {
	cause: Schema.optional(Schema.Defect()),
	message: Schema.String,
	// Invalid, TooLarge and Removed are final answers to a capture, so a sender never queues it again.
	reason: Schema.optional(Schema.Literals(['Unreachable', 'UnreadablePhoto', 'Invalid', 'TooLarge', 'Removed']))
}) {}

export type NoteId = typeof NoteId.Type
export const NoteId = pipe(Schema.String, Schema.check(Schema.isUUID()), Schema.brand('NoteId'))

export type TagName = typeof TagName.Type
export const TagName = pipe(Schema.NonEmptyString.check(Schema.isMaxLength(40)), Schema.brand('TagName'))

export type Source = typeof Source.Type
export const Source = Schema.Literals(['TikTok', 'X', 'Website', 'Note'])

export type Kind = typeof Kind.Type
export const Kind = Schema.Literals(['tiktok', 'x', 'youtube', 'web', 'note', 'file'])

export type ImageType = typeof ImageType.Type
export const ImageType = Schema.Literals(['image/jpeg', 'image/png', 'image/webp', 'image/gif'])

export type FileType = typeof FileType.Type
export const FileType = Schema.Literals(['image/jpeg', 'video/mp4', 'video/quicktime'])

// One row of `notes`, and what the server, the web and the phone know a note by: absent is `Option.none()` in code, NULL in the row and a missing key on the wire.
export class Note extends Model.Class<Note>('Note')({
	author: Model.FieldOption(Schema.String),
	body: Model.FieldOption(Schema.String),
	content: Schema.String,
	createdAt: Model.DateTimeInsertFromNumber,
	file: Model.FieldOption(FileType),
	// A capture brings the id its device made, so a retried upload saves one note.
	id: NoteId,
	image: Model.FieldOption(ImageType),
	issue: Model.FieldOption(Schema.String),
	// Whose AI keys organize the note, so a restart resumes it on their behalf; it never leaves the server.
	requester: Model.Sensitive(User.fields.id),
	screenText: Model.FieldOption(Schema.String),
	source: Source,
	status: Schema.Literals(['organizing', 'ready', 'failed']),
	summary: Schema.String,
	text: Schema.String,
	title: Schema.String,
	topics: Model.FieldOption(Schema.String),
	transcript: Model.FieldOption(Schema.String),
	url: Model.FieldOption(Schema.String)
}) {
	static readonly table = 'notes'
}

// What the list shows per note: the note without its long texts and requester, and its tags in the order the AI gave them.
export class NoteItem extends Model.Class<NoteItem>('NoteItem')({
	...Struct.omit(Model.fields(Note), ['body', 'content', 'requester', 'screenText', 'text', 'topics', 'transcript']),
	tags: Model.Field({json: Schema.Array(TagName), select: Schema.fromJsonString(Schema.Array(TagName))})
}) {}

type NotesEvent = typeof NotesEvent.Type
const NotesEvent = Schema.Struct({
	removed: Schema.Array(NoteId),
	reset: Schema.Boolean,
	upserted: Schema.Array(NoteItem.json)
})

export type Capture = typeof Capture.Type
export const Capture = Schema.Struct({id: NoteId, text: Schema.NonEmptyString.check(Schema.isMaxLength(20_000))})

export class RpcContracts extends RpcGroup.make(
	Rpc.make('notes.events', {error: NotesError, stream: true, success: NotesEvent}),
	Rpc.make('notes.body', {
		error: NotesError,
		payload: Schema.Struct({id: NoteId}),
		success: Schema.Struct(Struct.pick(Note.json.fields, ['body']))
	}),
	Rpc.make('notes.media', {error: NotesError, payload: Schema.Struct({id: NoteId}), success: Schema.Finite}),
	Rpc.make('notes.capture', {error: NotesError, payload: Capture, success: NoteItem.json}),
	Rpc.make('notes.regenerate', {error: NotesError, payload: Schema.Struct({id: NoteId})})
).middleware(RpcAuth) {}

function withoutTrailingPunctuation(link: string): string {
	const trimmed = String.replace(/[.,;:!?\]]+$/u, '')(link)
	if (String.endsWith(')')(trimmed) && String.split(trimmed, ')').length > String.split(trimmed, '(').length) {
		return withoutTrailingPunctuation(String.slice(0, -1)(trimmed))
	}
	return trimmed
}

// youtu.be, Shorts, live and embed links and the mobile site all name one video by its id.
function youTubeId(url: URL) {
	if (url.hostname === 'youtu.be') {
		return pipe(url.pathname, String.split('/'), Array.findFirst(String.isNonEmpty))
	}
	if (Option.isNone(String.match(/(?:^|\.)youtube\.com$/u)(url.hostname))) return Option.none<string>()
	return Option.orElse(Option.fromNullishOr(url.searchParams.get('v')), () =>
		Option.flatMap(String.match(/^\/(?:shorts|live|embed)\/([\w-]+)/u)(url.pathname), match => Array.get(match, 1))
	)
}

export function sourceOf(url: string) {
	const host = new URL(url).hostname
	if (Array.contains(X_HOSTS, host) || host === 't.co') return 'X'
	if (host === 'tiktok.com' || String.endsWith('.tiktok.com')(host)) return 'TikTok'
	return 'Website'
}

function withoutTracking(link: string) {
	const url = new URL(link)
	if (Array.contains(X_HOSTS, url.hostname)) url.hostname = 'x.com'
	if (sourceOf(url.href) === 'Website') {
		for (const key of TRACKING_PARAMETERS) url.searchParams.delete(key)
	} else {
		url.search = ''
	}
	url.hash = ''
	return url.href
}

function canonicalUrl(link: string) {
	return Option.match(youTubeId(new URL(link)), {
		onNone: () => withoutTracking(link),
		onSome: id => `https://www.youtube.com/watch?v=${id}`
	})
}

export function captureUrl(text: string) {
	return pipe(
		String.match(URL_PATTERN)(text),
		Option.flatMap(Array.head),
		Option.map(withoutTrailingPunctuation),
		Option.flatMap(Option.liftThrowable(canonicalUrl)),
		Option.getOrUndefined
	)
}

export function canonical(url: URL) {
	return captureUrl(url.href) ?? url.href
}

export function isYouTube(url: string) {
	return Option.isSome(String.match(/(?:^|\.)(?:youtube\.com|youtu\.be)$/u)(new URL(url).hostname))
}
