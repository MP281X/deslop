import {Schema, Struct, pipe} from 'effect'

import {Model} from 'effect/schema'

import {User} from '@deslop/runtime/shared/auth'
import {DateTimeUtcFromFiniteSeconds} from '@deslop/runtime/shared/time'

export class NotesError extends Schema.TaggedError<NotesError>()('NotesError', {
	cause: Schema.optional(Schema.Defect()),
	message: Schema.String,
	reason: Schema.optional(Schema.Literals(['Unreachable', 'UnreadablePhoto']))
}) {}

export type NoteId = typeof NoteId.Type
export const NoteId = pipe(Schema.String, Schema.check(Schema.isUUID()), Schema.brand('NoteId'))

export type TagName = typeof TagName.Type
export const TagName = pipe(Schema.NonEmptyString.check(Schema.isMaxLength(40)), Schema.brand('TagName'))

export type PostId = typeof PostId.Type
export const PostId = pipe(Schema.String, Schema.brand('PostId'))
export type PostAuthorId = typeof PostAuthorId.Type
export const PostAuthorId = pipe(Schema.String, Schema.brand('PostAuthorId'))

// A tag and what belongs under it, as the AI defines it.
export type TagDefinition = typeof TagDefinition.Type
export const TagDefinition = Schema.Struct({
	definition: Schema.NonEmptyString.check(Schema.isMaxLength(240)),
	tag: TagName
})

export type Source = typeof Source.Type
export const Source = Schema.Literals(['TikTok', 'X', 'Website', 'Note'])

export type Kind = typeof Kind.Type
export const Kind = Schema.Literals(['tiktok', 'x', 'youtube', 'web', 'note', 'file'])

export type Brand = typeof Brand.Type
export const Brand = Kind.pick(['tiktok', 'x', 'youtube'])

export type ImageType = typeof ImageType.Type
export const ImageType = Schema.Literals(['image/jpeg', 'image/png', 'image/webp', 'image/gif'])

export type Image = typeof Image.Type
export const Image = Schema.Struct({bytes: Schema.Uint8Array, type: ImageType})

export type Picture = typeof Picture.Type
export const Picture = Schema.Struct({...Image.fields, label: Schema.String})

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

// A tag and what belongs under it, so the AI reuses tags by meaning; the definition is the first one the tag was given.
export class Tag extends Model.Class<Tag>('Tag')({
	definition: Model.FieldOption(TagDefinition.fields.definition),
	name: TagName
}) {
	static readonly table = 'tags'
}

// A note's tag, at the place the AI gave it.
export class NoteTag extends Model.Class<NoteTag>('NoteTag')({noteId: NoteId, position: Schema.Int, tag: TagName}) {
	static readonly table = 'note_tags'
}

// What the list shows per note: the note without its long texts and requester, and its tags in the order the AI gave them.
export class NoteItem extends Model.Class<NoteItem>('NoteItem')({
	...Struct.omit(Model.fields(Note), ['body', 'content', 'requester', 'screenText', 'text', 'transcript']),
	tags: Model.Field({json: Schema.Array(TagName), select: Schema.fromJsonString(Schema.Array(TagName))})
}) {}

export type NotesEvent = typeof NotesEvent.Type
export const NotesEvent = Schema.Struct({
	removed: Schema.Array(NoteId),
	reset: Schema.Boolean,
	upserted: Schema.Array(NoteItem.json)
})

// Where a page of notes, newest first, continues.
export type NotesCursor = typeof NotesCursor.Type
export const NotesCursor = Schema.Struct(Struct.pick(Note.json.fields, ['createdAt', 'id']))

export type Capture = typeof Capture.Type
export const Capture = Schema.Struct({id: NoteId, text: Schema.NonEmptyString.check(Schema.isMaxLength(20_000))})

export type Extraction = typeof Extraction.Type
export const Extraction = Schema.Struct({
	author: Schema.Option(Schema.String),
	image: Schema.Option(Schema.String),
	slides: Schema.OptionFromOptionalKey(Schema.Array(Schema.String)),
	text: Schema.String,
	title: Schema.String,
	url: Schema.String,
	video: Schema.OptionFromOptionalKey(Schema.String)
})

// A tag in use and how many notes carry it, so the AI reuses tags by meaning instead of by name.
export type TagEntry = typeof TagEntry.Type
export const TagEntry = Schema.Struct({...Tag.fields, count: Schema.Int})

export type Organization = typeof Organization.Type
export const Organization = Schema.Struct({
	body: Schema.String.check(Schema.isMaxLength(40_000)),
	definitions: Schema.Array(TagDefinition),
	screenText: Schema.String,
	summary: Schema.String.check(Schema.isMaxLength(400)),
	tags: Schema.Array(TagName).check(Schema.isMinLength(1), Schema.isMaxLength(3)),
	title: Schema.NonEmptyString.check(Schema.isMaxLength(90)),
	topics: Schema.String.check(Schema.isMaxLength(1000))
})

