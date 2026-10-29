import {BottomSheet, Button, Image, Text, VStack} from '@expo/ui/swift-ui'
import type {ImageProps} from '@expo/ui/swift-ui'
import {background, buttonStyle, controlSize, foregroundStyle, frame, padding, tint} from '@expo/ui/swift-ui/modifiers'
import type {ReactNode} from 'react'

import {colors, mono} from './theme.ts'

// A yes-or-no question about what the clipboard holds; it hangs off the title in the bar, so it adds nothing to the layout.
export function ClipboardSheet(props: {
	anchor: ReactNode
	confirm: string
	detail?: string
	onAnswer: (save: boolean) => void
	open: boolean
	question: string
	symbol: ImageProps['systemName']
}) {
	return (
		<BottomSheet
			anchor={props.anchor}
			isPresented={props.open}
			onIsPresentedChange={presented => {
				if (!presented) props.onAnswer(false)
			}}
			fitToContents
		>
			<VStack
				spacing={14}
				modifiers={[
					padding({bottom: 8, leading: 24, top: 28, trailing: 24}),
					frame({maxWidth: Infinity}),
					background(colors.background)
				]}
			>
				<Image systemName={props.symbol} size={24} modifiers={[foregroundStyle(colors.foreground)]} />
				<Text modifiers={[mono('headline', 17), foregroundStyle(colors.foreground)]}>{props.question}</Text>
				{props.detail !== undefined && (
					<Text modifiers={[mono('body', 14), foregroundStyle(colors.mutedForeground)]}>{props.detail}</Text>
				)}
				<VStack spacing={4} modifiers={[padding({top: 6})]}>
					<Button
						onPress={() => props.onAnswer(true)}
						modifiers={[
							buttonStyle('glassProminent'),
							controlSize('large'),
							tint(colors.primary),
							foregroundStyle(colors.primaryForeground)
						]}
					>
						<Text modifiers={[mono('headline', 16), frame({maxWidth: Infinity})]}>{props.confirm}</Text>
					</Button>
					<Button onPress={() => props.onAnswer(false)} modifiers={[buttonStyle('plain'), controlSize('large')]}>
						<Text
							modifiers={[
								mono('body', 15),
								foregroundStyle(colors.mutedForeground),
								padding({vertical: 12}),
								frame({maxWidth: Infinity})
							]}
						>
							Not Now
						</Text>
					</Button>
				</VStack>
			</VStack>
		</BottomSheet>
	)
}
