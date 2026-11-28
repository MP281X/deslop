import {Schema, pipe} from 'effect'

import {DateTimeUtcFromFiniteSeconds} from '@deslop/runtime/shared/time'

export type PostId = typeof PostId.Type
export const PostId = pipe(Schema.String, Schema.brand('PostId'))
export type PostAuthorId = typeof PostAuthorId.Type
export const PostAuthorId = pipe(Schema.String, Schema.brand('PostAuthorId'))

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
