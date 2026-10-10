import {useAtomSuspense, useAtomValue} from '@effect/atom-react'

import {Array, Option, String, pipe} from 'effect'

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
	buttonStyle,
	foregroundStyle,
	frame,
	labelStyle,
	navigationBarTitleDisplayMode,
	navigationTitle,
	padding,
	resizable,
	textSelection
} from '@expo/ui/swift-ui/modifiers'
import {AsyncResult} from 'effect/reactivity'
import {useState} from 'react'
import {Linking} from 'react-native'

import {imageAtom, notesAtom} from '#lib/utils.ts'
import {Brand, brandOf} from '#routes/brand.tsx'
import {Chip} from '#routes/chip.tsx'
import type {Note} from '#services/notes/schema.ts'
import {colors, mono} from '@deslop/components/mobile/theme'

export function NoteRoute(props: {id: Note['id']; onTag: (tag: string) => void}) {
	return Option.match(
		Array.findFirst(useAtomSuspense(notesAtom).value.notes, note => note.id === props.id),
		{
			onNone: () => (
				<ContentUnavailableView
					title="gone"
					description="deleted, or joined to an earlier save of the same post"
					modifiers={[
						navigationTitle(''),
						navigationBarTitleDisplayMode('inline'),
						background(colors.background),
						mono('body', 14),
						foregroundStyle(colors.mutedForeground)
					]}
				/>
			),
			onSome: note => <Detail note={note} onTag={props.onTag} />
		}
	)
}

// Mounted only once the server has kept the preview, so the download never runs before the file exists. The whole
// image fits a box of one height, so every note's preview takes the same space and none is cropped.
export function Cover(props: {height: number; note: Note}) {
	const image = useAtomValue(imageAtom(props.note.id))
	if (!AsyncResult.isSuccess(image)) return undefined
	return (
		<Image
			uiImage={image.value}
			modifiers={[
				resizable(),
				aspectRatio({contentMode: 'fit'}),
				frame({maxHeight: props.height, maxWidth: Infinity, minHeight: props.height})
			]}
		/>
	)
}

function Detail(props: {note: Note; onTag: (tag: string) => void}) {
	const note = props.note
	// What the server read, folded so the note stays short: the words in the images, the page or post, what the video
	// says, and the original words of a written note.
	const folds = pipe(
		[
			{
				label: Option.match(Option.fromNullishOr(note.file), {onNone: () => 'on screen', onSome: () => 'text'}),
				text: note.screenText ?? ''
			},
			{label: 'source', text: note.content},
			{label: 'transcript', text: note.transcript ?? ''},
			{label: 'original', text: note.url === null && note.file === undefined ? note.text : ''}
		],
		Array.filter(fold => String.isNonEmpty(String.trim(fold.text)))
	)
	return (
		<Toolbar
			modifiers={[navigationTitle(note.title), navigationBarTitleDisplayMode('inline'), background(colors.background)]}
		>
			<ScrollView modifiers={[background(colors.background)]}>
				<VStack
					alignment="leading"
					spacing={14}
					modifiers={[padding({all: 16}), frame({alignment: 'leading', maxWidth: Infinity})]}
				>
					{note.image !== undefined && <Cover note={note} height={200} />}
					{String.isNonEmpty(note.summary) && (
						<Text modifiers={[mono('body', 14), foregroundStyle(colors.foreground), textSelection(true)]}>
							{note.summary}
						</Text>
					)}
					{!Array.isReadonlyArrayEmpty(note.tags) && (
						// One scrolling line of tags, so a tag never breaks across two lines.
						<ScrollView axes="horizontal" showsIndicators={false}>
							<HStack spacing={8}>
								{Array.map(note.tags, tag => (
									<Chip key={tag} label={tag} active={false} onPress={() => props.onTag(tag)} />
								))}
							</HStack>
						</ScrollView>
					)}
					{Option.match(Option.liftPredicate(note.body ?? '', String.isNonEmpty), {
						onNone: () => undefined,
						onSome: body => (
							<Text modifiers={[mono('body', 14), foregroundStyle(colors.foreground), textSelection(true)]}>
								{body}
							</Text>
						)
					})}
					{Array.map(folds, fold => (
						<Fold key={fold.label} label={fold.label} text={fold.text} />
					))}
					{String.isNonEmpty(note.issue) && (
						<Text modifiers={[mono('caption', 12), foregroundStyle(colors.mutedForeground)]}>{note.issue}</Text>
					)}
				</VStack>
			</ScrollView>
			{/* The link opens from the bar, in its own app when iOS knows one. */}
			{Option.match(Option.fromNullishOr(note.url), {
				onNone: () => undefined,
				onSome: url => (
					<Toolbar.Content>
						<ToolbarItem placement="topBarTrailing">
							{Option.match(brandOf(note), {
								onNone: () => (
									<Button
										label="Open Link"
										systemImage="arrow.up.right"
										onPress={() => Linking.openURL(url)}
										modifiers={[labelStyle('iconOnly')]}
									/>
								),
								onSome: brand => (
									<Button onPress={() => Linking.openURL(url)}>
										<Brand brand={brand} size={20} />
									</Button>
								)
							})}
						</ToolbarItem>
					</Toolbar.Content>
				)
			})}
		</Toolbar>
	)
}

// A muted label with a chevron that shows or hides a long text.
function Fold(props: {label: string; text: string}) {
	const [open, setOpen] = useState(false)
	return (
		<VStack alignment="leading" spacing={8}>
			<Button onPress={() => setOpen(!open)} modifiers={[buttonStyle('plain')]}>
				<HStack spacing={6}>
					<Image
						systemName={open ? 'chevron.down' : 'chevron.right'}
						size={11}
						modifiers={[foregroundStyle(colors.mutedForeground)]}
					/>
					<Text modifiers={[mono('caption', 12), foregroundStyle(colors.mutedForeground)]}>{props.label}</Text>
				</HStack>
			</Button>
			{open && (
				<Text modifiers={[mono('caption', 11), foregroundStyle(colors.mutedForeground), textSelection(true)]}>
					{props.text}
				</Text>
			)}
		</VStack>
	)
}
