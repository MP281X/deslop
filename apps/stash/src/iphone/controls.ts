import type {Native} from '@effect/ui-native'
import {Pressable} from '@effect/ui-native/kit'

import {Boolean, Function} from 'effect'

import {black, ink, styles} from '@deslop/design/native'

import type {StashMessage} from '#screens/notes.ts'

export function Button(
	h: Native.H<StashMessage>,
	label: string,
	onPress: StashMessage,
	options: {compact?: boolean; disabled?: boolean; selected?: boolean} = {}
) {
	const active = options.selected === true
	const button = Pressable(h, {
		onPress,
		props: {disabled: options.disabled, pressedStyle: {backgroundColor: '#2b2b2b'}}
	})
		.prop('accessible', true)
		.prop('accessibilityLabel', label)
		.prop('accessibilityRole', 'button')
		.prop('accessibilityState', {disabled: options.disabled === true, selected: active})
		.style({
			...styles.control,
			backgroundColor: Boolean.match(active, {
				onFalse: Function.constant(styles.control.backgroundColor),
				onTrue: Function.constant(ink)
			}),
			borderRadius: Boolean.match(options.compact === true, {
				onFalse: Function.constant(styles.control.borderRadius),
				onTrue: Function.constant(15)
			}),
			minHeight: Boolean.match(options.compact === true, {
				onFalse: Function.constant(styles.control.minHeight),
				onTrue: Function.constant(30)
			}),
			opacity: Boolean.match(options.disabled === true, {
				onFalse: Function.constant(1),
				onTrue: Function.constant(0.45)
			})
		})
		.children(
			h.text
				.style({
					...styles.line,
					color: Boolean.match(active, {onFalse: Function.constant(ink), onTrue: Function.constant(black)})
				})
				.children(label)
		)
	if (options.disabled === true) return button
	return button.on('accessibilityTap', onPress)
}
