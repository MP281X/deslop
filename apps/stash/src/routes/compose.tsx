import {useAtom, useAtomSet} from '@effect/atom-react'

import {String} from 'effect'

import {Button, TextField, Toolbar, ToolbarItem, useNativeState} from '@expo/ui/swift-ui'
import {
	background,
	foregroundStyle,
	frame,
	navigationBarTitleDisplayMode,
	navigationTitle,
	padding
} from '@expo/ui/swift-ui/modifiers'

import {draftAtom, writeAtom} from '#lib/utils.ts'
import {colors, mono} from '@deslop/components/mobile/theme'

// A blank page for a note without a link; the AI organizes it into short lines once the server has it.
export function ComposeRoute(props: {onDone: () => void}) {
	const [draft, setDraft] = useAtom(draftAtom)
	const write = useAtomSet(writeAtom)
	const text = useNativeState(draft)
	return (
		<Toolbar modifiers={[navigationTitle(''), navigationBarTitleDisplayMode('inline'), background(colors.background)]}>
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
						systemImage="checkmark"
						onPress={() => {
							if (String.isEmpty(String.trim(draft))) return
							write(draft)
							props.onDone()
						}}
					/>
				</ToolbarItem>
			</Toolbar.Content>
		</Toolbar>
	)
}
