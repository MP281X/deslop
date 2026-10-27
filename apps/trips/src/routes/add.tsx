import {useAtom, useAtomSubscribe} from '@effect/atom-react'

import {String} from 'effect'

import {Button, ProgressView, TextField, Toolbar, ToolbarItem, useNativeState} from '@expo/ui/swift-ui'
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
import {AsyncResult} from 'effect/reactivity'

import {colors, mono} from '@deslop/components-mobile/theme'

import {draftAtom, saveAtom} from '#lib/utils.ts'

// A pasted confirmation, e-ticket or boarding pass, read on the server.
export function AddRoute(props: {onDone: () => void}) {
	const [draft, setDraft] = useAtom(draftAtom)
	const [saving, save] = useAtom(saveAtom)
	const text = useNativeState(draft)
	// The sheet closes once the booking is saved; a failure alerts and keeps the text to fix.
	useAtomSubscribe(saveAtom, result => {
		if (AsyncResult.isSuccess(result) && !result.waiting) props.onDone()
	})
	return (
		<Toolbar
			modifiers={[
				navigationTitle('Add Booking'),
				navigationBarTitleDisplayMode('inline'),
				background(colors.background)
			]}
		>
			<TextField
				text={text}
				axis="vertical"
				autoFocus
				placeholder="Paste a confirmation, an e-ticket or a boarding pass's text"
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
					{AsyncResult.isWaiting(saving) && <ProgressView />}
					{!AsyncResult.isWaiting(saving) && (
						<Button
							label="Save"
							systemImage="checkmark"
							onPress={() => save(draft)}
							modifiers={[labelStyle('iconOnly'), disabled(String.isEmpty(String.trim(draft)))]}
						/>
					)}
				</ToolbarItem>
			</Toolbar.Content>
		</Toolbar>
	)
}
