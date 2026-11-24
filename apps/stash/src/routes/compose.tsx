import {useAtom, useAtomMount, useAtomSet, useAtomSubscribe} from '@effect/atom-react'

import {Option, String} from 'effect'

import {Button, TextField, Toolbar, ToolbarItem, useNativeState} from '@expo/ui/swift-ui'
import type {TextFieldRef} from '@expo/ui/swift-ui'
import {
	disabled,
	foregroundStyle,
	frame,
	navigationBarTitleDisplayMode,
	navigationTitle,
	onGeometryChange,
	padding
} from '@expo/ui/swift-ui/modifiers'
import {Atom} from 'effect/reactivity'
import {useRef} from 'react'

import {barNeverMinimizes} from '@deslop/components-mobile/lib/toolbar'
import {colors, space} from '@deslop/components-mobile/theme'
import {unsaved} from '@deslop/runtime/mobile/unsaved'

import {draftAtom, writeAtom} from '#lib/notes.ts'

const unsavedDraftAtom = unsaved(Atom.map(draftAtom, draft => !String.isEmpty(String.trim(draft))))

// The field's width, which every fold or turn changes.
const widthAtom = Atom.make(Option.none<number>())

export function ComposeRoute(props: {onDone: () => void}) {
	const [draft, setDraft] = useAtom(draftAtom)
	const write = useAtomSet(writeAtom)
	const text = useNativeState(draft)
	useAtomMount(unsavedDraftAtom)
	const field = useRef<TextFieldRef>(null)
	const setWidth = useAtomSet(widthAtom)
	// iOS lowers the keyboard on every fold or turn, before or after the field takes its new width; the field, which stays mounted, takes it back with its caret. It is owed the keyboard after losing it, to take back at the next width, and after keeping it into a new width, to take back if iOS lowers it before the person types.
	const keyboard = useRef({focused: false, owed: false})
	function regain() {
		// oxlint-disable-next-line typescript/no-floating-promises -- Focusing hands the field to iOS; nothing in the app waits on it.
		field.current?.focus()
	}
	useAtomSubscribe(widthAtom, () => {
		if (keyboard.current.focused) keyboard.current.owed = true
		else if (keyboard.current.owed) regain()
	})
	return (
		<Toolbar modifiers={[navigationTitle('New Note'), navigationBarTitleDisplayMode('inline'), barNeverMinimizes()]}>
			<TextField
				text={text}
				axis="vertical"
				ref={field}
				autoFocus
				placeholder="Write a note"
				onTextChange={value => {
					keyboard.current.owed = false
					setDraft(value)
				}}
				onFocusChange={focused => {
					if (!focused && keyboard.current.owed) regain()
					keyboard.current.focused = focused
					keyboard.current.owed = !focused
				}}
				modifiers={[
					foregroundStyle(colors.foreground),
					padding({all: space[4]}),
					frame({alignment: 'topLeading', maxHeight: Infinity, maxWidth: Infinity}),
					onGeometryChange(bounds => setWidth(Option.some(bounds.width)))
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
