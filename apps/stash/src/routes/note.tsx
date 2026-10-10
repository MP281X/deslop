import {useAtomSet, useAtomSuspense, useAtomValue} from '@effect/atom-react'

import {Array, Option, String, pipe} from 'effect'

import {
	Button,
	ContentUnavailableView,
	HStack,
	Image,
	ScrollView,
	TabView,
	Text,
	Toolbar,
	ToolbarItem,
	VStack
} from '@expo/ui/swift-ui'
import {
	aspectRatio,
	background,
	foregroundStyle,
	frame,
	labelStyle,
	navigationBarTitleDisplayMode,
	navigationTitle,
	padding,
	redacted,
	resizable,
	tabViewStyle,
	textSelection
} from '@expo/ui/swift-ui/modifiers'
import {AsyncResult} from 'effect/reactivity'
import {useState} from 'react'
import {Linking} from 'react-native'

import {imageAtom, noteAtom, notesAtom, removeAtom} from '#lib/utils.ts'
import {Brand, brandOf} from '#routes/brand.tsx'
import {Chip} from '#routes/chip.tsx'
import type {Note, NoteItem} from '#services/notes/schema.ts'
import {colors, mono} from '@deslop/components/mobile/theme'

const page = [navigationTitle(''), navigationBarTitleDisplayMode('inline'), background(colors.background)]

// A swipe left or right moves to the next or previous note, as pages; only the shown note and its two neighbours
// mount, so thousands of notes cost three pages. The bottom bar deletes the shown note or opens it in its app.
export function NoteRoute(props: {id: Note['id']; onClose: () => void; onTag: (tag: string) => void}) {
	const notes = useAtomSuspense(notesAtom).value.items
	const remove = useAtomSet(removeAtom)
	// The page swiped to, or the note the list opened.
	const [swiped, setSwiped] = useState(() => Option.none<Note['id']>())
	const current = Option.getOrElse(swiped, () => props.id)
	const index = Array.findFirstIndex(notes, note => note.id === current)
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
				<Toolbar modifiers={page}>
					<TabView
						selection={note.id}
						onSelectionChange={id => setSwiped(Option.some(id))}
						modifiers={[tabViewStyle({indexDisplayMode: 'never', type: 'page'}), background(colors.background)]}
					>
						{pipe(
							index,
							Option.match({
								onNone: () => [note],
								onSome: position =>
									Array.flatMap([position - 1, position, position + 1], at => Option.toArray(Array.get(notes, at)))
							}),
							Array.map(item => (
								<TabView.Tab key={item.id} value={item.id}>
									<Detail note={item} onTag={props.onTag} />
								</TabView.Tab>
							))
						)}
					</TabView>
					<Toolbar.Content>
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
						{/* The link opens in its own app, named by its logo, when iOS knows one. */}
						{Option.match(Option.fromNullishOr(note.url), {
							onNone: () => undefined,
							onSome: url => (
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
							)
						})}
					</Toolbar.Content>
				</Toolbar>
			)
		}
	)
}

// Mounted only once the server has kept the preview, so the download never runs before the file exists. The image
// keeps its own shape up to 220 points tall, with no box around it.
function Cover(props: {note: NoteItem}) {
	const image = useAtomValue(imageAtom(props.note.id))
	if (!AsyncResult.isSuccess(image)) return undefined
	return (
		<Image
			uiImage={image.value}
			modifiers={[resizable(), aspectRatio({contentMode: 'fit'}), frame({maxHeight: 220, maxWidth: Infinity})]}
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

// One page: the full title, summary, tags, the preview and the AI's notes. The list fields show at once; the long texts
// arrive with the full note from the server.
function Detail(props: {note: NoteItem; onTag: (tag: string) => void}) {
	const note = props.note
	const full = pipe(
		useAtomValue(noteAtom(`${note.id} ${note.status} ${note.title}`)),
		AsyncResult.getOrElse(() => undefined),
		Option.fromNullishOr
	)
	return (
		<ScrollView modifiers={[background(colors.background)]}>
			<VStack
				alignment="leading"
				spacing={14}
				modifiers={[padding({all: 16}), frame({alignment: 'leading', maxWidth: Infinity})]}
			>
				{/* While the server reads the note, its lines show as the system's gray placeholder bars. */}
				{note.status === 'organizing' && (
					<VStack alignment="leading" spacing={10} modifiers={[redacted('placeholder')]}>
						<Text modifiers={[mono('headline', 18), foregroundStyle(colors.foreground)]}>
							Reading the link and writing
						</Text>
						<Text modifiers={[mono('body', 14), foregroundStyle(colors.mutedForeground)]}>
							The summary arrives once the note is tagged, in a minute or two.
						</Text>
						<Text modifiers={[mono('body', 14), foregroundStyle(colors.foreground)]}>
							The notes list the point and the takeaways of the post.
						</Text>
					</VStack>
				)}
				{note.status !== 'organizing' && (
					<Text modifiers={[mono('headline', 18), foregroundStyle(colors.foreground), textSelection(true)]}>
						{note.title}
					</Text>
				)}
				{note.status !== 'organizing' && String.isNonEmpty(note.summary) && (
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
				{note.image !== undefined && <Cover note={note} />}
				{Option.match(
					Option.flatMap(full, loaded => Option.liftPredicate(loaded.body ?? '', String.isNonEmpty)),
					{onNone: () => undefined, onSome: body => <Body text={body} />}
				)}
				{String.isNonEmpty(note.issue) && (
					<Text modifiers={[mono('caption', 12), foregroundStyle(colors.mutedForeground)]}>{note.issue}</Text>
				)}
			</VStack>
		</ScrollView>
	)
}
