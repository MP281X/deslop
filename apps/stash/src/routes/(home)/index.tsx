import {useAtomSet, useAtomSuspense, useAtomValue} from '@effect/atom-react'

import {Array, Match, Option, String, pipe} from 'effect'

import {
	Button,
	ContentUnavailableView,
	ContextMenu,
	HStack,
	Image,
	List,
	SwipeActions,
	Text,
	Toolbar,
	ToolbarItem,
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
	searchToolbarBehavior,
	shapes
} from '@expo/ui/swift-ui/modifiers'
import {AsyncResult} from 'effect/reactivity'
import * as Clipboard from 'expo-clipboard'
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
				{String.isEmpty(props.search) &&
					Array.map(pending, item => (
						<HStack key={item.id} alignment="top" spacing={12} modifiers={row}>
							<Placeholder symbol="arrow.up" />
							<VStack alignment="leading" spacing={4}>
								<Text modifiers={[mono('subheadline', 13), foregroundStyle(colors.mutedForeground), lineLimit(1)]}>
									{item.text}
								</Text>
								<Text modifiers={[mono('caption', 11), foregroundStyle(colors.mutedForeground)]}>sending</Text>
							</VStack>
						</HStack>
					))}
				{Array.map(tags, entry => (
					<Button key={entry.tag} onPress={() => props.onTag(entry.tag)} modifiers={row}>
						<Text modifiers={[mono('subheadline', 13), foregroundStyle(colors.primary), lineLimit(1)]}>
							{`#${entry.tag} (${entry.count})`}
						</Text>
					</Button>
				))}
				{/* Plain rows, not List.ForEach: its row wrapper hides the row background and swipe actions from the list. */}
				{Array.map(notes, note => (
					<Row key={note.id} note={note} onOpen={props.onOpen} onRemove={id => remove(id)} />
				))}
			</List>
		))
	)

	return (
		<Toolbar
			modifiers={[
				navigationTitle(''),
				navigationBarTitleDisplayMode('inline'),
				searchable(props.query, {onChange: props.onSearch, prompt: 'search or #tag'}),
				searchToolbarBehavior('minimize'),
				background(colors.background)
			]}
		>
			{view}
			<Toolbar.Content>
				<ToolbarItem placement="principal">
					<Text modifiers={[mono('headline', 15), foregroundStyle(colors.foreground)]}>stash</Text>
				</ToolbarItem>
			</Toolbar.Content>
		</Toolbar>
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
					{/* A plain button opens the note without a list chevron. A note still being read can join an older note of
					the same post, so it opens once it is read. */}
					<Button
						onPress={() => {
							if (props.note.status !== 'organizing') props.onOpen(props.note.id)
						}}
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
