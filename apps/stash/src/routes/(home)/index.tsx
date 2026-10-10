import {useAtomSet, useAtomSuspense, useAtomValue} from '@effect/atom-react'

import {Array, Match, Option, String, pipe} from 'effect'

import {
	Button,
	ContentUnavailableView,
	ContextMenu,
	HStack,
	Image,
	List,
	Section,
	Spacer,
	SwipeActions,
	Text,
	Toolbar,
	VStack
} from '@expo/ui/swift-ui'
import type {useNativeState} from '@expo/ui/swift-ui'
import {
	aspectRatio,
	background,
	border,
	buttonStyle,
	clipped,
	contentShape,
	foregroundStyle,
	frame,
	lineLimit,
	listRowBackground,
	listRowInsets,
	listRowSeparatorTint,
	listStyle,
	navigationBarTitleDisplayMode,
	navigationTitle,
	resizable,
	scrollContentBackground,
	searchable,
	shapes
} from '@expo/ui/swift-ui/modifiers'
import {AsyncResult} from 'effect/reactivity'
import * as Clipboard from 'expo-clipboard'
import {useState} from 'react'
import {Linking} from 'react-native'

import {colors, mono} from '#lib/theme.ts'
import {imageAtom, notesAtom, pendingAtom, removeAtom} from '#lib/utils.ts'
import {findNotes, tagCounts} from '#services/notes/lib/utils.ts'
import type {Note} from '#services/notes/schema.ts'

const row = [
	listRowBackground(colors.background),
	listRowSeparatorTint(colors.border),
	listRowInsets({bottom: 10, leading: 16, top: 10, trailing: 16})
]

// The list is the whole app: links arrive from the share sheet or the clipboard, so there are no buttons.
export function NotesRoute(props: {
	onOpen: (id: Note['id']) => void
	onSearch: (text: string) => void
	onTag: (tag: string) => void
	query: ReturnType<typeof useNativeState<string>>
	search: string
}) {
	const state = useAtomSuspense(notesAtom).value
	const pending = useAtomSuspense(pendingAtom).value
	const remove = useAtomSet(removeAtom)
	const notes = findNotes(state.notes, props.search)
	const organizing = Array.filter(notes, note => note.status === 'organizing')
	const saved = Array.filter(notes, note => note.status !== 'organizing')
	const reading = organizing.length + (String.isEmpty(props.search) ? pending.length : 0)
	const [readingOpen, setReadingOpen] = useState(true)
	const [savedOpen, setSavedOpen] = useState(true)
	// Typing # lists the tags that start with the rest of the word.
	const tags = pipe(
		Option.liftPredicate(props.search, String.startsWith('#')),
		Option.map(search =>
			Array.filter(tagCounts(state.notes), entry => String.startsWith(String.slice(1)(search))(entry.tag))
		),
		Option.getOrElse(() => [])
	)
	const view = pipe(
		Match.value({
			nothingFound:
				String.isNonEmpty(String.trim(props.search)) &&
				Array.isReadonlyArrayEmpty(notes) &&
				Array.isReadonlyArrayEmpty(tags),
			nothingSaved: Array.isReadonlyArrayEmpty(state.notes) && Array.isReadonlyArrayEmpty(pending)
		}),
		Match.when({nothingSaved: true}, () => (
			<ContentUnavailableView
				title="nothing saved"
				description="share a link to stash, or copy one and open the app"
				modifiers={[mono('body', 14), foregroundStyle(colors.mutedForeground)]}
			/>
		)),
		Match.when({nothingFound: true}, () => (
			<ContentUnavailableView
				title="no matches"
				description="every word must match; #tag matches a tag"
				modifiers={[mono('body', 14), foregroundStyle(colors.mutedForeground)]}
			/>
		)),
		Match.orElse(() => (
			<List modifiers={[listStyle('plain'), scrollContentBackground('hidden'), background(colors.background)]}>
				{Array.map(tags, entry => (
					<Button key={entry.tag} onPress={() => props.onTag(entry.tag)} modifiers={row}>
						<Text modifiers={[mono('subheadline', 13), foregroundStyle(colors.primary), lineLimit(1)]}>
							{`#${entry.tag} (${entry.count})`}
						</Text>
					</Button>
				))}
				{/* Captures still sending or being read sit apart, so the saved list grows only with finished notes. */}
				{reading > 0 && (
					<Section header={<Shelf label="reading" count={reading} open={readingOpen} onToggle={setReadingOpen} />}>
						{readingOpen && [
							...Array.map(String.isEmpty(props.search) ? pending : [], item => (
								<HStack key={item.id} alignment="top" spacing={12} modifiers={row}>
									<Placeholder symbol="arrow.up" />
									<VStack alignment="leading" spacing={4}>
										<Text modifiers={[mono('subheadline', 13), foregroundStyle(colors.mutedForeground), lineLimit(1)]}>
											{item.text}
										</Text>
										<Text modifiers={[mono('caption', 11), foregroundStyle(colors.mutedForeground)]}>sending</Text>
									</VStack>
								</HStack>
							)),
							...Array.map(organizing, note => (
								<Row key={note.id} note={note} onOpen={props.onOpen} onRemove={id => remove(id)} />
							))
						]}
					</Section>
				)}
				{/* Plain rows, not List.ForEach: its row wrapper hides the row background and swipe actions from the list. */}
				<Section
					header={
						reading > 0 ? (
							<Shelf label="saved" count={saved.length} open={savedOpen} onToggle={setSavedOpen} />
						) : undefined
					}
				>
					{(savedOpen || reading === 0) &&
						Array.map(saved, note => (
							<Row key={note.id} note={note} onOpen={props.onOpen} onRemove={id => remove(id)} />
						))}
				</Section>
			</List>
		))
	)

	return (
		<Toolbar
			modifiers={[
				navigationTitle(''),
				navigationBarTitleDisplayMode('inline'),
				// The field hides in the bar until the list is pulled down, like Home Screen search.
				searchable(props.query, {onChange: props.onSearch, placement: 'navigationBarDrawer', prompt: 'search or #tag'}),
				background(colors.background)
			]}
		>
			{view}
		</Toolbar>
	)
}

