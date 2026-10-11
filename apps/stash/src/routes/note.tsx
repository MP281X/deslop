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
	foregroundStyle,
	frame,
	labelStyle,
	navigationBarTitleDisplayMode,
	navigationTitle,
	padding,
	redacted,
	resizable,
	textSelection
} from '@expo/ui/swift-ui/modifiers'
import {AsyncResult} from 'effect/reactivity'
import {Linking} from 'react-native'

import {imageAtom, noteAtom, notesAtom} from '#lib/utils.ts'
import {Brand, brandOf} from '#routes/brand.tsx'
import {Chip} from '#routes/chip.tsx'
import type {Note, NoteItem} from '#services/notes/schema.ts'
import {colors, mono} from '@deslop/components/mobile/theme'

// The note's title stays in the bar, cut short by the system when it runs long; the app button opens the link.
export function NoteRoute(props: {id: Note['id']; onTag: (tag: string) => void}) {
	return Option.match(
		Array.findFirst(useAtomSuspense(notesAtom).value.items, item => item.id === props.id),
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
			onSome: item => (
				<Toolbar
					modifiers={[
						navigationTitle(item.status === 'organizing' ? '' : item.title),
						navigationBarTitleDisplayMode('inline'),
						background(colors.background)
					]}
				>
					<Detail note={item} onTag={props.onTag} />
					{/* The link opens in its own app, named by its logo, when iOS knows one. */}
					{Option.match(Option.fromNullishOr(item.url), {
						onNone: () => undefined,
						onSome: url => (
							<Toolbar.Content>
								<ToolbarItem placement="topBarTrailing">
									{Option.match(brandOf(item), {
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
	)
}

// Mounted only once the server has kept the preview, so the download never runs before the file exists. The image
// keeps its own shape up to 280 points tall, with no box around it.
function Cover(props: {note: NoteItem}) {
	const image = useAtomValue(imageAtom(props.note.id))
	if (!AsyncResult.isSuccess(image)) return undefined
	return (
		<Image
			uiImage={image.value}
			modifiers={[resizable(), aspectRatio({contentMode: 'fit'}), frame({maxHeight: 280, maxWidth: Infinity})]}
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

// The page under the title: the preview, the tags and one summary. The list fields show at once; the AI's notes arrive
// with the full note from the server.
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
				{note.image !== undefined && <Cover note={note} />}
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
				{/* One summary: the AI's notes, or the one-line summary while they load or when a note has none. */}
				{note.status !== 'organizing' &&
					Option.match(
						Option.flatMap(full, loaded => Option.liftPredicate(loaded.body ?? '', String.isNonEmpty)),
						{
							onNone: () => (
								<Text modifiers={[mono('body', 14), foregroundStyle(colors.foreground), textSelection(true)]}>
									{note.summary}
								</Text>
							),
							onSome: body => <Body text={body} />
						}
					)}
				{String.isNonEmpty(note.issue) && (
					<Text modifiers={[mono('caption', 12), foregroundStyle(colors.mutedForeground)]}>{note.issue}</Text>
				)}
			</VStack>
		</ScrollView>
	)
}
