import {useAtom, useAtomSet} from '@effect/atom-react'

import {String} from 'effect'

import {Button, TextField, Toolbar, ToolbarItem, useNativeState} from '@expo/ui/swift-ui'
import {
	disabled,
	foregroundStyle,
	frame,
	navigationBarTitleDisplayMode,
	navigationTitle,
	padding
} from '@expo/ui/swift-ui/modifiers'

import {colors, space} from '@deslop/components-mobile/theme'

import {draftAtom, writeAtom} from '#lib/utils.ts'

export function ComposeRoute(props: {onDone: () => void}) {
	const [draft, setDraft] = useAtom(draftAtom)
	const write = useAtomSet(writeAtom)
	const text = useNativeState(draft)
	return (
		<Toolbar modifiers={[navigationTitle('New Note'), navigationBarTitleDisplayMode('inline')]}>
			<TextField
				text={text}
				axis="vertical"
				autoFocus
				placeholder="Write a note"
				onTextChange={setDraft}
				modifiers={[
					foregroundStyle(colors.foreground),
					padding({all: space[4]}),
					frame({alignment: 'topLeading', maxHeight: Infinity, maxWidth: Infinity})
				]}
			/>
			<Toolbar.Content>
				<ToolbarItem placement="topBarTrailing">
					<Button
						label="Save"
						onPress={() => {
							write(draft)
							props.onDone()
						}}
						modifiers={[disabled(String.isEmpty(String.trim(draft)))]}
					/>
				</ToolbarItem>
			</Toolbar.Content>
		</Toolbar>
	)
}
