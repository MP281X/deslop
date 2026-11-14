import {RoundedRectangle} from '@expo/ui/swift-ui'
import {foregroundStyle} from '@expo/ui/swift-ui/modifiers'
import type {ViewModifier} from '@expo/ui/swift-ui/modifiers'

import {colors, radius} from '#components/theme.ts'

export function Skeleton(props: {modifiers?: ViewModifier[]}) {
	return (
		<RoundedRectangle cornerRadius={radius} modifiers={[...(props.modifiers ?? []), foregroundStyle(colors.card)]} />
	)
}
