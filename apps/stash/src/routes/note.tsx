import {useAtomSet, useAtomSuspense, useAtomValue} from '@effect/atom-react'

import {Array, DateTime, Option, String, pipe} from 'effect'

import {
	Button,
	ContentUnavailableView,
	HStack,
	Image,
	ScrollView,
	ShareLink,
	Text,
	Toolbar,
	ToolbarItem,
	VStack,
	ZStack
} from '@expo/ui/swift-ui'
import {
	aspectRatio,
	background,
	buttonStyle,
	clipShape,
	disabled,
	foregroundStyle,
	frame,
	labelStyle,
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

import {imageAtom, notesAtom, removeAtom} from '#lib/utils.ts'
import {Brand, brandOf, kindOf, kinds} from '#routes/brand.tsx'
import {Chip} from '#routes/chip.tsx'
import type {Note} from '#services/notes/schema.ts'
import {colors, mono} from '@deslop/components/mobile/theme'

const page = [navigationTitle(''), navigationBarTitleDisplayMode('inline'), background(colors.background)]

export function NoteRoute(props: {
	id: Note['id']
	onClose: () => void
	onOpen: (id: Note['id']) => void
	onTag: (tag: string) => void
}) {
	const notes = useAtomSuspense(notesAtom).value.notes
	const index = Array.findFirstIndex(notes, note => note.id === props.id)
	return Option.match(
		Option.flatMap(index, position => Array.get(notes, position)),
		{
			onNone: () => (
				<ContentUnavailableView
					title="gone"
					description="deleted, or joined to an earlier save of the same post"
					modifiers={[...page, mono('body', 14), foregroundStyle(colors.mutedForeground)]}
				/>
			),
			onSome: note => (
				<Detail
					note={note}
					previous={pipe(
						index,
						Option.flatMap(position => Array.get(notes, position - 1)),
						Option.map(item => item.id)
					)}
					next={pipe(
						index,
						Option.flatMap(position => Array.get(notes, position + 1)),
						Option.map(item => item.id)
					)}
					onClose={props.onClose}
					onOpen={props.onOpen}
					onTag={props.onTag}
				/>
			)
		}
	)
}

// Mounted only once the server has kept the preview, so the download never runs before the file exists. The whole
// image fits a box of one height, so every note's preview takes the same space and none is cropped.
function Cover(props: {height: number; note: Note}) {
	const image = useAtomValue(imageAtom(props.note.id))
	if (!AsyncResult.isSuccess(image)) return undefined
	return (
		<Image
			uiImage={image.value}
			modifiers={[
				resizable(),
				aspectRatio({contentMode: 'fit'}),
				frame({maxHeight: props.height, maxWidth: Infinity, minHeight: props.height}),
				background(colors.muted)
			]}
		/>
	)
}

// The AI's notes: lines that start with "- " become bullets with a hanging indent, other lines stay paragraphs.
function Body(props: {text: string}) {
	return (
		<VStack alignment="leading" spacing={8} modifiers={[frame({alignment: 'leading', maxWidth: Infinity})]}>
			{pipe(
				props.text,
				String.split('\n'),
				Array.map(String.trim),
				Array.filter(String.isNonEmpty),
				Array.map(line =>
					String.startsWith('- ')(line) ? (
						<HStack key={line} alignment="top" spacing={8}>
							<Text modifiers={[mono('body', 14), foregroundStyle(colors.mutedForeground)]}>•</Text>
							<Text
								modifiers={[
									mono('body', 14),
									foregroundStyle(colors.foreground),
									textSelection(true),
									frame({alignment: 'leading', maxWidth: Infinity})
								]}
							>
								{String.slice(2)(line)}
							</Text>
						</HStack>
					) : (
						<Text key={line} modifiers={[mono('body', 14), foregroundStyle(colors.foreground), textSelection(true)]}>
							{line}
						</Text>
					)
				)
			)}
		</VStack>
	)
}

// The page reads like a message in iOS Mail: who it comes from, the full title, the tags, the preview and the AI's
// notes. The bar moves to the previous or next note; the bottom bar deletes, shares and opens it.
function Detail(props: {
	next: Option.Option<Note['id']>
	note: Note
	onClose: () => void
	onOpen: (id: Note['id']) => void
	onTag: (tag: string) => void
	previous: Option.Option<Note['id']>
}) {
	const note = props.note
	const remove = useAtomSet(removeAtom)
	const kind = Array.findFirst(kinds, entry => entry.kind === kindOf(note))
	const kindLabel = Option.match(kind, {onNone: () => 'Web', onSome: entry => entry.label})
	const saved = DateTime.format({day: 'numeric', locale: 'en', month: 'short'})(DateTime.makeUnsafe(note.createdAt))
	// Folded so the note stays short: what the video says, and the original words of a written note.
	const folds = pipe(
		[
			{label: 'transcript', text: note.transcript ?? ''},
			{label: 'original', text: note.url === null && note.file === undefined ? note.text : ''}
		],
		Array.filter(fold => String.isNonEmpty(String.trim(fold.text)))
	)
	return (
		<Toolbar modifiers={page}>
			<ScrollView modifiers={[background(colors.background)]}>
				<VStack
					alignment="leading"
					spacing={14}
					modifiers={[padding({all: 16}), frame({alignment: 'leading', maxWidth: Infinity})]}
				>
					<HStack spacing={10}>
						<ZStack modifiers={[frame({height: 36, width: 36}), background(colors.muted), clipShape('circle')]}>
							{Option.match(brandOf(note), {
								onNone: () => (
									<Image
										systemName={Option.match(kind, {onNone: () => 'globe' as const, onSome: entry => entry.symbol})}
										size={15}
										modifiers={[foregroundStyle(colors.foreground)]}
									/>
								),
								onSome: brand => <Brand brand={brand} size={18} />
							})}
						</ZStack>
						<VStack alignment="leading" spacing={2}>
							<Text modifiers={[mono('headline', 14), foregroundStyle(colors.foreground), lineLimit(1)]}>
								{String.toLowerCase(String.isNonEmpty(note.author) ? note.author : kindLabel)}
							</Text>
							<Text modifiers={[mono('caption', 12), foregroundStyle(colors.mutedForeground), lineLimit(1)]}>
								{`${kindLabel} · ${saved}`}
							</Text>
						</VStack>
					</HStack>
					<Text modifiers={[mono('headline', 18), foregroundStyle(colors.foreground), textSelection(true)]}>
						{note.title}
					</Text>
					{String.isNonEmpty(note.summary) && (
						<Text modifiers={[mono('body', 14), foregroundStyle(colors.mutedForeground), textSelection(true)]}>
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
					{note.image !== undefined && <Cover note={note} height={200} />}
					{Option.match(Option.liftPredicate(note.body ?? '', String.isNonEmpty), {
						onNone: () => undefined,
						onSome: body => <Body text={body} />
					})}
					{Array.map(folds, fold => (
						<Fold key={fold.label} label={fold.label} text={fold.text} />
					))}
					{String.isNonEmpty(note.issue) && (
						<Text modifiers={[mono('caption', 12), foregroundStyle(colors.mutedForeground)]}>{note.issue}</Text>
					)}
				</VStack>
			</ScrollView>
			<Toolbar.Content>
				<ToolbarItem placement="topBarTrailing">
					<Button
						label="Previous"
						systemImage="chevron.up"
						onPress={() => Option.match(props.previous, {onNone: () => undefined, onSome: props.onOpen})}
						modifiers={[labelStyle('iconOnly'), disabled(Option.isNone(props.previous))]}
					/>
				</ToolbarItem>
				<ToolbarItem placement="topBarTrailing">
					<Button
						label="Next"
						systemImage="chevron.down"
						onPress={() => Option.match(props.next, {onNone: () => undefined, onSome: props.onOpen})}
						modifiers={[labelStyle('iconOnly'), disabled(Option.isNone(props.next))]}
					/>
				</ToolbarItem>
				<ToolbarItem placement="bottomBar">
					<Button
						label="Delete"
						systemImage="trash"
						onPress={() => {
							remove(note.id)
							props.onClose()
						}}
						modifiers={[labelStyle('iconOnly')]}
					/>
				</ToolbarItem>
				<ToolbarItem placement="bottomBar" kind="spacer" />
				{Option.match(Option.fromNullishOr(note.url), {
					onNone: () => undefined,
					onSome: url => (
						<>
							<ToolbarItem placement="bottomBar">
								<ShareLink item={url} />
							</ToolbarItem>
							{/* The link opens in its own app when iOS knows one. */}
							<ToolbarItem placement="bottomBar">
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
						</>
					)
				})}
			</Toolbar.Content>
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
