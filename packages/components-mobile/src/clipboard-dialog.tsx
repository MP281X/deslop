import {Alert, Button} from '@expo/ui/swift-ui'
import type {ReactNode} from 'react'

// A system alert asks the question over the wrapped screen; a confirmation popover would point away from it.
export function ClipboardDialog(props: {
	children: ReactNode
	confirm: string
	onAnswer: (save: boolean) => void
	open: boolean
	question: string
}) {
	return (
		<Alert
			title={props.question}
			isPresented={props.open}
			onIsPresentedChange={presented => {
				if (!presented) props.onAnswer(false)
			}}
		>
			<Alert.Trigger>{props.children}</Alert.Trigger>
			<Alert.Actions>
				<Button label="Not Now" role="cancel" onPress={() => props.onAnswer(false)} />
				<Button label={props.confirm} onPress={() => props.onAnswer(true)} />
			</Alert.Actions>
		</Alert>
	)
}
