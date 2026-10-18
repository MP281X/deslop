import {useAtom} from '@effect/atom-react'

import {Option, String, pipe} from 'effect'

import {Button, Form, Section, Text, TextField, Toolbar, ToolbarItem, useNativeState} from '@expo/ui/swift-ui'
import {
	accessibilityLabel,
	autocorrectionDisabled,
	background,
	disabled,
	foregroundStyle,
	keyboardType,
	labelStyle,
	navigationBarTitleDisplayMode,
	navigationTitle,
	onSubmit,
	scrollContentBackground,
	submitLabel,
	textContentType,
	textInputAutocapitalization
} from '@expo/ui/swift-ui/modifiers'
import {useState} from 'react'

import {colors, mono} from '@deslop/components-mobile/theme'

import {serverAtom} from '#lib/utils.ts'

export function ServerRoute(props: {onDone: () => void}) {
	const [server, setServer] = useAtom(serverAtom)
	const [draft, setDraft] = useState(server)
	const text = useNativeState(server)
	// Only the origin, so `/api/...` resolves against the server's root; iOS lets the share extension reach HTTPS only.
	const next = pipe(
		Option.liftThrowable(() => new URL(String.trim(draft)))(),
		Option.filter(url => url.protocol === 'https:' && String.isNonEmpty(url.host)),
		Option.map(url => url.origin)
	)
	const footer = Option.match(next, {
		onNone: () => 'Enter an HTTPS address, such as https://dev.tailnet-8c4c.ts.net:4319.',
		onSome: () => 'The stash server this iPhone and its share sheet save to, such as its tailnet address.'
	})
	function save() {
		Option.map(next, value => {
			setServer(value)
			props.onDone()
		})
	}
	return (
		<Toolbar
			modifiers={[navigationTitle('Server'), navigationBarTitleDisplayMode('inline'), background(colors.background)]}
		>
			<Form modifiers={[scrollContentBackground('hidden'), background(colors.background)]}>
				<Section
					header={<Text modifiers={[mono('caption', 13)]}>Server URL</Text>}
					footer={
						<Text
							modifiers={[
								mono('caption', 13),
								foregroundStyle(
									Option.match(next, {onNone: () => colors.destructive, onSome: () => colors.mutedForeground})
								)
							]}
						>
							{footer}
						</Text>
					}
				>
					<TextField
						text={text}
						autoFocus
						placeholder="https://"
						onTextChange={setDraft}
						modifiers={[
							accessibilityLabel('Server URL'),
							mono('body', 17),
							keyboardType('url'),
							textContentType('URL'),
							textInputAutocapitalization('never'),
							autocorrectionDisabled(),
							submitLabel('done'),
							onSubmit(save)
						]}
					/>
				</Section>
			</Form>
			<Toolbar.Content>
				<ToolbarItem placement="topBarTrailing">
					<Button
						label="Save"
						systemImage="checkmark"
						onPress={save}
						modifiers={[labelStyle('iconOnly'), disabled(Option.isNone(next))]}
					/>
				</ToolbarItem>
			</Toolbar.Content>
		</Toolbar>
	)
}