// A section header in the style of T3 Code's thread list: a muted label with its count, and a chevron that folds it.
function Shelf(props: {count: number; label: string; onToggle: (open: boolean) => void; open: boolean}) {
	return (
		<Button
			onPress={() => props.onToggle(!props.open)}
			modifiers={[buttonStyle('plain'), contentShape(shapes.rectangle())]}
		>
			<HStack spacing={6}>
				<Text modifiers={[mono('caption', 11), foregroundStyle(colors.mutedForeground)]}>
					{`${props.label} ${props.count}`}
				</Text>
				<Spacer />
				<Image
					systemName={props.open ? 'chevron.down' : 'chevron.right'}
					size={11}
					modifiers={[foregroundStyle(colors.mutedForeground)]}
				/>
			</HStack>
		</Button>
	)
}

function Placeholder(props: {symbol: 'arrow.up' | 'globe' | 'play.rectangle' | 'text.alignleft' | 'xmark'}) {
	return (
		<Image
			systemName={props.symbol}
			size={16}
			modifiers={[
				foregroundStyle(colors.mutedForeground),
				frame({height: 48, width: 48}),
				border({color: colors.border, width: 1})
			]}
		/>
	)
}

// The kept preview, or a symbol for the source while it loads or when the link has none.
function Preview(props: {note: Note}) {
	const symbol = pipe(
		Match.value(props.note.source),
		Match.when('TikTok', () => 'play.rectangle' as const),
		Match.when('X', () => 'xmark' as const),
		Match.when('Website', () => 'globe' as const),
		Match.orElse(() => 'text.alignleft' as const)
	)
	if (props.note.image === undefined) return <Placeholder symbol={symbol} />
	return <Thumbnail note={props.note} symbol={symbol} />
}

// Mounted only once the server has kept the preview, so the download never runs before the file exists.
function Thumbnail(props: {note: Note; symbol: Parameters<typeof Placeholder>[0]['symbol']}) {
	const image = useAtomValue(imageAtom(props.note.id))
	if (!AsyncResult.isSuccess(image)) return <Placeholder symbol={props.symbol} />
	return (
		<Image
			uiImage={image.value}
			modifiers={[
				resizable(),
				aspectRatio({contentMode: 'fill'}),
				frame({height: props.note.source === 'TikTok' ? 64 : 48, width: 48}),
				clipped()
			]}
		/>
	)
}

function Row(props: {note: Note; onOpen: (id: Note['id']) => void; onRemove: (id: Note['id']) => void}) {
	const meta = pipe(
		[
			String.toLowerCase(String.isNonEmpty(props.note.author) ? props.note.author : props.note.source),
			props.note.status === 'organizing' ? 'reading…' : ''
		],
		Array.filter(String.isNonEmpty),
		Array.join(' · ')
	)
	const content = (
		<HStack alignment="top" spacing={12}>
			<Preview note={props.note} />
			<VStack alignment="leading" spacing={4} modifiers={[frame({alignment: 'leading', maxWidth: Infinity})]}>
				<Text modifiers={[mono('headline', 14), foregroundStyle(colors.foreground), lineLimit(1)]}>
					{props.note.title}
				</Text>
				{String.isNonEmpty(props.note.summary) && (
					<Text modifiers={[mono('subheadline', 12), foregroundStyle(colors.mutedForeground), lineLimit(1)]}>
						{props.note.summary}
					</Text>
				)}
				<HStack spacing={6}>
					<Text modifiers={[mono('caption', 11), foregroundStyle(colors.mutedForeground), lineLimit(1)]}>{meta}</Text>
					<Text modifiers={[mono('caption', 11), foregroundStyle(colors.primary), lineLimit(1)]}>
						{pipe(
							props.note.tags,
							Array.map(tag => `#${tag}`),
							Array.join(' ')
						)}
					</Text>
				</HStack>
			</VStack>
		</HStack>
	)
	return (
		<SwipeActions modifiers={row}>
			<ContextMenu>
				<ContextMenu.Trigger>
					{/* A plain button opens the note without a list chevron. */}
					<Button
						onPress={() => props.onOpen(props.note.id)}
						modifiers={[buttonStyle('plain'), contentShape(shapes.rectangle())]}
					>
						{content}
					</Button>
				</ContextMenu.Trigger>
				<ContextMenu.Items>
					{Option.match(Option.fromNullishOr(props.note.url), {
						onNone: () => undefined,
						onSome: url => (
							<>
								<Button label="Open Link" systemImage="safari" onPress={() => Linking.openURL(url)} />
								<Button label="Copy Link" systemImage="doc.on.doc" onPress={() => Clipboard.setStringAsync(url)} />
							</>
						)
					})}
					<Button label="Delete" systemImage="trash" role="destructive" onPress={() => props.onRemove(props.note.id)} />
				</ContextMenu.Items>
			</ContextMenu>
			<SwipeActions.Actions edge="trailing">
				<Button label="Delete" systemImage="trash" role="destructive" onPress={() => props.onRemove(props.note.id)} />
			</SwipeActions.Actions>
		</SwipeActions>
	)
}
