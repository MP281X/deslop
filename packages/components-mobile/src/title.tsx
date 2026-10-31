import {useAtomValue} from '@effect/atom-react'

import {HStack, Image, Text} from '@expo/ui/swift-ui'
import {accessibilityElement, cornerRadius, foregroundStyle, frame, resizable} from '@expo/ui/swift-ui/modifiers'
import {AsyncResult} from 'effect/reactivity'

import {colors, space, text} from './theme.ts'

import {assetAtom} from '#lib/utils.ts'

// The app's icon and lowercase name, centered in the navigation bar of its home screen.
export function AppTitle(props: {logo: number | string; name: string}) {
	const uri = useAtomValue(assetAtom(props.logo))
	return (
		<HStack spacing={space[2]} modifiers={[accessibilityElement('combine')]}>
			{AsyncResult.isSuccess(uri) && (
				<Image uiImage={uri.value} modifiers={[resizable(), frame({height: 18, width: 18}), cornerRadius(4)]} />
			)}
			<Text modifiers={[text.title, foregroundStyle(colors.foreground)]}>{props.name}</Text>
		</HStack>
	)
}
