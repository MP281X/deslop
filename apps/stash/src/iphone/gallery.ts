import {Command, UiSchema} from '@effect/ui'
import {Native} from '@effect/ui-native'

import {Array, Effect, Number, Schema, pipe} from 'effect'

import {styles} from '@deslop/design/native'

import {ImageType} from '#contracts'

import {StashNative, atDevice} from '#iphone/device.ts'

const Image = Native.defineView(
	() => new Native.ViewElement<never, never, Record<string, unknown>, 'stashImage'>('stashImage'),
	{viewName: 'RCTImageView'}
)

const load = Command.make('Stash/LoadPicture', {args: {path: Schema.String}, success: Schema.String}, ({path}) =>
	pipe(
		atDevice('Picture unavailable', () => StashNative.image(path)),
		Effect.map(result => {
			if (!Schema.is(ImageType)(result.type)) return ''
			return `data:${result.type};base64,${result.data}`
		}),
		Effect.catchTag('NotesError', () => Effect.succeed(''))
	)
)

const PictureMessage = UiSchema.TaggedEnum({Loaded: {uri: Schema.String}, Retry: {}})
const Picture = Native.component({
	message: PictureMessage,
	model: Schema.UndefinedOr(Schema.String),
	name: 'StashPicture',
	props: Schema.Struct({label: Schema.String, path: Schema.String, width: Schema.Finite})
}).make({
	init: $ =>
		$.set(undefined).run(
			pipe(
				load.make({path: $.props.path}),
				Command.map(uri => PictureMessage.Loaded({uri}))
			)
		),
	update: {
		Loaded: ($, {uri}) => $.set(uri),
		Retry: $ =>
			$.set(undefined).run(
				pipe(
					load.make({path: $.props.path}),
					Command.map(uri => PictureMessage.Loaded({uri}))
				)
			)
	},
	view: (h, uri) => {
		const style = {height: 304, width: h.props.width}
		if (uri === undefined) return h.view.style({...style, backgroundColor: '#181818'})
		if (uri === '')
			return h.text
				.style({...styles.line, ...style})
				.on('press', PictureMessage.Retry())
				.children('Picture unavailable. Tap to retry.')
		return Image.style(style)
			.prop('accessibilityLabel', h.props.label)
			.prop('accessible', true)
			.prop('resizeMode', 'contain')
			.prop('source', [{uri}])
	}
})

const Message = UiSchema.TaggedEnum({Measured: {width: Schema.Finite}, Scrolled: {x: Schema.Finite}})
export const Gallery = Native.component({
	message: Message,
	model: Schema.Struct({page: Schema.Int, width: Schema.Finite}),
	name: 'StashGallery',
	props: Schema.Struct({paths: Schema.Array(Schema.String)})
}).make({
	init: () => ({page: 0, width: 0}),
	update: {
		Measured: ($, {width}) => {
			if ($.model.width === width) return $.model
			return $.evolve({page: 0, width})
		},
		Scrolled: ($, {x}) => {
			const page = Number.clamp(Number.round(x / $.model.width, 0), {maximum: $.props.paths.length - 1, minimum: 0})
			if (page === $.model.page) return $.model
			return $.evolve({page})
		}
	},
	view: (h, {page, width}) =>
		h.view
			.on('layout', event => Message.Measured({width: event.layout.width}))
			.children(
				width > 0 &&
					h.scroll
						.key(`${width}`)
						.style({height: 304})
						.prop('horizontal', true)
						.prop('pagingEnabled', true)
						.prop('showsHorizontalScrollIndicator', false)
						.on('scroll', event => Message.Scrolled({x: event.x}))
						.children(
							Array.map(h.props.paths, (path, index) => {
								if (index < page - 1 || index > page + 1) return h.view.key(path).style({height: 304, width})
								return Picture(h, {
									key: path,
									props: {label: `Picture ${index + 1} of ${h.props.paths.length}`, path, width}
								})
							})
						),
				h.props.paths.length > 1 &&
					h.text
						.style({...styles.line, alignSelf: 'center', fontVariant: ['tabular-nums']})
						.children(`${page + 1} / ${h.props.paths.length}`)
			)
})
