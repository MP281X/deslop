import {ProgressView, Text} from '@expo/ui/swift-ui'

import {text} from '#components/theme.ts'

export function Spinner(props: {label?: string}) {
	return (
		<ProgressView>{props.label !== undefined && <Text modifiers={[text.detail]}>{props.label}</Text>}</ProgressView>
	)
}
