import {BottomSheet, Button, Image, Text, VStack} from '@expo/ui/swift-ui'
import type {ImageProps} from '@expo/ui/swift-ui'
import {background, buttonStyle, controlSize, foregroundStyle, frame, padding, tint} from '@expo/ui/swift-ui/modifiers'
import type {ReactNode} from 'react'
import type {ColorValue} from 'react-native'

import {colors, space, text} from './theme.ts'

// A yes-or-no question about what the clipboard holds; it hangs off the title in the bar, so it adds nothing to the layout.
export function ClipboardSheet(props: {
	anchor: ReactNode
	confirm: string
	detail?: string
	onAnswer: (save: boolean) => void
	open: boolean
	question: string
	symbol: ImageProps['systemName']
	tint: ColorValue
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
				spacing={space[3]}
				modifiers={[
					padding({bottom: space[2], leading: space[6], top: space[6], trailing: space[6]}),
					frame({maxWidth: Infinity}),
					background(colors.background)
				]}
			>
				<Image systemName={props.symbol} size={24} modifiers={[foregroundStyle(props.tint)]} />
				<Text modifiers={[text.title, foregroundStyle(colors.foreground)]}>{props.question}</Text>
				{props.detail !== undefined && (
					<Text modifiers={[text.body, foregroundStyle(colors.mutedForeground)]}>{props.detail}</Text>
				)}
				<VStack spacing={space[1]} modifiers={[padding({top: space[2]})]}>
					<Button
						onPress={() => props.onAnswer(true)}
						modifiers={[
							buttonStyle('glassProminent'),
							controlSize('large'),
							tint(props.tint),
							foregroundStyle(colors.primaryForeground)
						]}
					>
						<Text modifiers={[text.title, frame({maxWidth: Infinity})]}>{props.confirm}</Text>
					</Button>
					<Button onPress={() => props.onAnswer(false)} modifiers={[buttonStyle('plain'), controlSize('large')]}>
						<Text
							modifiers={[
								text.body,
								foregroundStyle(colors.mutedForeground),
								padding({vertical: space[3]}),
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
