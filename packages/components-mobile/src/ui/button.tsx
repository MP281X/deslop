import {Boolean, Schema} from 'effect'

import {Button as NativeButton} from '@expo/ui/swift-ui'
import type {ButtonProps} from '@expo/ui/swift-ui'
import {buttonBorderShape, buttonStyle, controlSize, disabled, labelStyle, tint} from '@expo/ui/swift-ui/modifiers'
import type {ViewModifier} from '@expo/ui/swift-ui/modifiers'

import {colors} from '#components/theme.ts'

const BUTTON_SIZES = {
	default: {control: 'regular', icon: false},
	icon: {control: 'regular', icon: true},
	'icon-lg': {control: 'large', icon: true},
	'icon-sm': {control: 'small', icon: true},
	'icon-xs': {control: 'mini', icon: true},
	lg: {control: 'large', icon: false},
	sm: {control: 'small', icon: false},
	xs: {control: 'mini', icon: false}
} as const

export type ButtonVariant = typeof ButtonVariant.Type
const ButtonVariant = Schema.Literals(['default', 'outline', 'ghost', 'destructive'])

export type ButtonSize = typeof ButtonSize.Type
const ButtonSize = Schema.Literals(['default', 'xs', 'sm', 'lg', 'icon', 'icon-xs', 'icon-sm', 'icon-lg'])

// The app's hue is the tint a screen sets on its ancestors, as `--primary` is on the web.
const buttonVariants = {
	default: {modifiers: [buttonStyle('glassProminent')], role: 'default'},
	destructive: {modifiers: [buttonStyle('glassProminent'), tint(colors.destructive)], role: 'destructive'},
	ghost: {modifiers: [buttonStyle('plain')], role: 'default'},
	outline: {modifiers: [buttonStyle('glass')], role: 'default'}
} satisfies Record<ButtonVariant, {modifiers: ViewModifier[]; role: ButtonProps['role']}>

// Caller modifiers precede variant, size and disabled modifiers. An icon size shows only the symbol; the children still name the button for VoiceOver.
export function Button(props: {
	children: string
	disabled?: boolean
	modifiers?: ViewModifier[]
	onPress: () => void
	size?: ButtonSize
	systemImage?: ButtonProps['systemImage']
	variant?: ButtonVariant
}) {
	const variant = buttonVariants[props.variant ?? 'default']
	const size = BUTTON_SIZES[props.size ?? 'default']
	return (
		<NativeButton
			label={props.children}
			systemImage={props.systemImage}
			role={variant.role}
			onPress={props.onPress}
			modifiers={[
				...(props.modifiers ?? []),
				...variant.modifiers,
				controlSize(size.control),
				...Boolean.match(size.icon, {
					onFalse: () => [buttonBorderShape('capsule'), labelStyle('titleAndIcon')],
					onTrue: () => [buttonBorderShape('circle'), labelStyle('iconOnly')]
				}),
				disabled(props.disabled === true)
			]}
		/>
	)
}
