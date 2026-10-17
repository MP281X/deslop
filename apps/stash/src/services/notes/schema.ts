import {Schema, Struct, pipe} from 'effect'

export class NotesError extends Schema.TaggedError<NotesError>()('NotesError', {
	cause: Schema.optional(Schema.Defect()),
	message: Schema.String
}) {}

export type NoteId = typeof NoteId.Type
export const NoteId = pipe(Schema.String, Schema.check(Schema.isUUID()))

export type Tag = typeof Tag.Type
export const Tag = pipe(Schema.String, Schema.check(Schema.isMinLength(1), Schema.isMaxLength(40)))

export type Source = typeof Source.Type
export const Source = Schema.Literals(['TikTok', 'X', 'Website', 'Note'])

// What the list filters by, in menu order.
export type Kind = typeof Kind.Type
export const Kind = Schema.Literals(['tiktok', 'x', 'youtube', 'web', 'note', 'file'])

// The kinds whose app has a logo.
export type Brand = typeof Brand.Type
export const Brand = Kind.pick(['tiktok', 'x', 'youtube'])

export type ImageType = typeof ImageType.Type
export const ImageType = Schema.Literals(['image/jpeg', 'image/png', 'image/webp', 'image/gif'])

export type Image = typeof Image.Type
export const Image = Schema.Struct({bytes: Schema.Uint8Array, type: ImageType})

export type FileType = typeof FileType.Type
export const FileType = Schema.Literals(['image/jpeg', 'image/png', 'video/mp4', 'video/quicktime'])

export type Note = typeof Note.Type
export const Note = Schema.Struct({
	author: Schema.optionalKey(Schema.String),
	body: Schema.optionalKey(Schema.String),
	content: Schema.String,
	createdAt: Schema.Finite,
	file: Schema.optionalKey(FileType),
	id: NoteId,
	image: Schema.optionalKey(ImageType),
	issue: Schema.optionalKey(Schema.String),
	screenText: Schema.optionalKey(Schema.String),
	source: Source,
	status: Schema.Literals(['organizing', 'ready', 'failed']),
	summary: Schema.String,
	tags: Schema.Array(Tag),
	text: Schema.String,
	title: Schema.String,
	topics: Schema.optionalKey(Schema.String),
	transcript: Schema.optionalKey(Schema.String),
	url: Schema.optionalKey(Schema.String)
})

// A note as the store keeps it.
export type NoteJson = typeof NoteJson.Type
export const NoteJson = Schema.fromJsonString(Note)

export type NoteItem = typeof NoteItem.Type
export const NoteItem = Note.mapFields(Struct.omit(['body', 'content', 'screenText', 'text', 'transcript']))

export type NotesEvent = typeof NotesEvent.Type
export const NotesEvent = Schema.Struct({
	removed: Schema.Array(NoteId),
	reset: Schema.Boolean,
	upserted: Schema.Array(NoteItem)
})

export type Capture = typeof Capture.Type
export const Capture = Schema.Struct({
	id: NoteId,
	text: pipe(Schema.String, Schema.check(Schema.isMinLength(1), Schema.isMaxLength(20_000)))
})

export type Extraction = typeof Extraction.Type
export const Extraction = Schema.Struct({
	author: Schema.Option(Schema.String),
	image: Schema.Option(Schema.String),
	slides: Schema.optionalKey(Schema.Array(Schema.String)),
	text: Schema.String,
	title: Schema.String,
	url: Schema.String,
	video: Schema.optionalKey(Schema.String)
})

export type Organization = typeof Organization.Type
export const Organization = Schema.Struct({
	body: pipe(Schema.String, Schema.check(Schema.isMaxLength(12_000))),
	screenText: Schema.String,
	summary: pipe(Schema.String, Schema.check(Schema.isMaxLength(300))),
	tags: pipe(Schema.Array(Tag), Schema.check(Schema.isMinLength(1), Schema.isMaxLength(3))),
	title: pipe(Schema.String, Schema.check(Schema.isMinLength(1), Schema.isMaxLength(80))),
	topics: pipe(Schema.String, Schema.check(Schema.isMaxLength(400)))
})

// What the sources answer.

export type FxPost = typeof FxPost.Type
export const FxPost = Schema.Struct({
	author: Schema.Struct({id: Schema.String, name: Schema.String, screen_name: Schema.String}),
	created_timestamp: Schema.Finite,
	id: Schema.String,
	media: Schema.optionalKey(
		Schema.Struct({
			all: Schema.optionalKey(
				Schema.Array(
					Schema.Struct({thumbnail_url: Schema.optionalKey(Schema.String), type: Schema.String, url: Schema.String})
				)
			)
		})
	),
	raw_text: Schema.optionalKey(
		Schema.Struct({facets: Schema.Array(Schema.Struct({replacement: Schema.optionalKey(Schema.String)}))})
	),
	text: Schema.String
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
					data: Schema.Struct({markdown: Schema.optionalKey(Schema.String), url: Schema.optionalKey(Schema.String)}),
					type: Schema.String
				})
			})
		)
	}),
	title: Schema.String
})

export type FxStatus = typeof FxStatus.Type
export const FxStatus = Schema.Struct({
	status: Schema.Struct({...FxPost.fields, article: Schema.optionalKey(FxArticle), quote: Schema.optionalKey(FxPost)})
})

// `thread` holds the posts above the saved one and the saved post itself; `replies` holds the posts below it.
export type FxConversation = typeof FxConversation.Type
export const FxConversation = Schema.Struct({
	...FxStatus.fields,
	replies: Schema.optionalKey(Schema.Array(FxPost)),
	thread: Schema.optionalKey(Schema.Array(FxPost))
})

export type OEmbed = typeof OEmbed.Type
export const OEmbed = Schema.Struct({
	author_name: Schema.optionalKey(Schema.String),
	html: Schema.optionalKey(Schema.String),
	thumbnail_url: Schema.optionalKey(Schema.String),
	title: Schema.optionalKey(Schema.String)
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
						title: Schema.optionalKey(Schema.String)
					})
				})
			})
		})
	})
})

export type GitHubRepo = typeof GitHubRepo.Type
export const GitHubRepo = Schema.Struct({
	description: Schema.NullOr(Schema.String),
	full_name: Schema.String,
	homepage: Schema.optionalKey(Schema.NullOr(Schema.String)),
	owner: Schema.Struct({login: Schema.String}),
	topics: Schema.optionalKey(Schema.Array(Schema.String))
})

export type GitHubComment = typeof GitHubComment.Type
export const GitHubComment = Schema.Struct({
	body: Schema.NullOr(Schema.String),
	user: Schema.Struct({login: Schema.String})
})

export type GitHubIssue = typeof GitHubIssue.Type
export const GitHubIssue = Schema.Struct({...GitHubComment.fields, state: Schema.String, title: Schema.String})

export type GitHubReadme = typeof GitHubReadme.Type
export const GitHubReadme = Schema.Struct({download_url: Schema.String})

export type Reader = typeof Reader.Type
export const Reader = Schema.Struct({data: Schema.Struct({content: Schema.String, title: Schema.String})})
