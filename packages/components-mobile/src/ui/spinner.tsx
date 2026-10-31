import {ProgressView, Text} from '@expo/ui/swift-ui'

import {text} from '#components/theme.ts'

// shadcn's Spinner on iOS: SwiftUI's own progress view, with an optional line saying what it waits for.
export function Spinner(props: {label?: string}) {
	return (
		<ProgressView>{props.label !== undefined && <Text modifiers={[text.detail]}>{props.label}</Text>}</ProgressView>
	)
}
