import {useAtom, useAtomMount, useAtomSet} from '@effect/atom-react'

import {String} from 'effect'

import {Button, TextField, Toolbar, ToolbarItem, useNativeState} from '@expo/ui/swift-ui'
import type {TextFieldRef} from '@expo/ui/swift-ui'
import {
	disabled,
	foregroundStyle,
	frame,
	navigationBarTitleDisplayMode,
	navigationTitle,
	padding
} from '@expo/ui/swift-ui/modifiers'
import {Atom} from 'effect/reactivity'
import {useRef} from 'react'
import {useWindowDimensions} from 'react-native'

import {barNeverMinimizes} from '@deslop/components-mobile/lib/toolbar'
import {colors, space} from '@deslop/components-mobile/theme'
import {unsaved} from '@deslop/runtime/mobile/unsaved'

import {draftAtom, writeAtom} from '#lib/notes.ts'

const unsavedDraftAtom = unsaved(Atom.map(draftAtom, draft => !String.isEmpty(String.trim(draft))))

export function ComposeRoute(props: {onDone: () => void}) {
	const [draft, setDraft] = useAtom(draftAtom)
	const write = useAtomSet(writeAtom)
	const text = useNativeState(draft)
	useAtomMount(unsavedDraftAtom)
	const field = useRef<TextFieldRef>(null)
	const window = useWindowDimensions()
	// The window the field last took focus in. Every fold or turn moves the window and iOS lowers the keyboard; the field, which stays mounted, takes it back with its caret.
	const focusedIn = useRef(window)
	return (
		<Toolbar modifiers={[navigationTitle('New Note'), navigationBarTitleDisplayMode('inline'), barNeverMinimizes]}>
			<TextField
				text={text}
				axis="vertical"
				ref={field}
				autoFocus
				placeholder="Write a note"
				onTextChange={setDraft}
				onFocusChange={focused => {
					if (focused) {
						focusedIn.current = window
					} else if (focusedIn.current.width !== window.width || focusedIn.current.height !== window.height) {
						// oxlint-disable-next-line typescript/no-floating-promises -- Focusing hands the field to iOS; nothing in the app waits on it.
						field.current?.focus()
					}
				}}
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
