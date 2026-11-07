import {Alert, Button} from '@expo/ui/swift-ui'
import type {ReactNode} from 'react'

// A yes-or-no question about what the clipboard holds, as iOS asks one: a system alert over the screen it wraps, its title the whole question and its button one verb. A confirmation dialog would point a popover at that screen.
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
