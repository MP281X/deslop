import {Native} from '@effect/ui-native'
import {Pan, Pressable} from '@effect/ui-native/kit'

import {Array, Boolean, Function, Number, Option, Schema, pipe} from 'effect'

import {styles} from '@deslop/components/native'

import type {Screen} from '#screens/library.ts'
import {Message} from '#screens/model.ts'
import {pageAspect} from '#screens/reading.ts'

const ALIGNMENT = {left: 'flex-end', right: 'flex-start', single: 'center'} as const

const NativeImage = Native.defineView(
	() => new Native.ViewElement<Message, never, Record<string, unknown>, 'opmImage'>('opmImage'),
	{viewName: 'RCTImageView'}
)

type Dimensions = typeof Dimensions.Type
const Dimensions = Schema.Struct({source: Schema.Struct({height: Schema.Finite, width: Schema.Finite})})

export function image(src: string) {
	return NativeImage.prop('source', [{uri: src}]).prop('pointerEvents', 'none')
}

export function control(h: Native.H<Message>, label: string, onPress: Message) {
	return Pressable(h, {onPress, props: {pressedStyle: {backgroundColor: '#2b2b2b'}}})
		.on('accessibilityTap', onPress)
		.prop('accessible', true)
		.prop('accessibilityRole', 'button')
		.prop('accessibilityLabel', label)
		.style(styles.control)
		.children(h.text.style(styles.body).children(label))
}

const edge = Boolean.match({onFalse: Function.constant(0), onTrue: Function.constant('50%' as const)})

function pageImage(h: Native.H<Message>, page: Screen['pages'][number], width: number, height: number) {
	if (page.failed) return page.visible && control(h, 'Reload page', Message.RetryPage({src: page.src}))
	return image(page.src)
		.prop('accessible', page.visible)
		.prop('accessibilityLabel', `Page ${page.index + 1}`)
		.prop('resizeMode', 'contain')
		.style({height, width})
		.on('error', Message.Image({aspect: 0, src: page.src}))
		.on('load', value =>
			pipe(
				Schema.decodeUnknownOption(Dimensions)(value),
				Option.map(size => Message.Image({aspect: pageAspect(size.source.width, size.source.height), src: page.src})),
				Option.getOrUndefined
			)
		)
}

export function IPhoneReader(h: Native.H<Message>, screen: Screen, reader: NonNullable<Screen['reader']>) {
	const active = Array.filter(screen.pages, page => page.visible)
	const spread = active.length === 2
	const available = Boolean.match(screen.wide && !screen.listHidden, {
		onFalse: () => screen.width,
		onTrue: () => screen.width - screen.listWidth
	})
	const half = Number.max(0, (available - 1) / 2)
	// The taller page sets the shared height only if both pages fit inside the two halves.
	const height = Boolean.match(spread, {
		onFalse: () => screen.height,
		onTrue: () => Array.reduce(active, screen.height, (limit, page) => Number.min(limit, half / page.aspect))
	})
	const tap = Message.Gesture({dx: 0, dy: 0})
	function pending() {
		if (reader.ready) return undefined
		if (!reader.waiting) return h.text.style(styles.line).children('Chapter unavailable')
		return h.view
			.style({backgroundColor: '#202020', height: '100%', width: Number.min(available, screen.height * 0.71)})
			.prop('accessible', true)
			.prop('accessibilityState', {busy: true})
			.prop('accessibilityLabel', 'Loading chapter')
	}

	return Pan<Message, Native.ViewElement<Message, never, Native.ViewEvents, 'view'>>(h, {
		element: Pressable(h, {onPress: tap}),
		onEnd: gesture => Message.Gesture({dx: gesture.dx, dy: gesture.dy}),
		props: {axis: 'x', threshold: 8}
	})
		.key(reader.id)
		.style({...styles.pane, alignItems: 'center', justifyContent: 'center', overflow: 'hidden'})
		.prop('accessibilityLabel', reader.title)
		.on('accessibilityEscape', Message.Close())
		.children(
			pending(),
			Array.map(screen.pages, page => {
				const width = Boolean.match(spread && page.visible, {
					onFalse: () => available,
					onTrue: () => Number.min(half, height * page.aspect)
				})
				return h.view
					.key(`${page.index}`)
					.style({
						alignItems: ALIGNMENT[page.side],
						bottom: 0,
						justifyContent: 'center',
						left: edge(page.side === 'right'),
						opacity: Boolean.match(page.visible, {onFalse: Function.constant(0), onTrue: Function.constant(1)}),
						position: 'absolute',
						right: edge(page.side === 'left'),
						top: 0,
						...(spread &&
							page.visible && {
								marginLeft: Boolean.match(page.side === 'right', {
									onFalse: Function.constant(0),
									onTrue: Function.constant(0.5)
								}),
								marginRight: Boolean.match(page.side === 'left', {
									onFalse: Function.constant(0),
									onTrue: Function.constant(0.5)
								})
							})
					})
					.prop('accessibilityElementsHidden', !page.visible)
					.prop(
						'pointerEvents',
						Boolean.match(page.visible, {onFalse: Function.constant('none'), onTrue: Function.constant('box-none')})
					)
					.children(pageImage(h, page, width, height))
			})
		)
}