export type FxArticle = typeof FxArticle.Type
export const FxArticle = Schema.Struct({
	content: Schema.Struct({
		blocks: Schema.Array(
			Schema.Struct({
				entityRanges: Schema.Array(Schema.Struct({key: Schema.Finite})),
				text: Schema.String,
				type: Schema.String
			})
		),
		entityMap: Schema.Array(
			Schema.Struct({
				key: Schema.String,
				value: Schema.Struct({
					data: Schema.Struct({
						markdown: Schema.OptionFromOptionalKey(Schema.String),
						url: Schema.OptionFromOptionalKey(Schema.String)
					}),
					type: Schema.String
				})
			})
		)
	}),
	media_entities: Schema.OptionFromOptionalKey(
		Schema.Array(
			Schema.Struct({media_info: Schema.Struct({original_img_url: Schema.OptionFromOptionalKey(Schema.String)})})
		)
	),
	title: Schema.String
})

export type FxPost = typeof FxPost.Type
export const FxPost = Schema.Struct({
	article: Schema.OptionFromOptionalKey(FxArticle),
	author: Schema.Struct({id: PostAuthorId, name: Schema.String, screen_name: Schema.String}),
	created_timestamp: DateTimeUtcFromFiniteSeconds,
	id: PostId,
	likes: Schema.OptionFromOptionalKey(Schema.Finite),
	media: Schema.OptionFromOptionalKey(
		Schema.Struct({
			all: Schema.OptionFromOptionalKey(
				Schema.Array(
					Schema.Struct({
						thumbnail_url: Schema.OptionFromOptionalKey(Schema.String),
						type: Schema.String,
						url: Schema.String
					})
				)
			)
		})
	),
	raw_text: Schema.OptionFromOptionalKey(
		Schema.Struct({facets: Schema.Array(Schema.Struct({replacement: Schema.OptionFromOptionalKey(Schema.String)}))})
	),
	replying_to: Schema.OptionFromOptionalKey(
		Schema.OptionFromNullOr(Schema.Struct({status: Schema.OptionFromOptionalKey(Schema.OptionFromNullOr(PostId))}))
	),
	text: Schema.String
})

export type FxStatus = typeof FxStatus.Type
export const FxStatus = Schema.Struct({
	status: Schema.Struct({...FxPost.fields, quote: Schema.OptionFromOptionalKey(FxPost)})
})

// `thread` holds the posts above the saved one and the saved post itself; `replies` holds the posts below it.
export type FxConversation = typeof FxConversation.Type
export const FxConversation = Schema.Struct({
	...FxStatus.fields,
	replies: Schema.OptionFromOptionalKey(Schema.Array(FxPost)),
	thread: Schema.OptionFromOptionalKey(Schema.Array(FxPost))
})

export type OEmbed = typeof OEmbed.Type
export const OEmbed = Schema.Struct({
	author_name: Schema.OptionFromOptionalKey(Schema.String),
	html: Schema.OptionFromOptionalKey(Schema.String),
	thumbnail_url: Schema.OptionFromOptionalKey(Schema.String),
	title: Schema.OptionFromOptionalKey(Schema.String)
})

export type TikTokPage = typeof TikTokPage.Type
export const TikTokPage = Schema.Struct({
	__DEFAULT_SCOPE__: Schema.Struct({
		'webapp.video-detail': Schema.Struct({
			itemInfo: Schema.Struct({
				itemStruct: Schema.Struct({
					author: Schema.Struct({nickname: Schema.String}),
					desc: Schema.String,
					imagePost: Schema.Struct({
						images: Schema.Array(Schema.Struct({imageURL: Schema.Struct({urlList: Schema.Array(Schema.String)})})),
						title: Schema.OptionFromOptionalKey(Schema.String)
					})
				})
			})
		})
	})
})

export type GitHubRepo = typeof GitHubRepo.Type
export const GitHubRepo = Schema.Struct({
	description: Schema.OptionFromNullOr(Schema.String),
	full_name: Schema.String,
	homepage: Schema.OptionFromOptionalKey(Schema.OptionFromNullOr(Schema.String)),
	owner: Schema.Struct({login: Schema.String}),
	topics: Schema.OptionFromOptionalKey(Schema.Array(Schema.String))
})

export type GitHubComment = typeof GitHubComment.Type
export const GitHubComment = Schema.Struct({
	body: Schema.OptionFromNullOr(Schema.String),
	user: Schema.Struct({login: Schema.String})
})

export type GitHubIssue = typeof GitHubIssue.Type
export const GitHubIssue = Schema.Struct({...GitHubComment.fields, state: Schema.String, title: Schema.String})

export type GitHubReadme = typeof GitHubReadme.Type
export const GitHubReadme = Schema.Struct({download_url: Schema.String})

export type Reader = typeof Reader.Type
export const Reader = Schema.Struct({data: Schema.Struct({content: Schema.String, title: Schema.String})})
