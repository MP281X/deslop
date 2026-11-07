import {useAtomValue} from '@effect/atom-react'

import {HStack, Image, Text} from '@expo/ui/swift-ui'
import {
	accessibilityElement,
	cornerRadius,
	foregroundStyle,
	frame,
	opacity,
	resizable
} from '@expo/ui/swift-ui/modifiers'
import {AsyncResult} from 'effect/reactivity'

import {colors, radius, space, text} from './theme.ts'

import {assetAtom} from '#lib/utils.ts'

// The app's icon and lowercase name in the navigation bar's title, where iOS draws no glass button around it.
export function AppTitle(props: {logo: number | string; name: string}) {
	const uri = useAtomValue(assetAtom(props.logo))
	return (
		<HStack spacing={space[2]} modifiers={[accessibilityElement('combine')]}>
			{AsyncResult.isSuccess(uri) && (
				<Image
					uiImage={uri.value}
					modifiers={[resizable(), frame({height: 18, width: 18}), cornerRadius(radius), opacity(0.6)]}
				/>
			)}
			<Text modifiers={[text.title, foregroundStyle(colors.mutedForeground)]}>{props.name}</Text>
		</HStack>
	)
}
