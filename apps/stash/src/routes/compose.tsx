import {useAtom, useAtomSet} from '@effect/atom-react'

import {String} from 'effect'

import {Button, TextField, Toolbar, ToolbarItem, useNativeState} from '@expo/ui/swift-ui'
import {
	background,
	disabled,
	foregroundStyle,
	frame,
	labelStyle,
	navigationBarTitleDisplayMode,
	navigationTitle,
	padding
} from '@expo/ui/swift-ui/modifiers'

import {draftAtom, writeAtom} from '#lib/utils.ts'
import {colors, mono} from '@deslop/components-mobile/theme'

export function ComposeRoute(props: {onDone: () => void}) {
	const [draft, setDraft] = useAtom(draftAtom)
	const write = useAtomSet(writeAtom)
	const text = useNativeState(draft)
	return (
		<Toolbar
			modifiers={[navigationTitle('New Note'), navigationBarTitleDisplayMode('inline'), background(colors.background)]}
		>
			<TextField
				text={text}
				axis="vertical"
				autoFocus
				placeholder="write a note"
				onTextChange={setDraft}
				modifiers={[
					mono('body', 15),
					foregroundStyle(colors.foreground),
					padding({all: 16}),
					frame({alignment: 'topLeading', maxHeight: Infinity, maxWidth: Infinity})
				]}
			/>
			<Toolbar.Content>
				<ToolbarItem placement="topBarTrailing">
					<Button
						label="Save"
						systemImage="checkmark"
						onPress={() => {
							write(draft)
							props.onDone()
						}}
						modifiers={[labelStyle('iconOnly'), disabled(String.isEmpty(String.trim(draft)))]}
					/>
				</ToolbarItem>
			</Toolbar.Content>
		</Toolbar>
	)
}
