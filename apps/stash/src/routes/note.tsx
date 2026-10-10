import {useAtomSuspense, useAtomValue} from '@effect/atom-react'

import {Array, Option, String} from 'effect'

import {
	Button,
	ContentUnavailableView,
	HStack,
	Image,
	ScrollView,
	Text,
	Toolbar,
	ToolbarItem,
	VStack
} from '@expo/ui/swift-ui'
import {
	aspectRatio,
	background,
	border,
	buttonStyle,
	fixedSize,
	foregroundStyle,
	frame,
	lineLimit,
	navigationBarTitleDisplayMode,
	navigationTitle,
	padding,
	resizable,
	textSelection
} from '@expo/ui/swift-ui/modifiers'
import {AsyncResult} from 'effect/reactivity'
import {useState} from 'react'
import {Linking} from 'react-native'

import {colors, mono} from '#lib/theme.ts'
import {imageAtom, notesAtom} from '#lib/utils.ts'
import type {Note} from '#services/notes/schema.ts'

const page = [navigationTitle(''), navigationBarTitleDisplayMode('inline'), background(colors.background)]

export function NoteRoute(props: {id: Note['id']; onTag: (tag: string) => void}) {
	return Option.match(
		Array.findFirst(useAtomSuspense(notesAtom).value.notes, note => note.id === props.id),
		{
			onNone: () => (
				<ContentUnavailableView
					title="gone"
					description="deleted, or joined to an earlier save of the same post"
					modifiers={[...page, mono('body', 14), foregroundStyle(colors.mutedForeground)]}
				/>
			),
			onSome: note => <Detail note={note} onTag={props.onTag} />
		}
	)
}

// Mounted only once the server has kept the preview, so the download never runs before the file exists. The whole
// image fits the width, so a wide preview never pushes the page past the screen edge.
function Cover(props: {note: Note}) {
	const image = useAtomValue(imageAtom(props.note.id))
	if (!AsyncResult.isSuccess(image)) return undefined
	return (
		<Image
			uiImage={image.value}
			modifiers={[
				resizable(),
				aspectRatio({contentMode: 'fit'}),
				frame({maxHeight: props.note.source === 'TikTok' ? 420 : 260, maxWidth: Infinity})
			]}
		/>
	)
}

function Detail(props: {note: Note; onTag: (tag: string) => void}) {
	const [transcriptOpen, setTranscriptOpen] = useState(false)
	return (
		<Toolbar modifiers={page}>
			<ScrollView modifiers={[background(colors.background)]}>
				<VStack
					alignment="leading"
					spacing={14}
					modifiers={[padding({all: 16}), frame({alignment: 'leading', maxWidth: Infinity})]}
				>
					{props.note.image !== undefined && <Cover note={props.note} />}
					<Text modifiers={[mono('headline', 18), foregroundStyle(colors.foreground), textSelection(true)]}>
						{props.note.title}
					</Text>
					{String.isNonEmpty(props.note.summary) && (
						<Text modifiers={[mono('body', 14), foregroundStyle(colors.mutedForeground), textSelection(true)]}>
							{props.note.summary}
						</Text>
					)}
					{!Array.isReadonlyArrayEmpty(props.note.tags) && (
						// One scrolling line of tags, so a tag never breaks across two lines.
						<ScrollView axes="horizontal" showsIndicators={false}>
							<HStack spacing={8}>
								{Array.map(props.note.tags, tag => (
									<Button
										key={tag}
										onPress={() => props.onTag(tag)}
										modifiers={[buttonStyle('plain'), border({color: colors.border, width: 1})]}
									>
										<Text
											modifiers={[
												mono('caption', 12),
												foregroundStyle(colors.primary),
												lineLimit(1),
												fixedSize(),
												padding({horizontal: 8, vertical: 4})
											]}
										>
											{`#${tag}`}
										</Text>
									</Button>
								))}
							</HStack>
						</ScrollView>
					)}
					{/* What the server read from the link: the post and its quote, or the start of the page. */}
					{String.isNonEmpty(props.note.content) && (
						<Text
							modifiers={[
								mono('caption', 12),
								foregroundStyle(colors.foreground),
								lineLimit(props.note.source === 'Website' ? 8 : 40),
								textSelection(true)
							]}
						>
							{props.note.content}
						</Text>
					)}
					{Option.match(Option.fromNullishOr(props.note.transcript), {
						onNone: () => undefined,
						onSome: transcript => (
							<VStack alignment="leading" spacing={8}>
								<Button onPress={() => setTranscriptOpen(!transcriptOpen)} modifiers={[buttonStyle('plain')]}>
									<HStack spacing={6}>
										<Image
											systemName={transcriptOpen ? 'chevron.down' : 'chevron.right'}
											size={11}
											modifiers={[foregroundStyle(colors.mutedForeground)]}
										/>
										<Text modifiers={[mono('caption', 12), foregroundStyle(colors.mutedForeground)]}>transcript</Text>
									</HStack>
								</Button>
								{transcriptOpen && (
									<Text modifiers={[mono('caption', 11), foregroundStyle(colors.mutedForeground), textSelection(true)]}>
										{transcript}
									</Text>
								)}
							</VStack>
						)
					})}
					{String.isNonEmpty(props.note.issue) && (
						<Text modifiers={[mono('caption', 12), foregroundStyle(colors.mutedForeground)]}>{props.note.issue}</Text>
					)}
				</VStack>
			</ScrollView>
			{/* The link opens from the bar, in its own app when iOS knows one. */}
			{Option.match(Option.fromNullishOr(props.note.url), {
				onNone: () => undefined,
				onSome: url => (
					<Toolbar.Content>
						<ToolbarItem placement="topBarTrailing">
							<Button systemImage="arrow.up.right" onPress={() => Linking.openURL(url)} />
						</ToolbarItem>
					</Toolbar.Content>
				)
			})}
		</Toolbar>
	)
}
