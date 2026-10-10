import {useAtomSet, useAtomSuspense, useAtomValue} from '@effect/atom-react'

import {Array, Match, Option, String, pipe} from 'effect'

import {
	Button,
	ContentUnavailableView,
	ContextMenu,
	HStack,
	Image,
	List,
	ProgressView,
	ScrollView,
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
	controlSize,
	fixedSize,
	foregroundStyle,
	frame,
	lineLimit,
	listRowBackground,
	listRowInsets,
	listRowSeparator,
	listRowSeparatorTint,
	listStyle,
	navigationBarTitleDisplayMode,
	navigationTitle,
	padding,
	resizable,
	scrollContentBackground,
	searchable,
	searchToolbarBehavior,
	shapes,
	tint
} from '@expo/ui/swift-ui/modifiers'
import {AsyncResult} from 'effect/reactivity'
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
	// The tags as a row of chips: the most used first, or those that start with what follows a typed #.
	const tags = pipe(
		tagCounts(state.notes),
		Array.filter(entry =>
			pipe(
				Option.liftPredicate(props.search, String.startsWith('#')),
				Option.match({
					onNone: () => String.isEmpty(props.search),
					onSome: search => String.startsWith(String.slice(1)(String.trim(search)))(entry.tag)
				})
			)
		),
		Array.take(12)
	)
	const view = pipe(
		Match.value({
			nothingFound: String.isNonEmpty(String.trim(props.search)) && Array.isReadonlyArrayEmpty(notes),
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
				{!Array.isReadonlyArrayEmpty(tags) && (
					<ScrollView
						axes="horizontal"
						showsIndicators={false}
						modifiers={[
							...row,
							listRowSeparator('hidden'),
							listRowInsets({bottom: 4, leading: 16, top: 4, trailing: 16})
						]}
					>
						<HStack spacing={8}>
							{Array.map(tags, entry => (
								<Button
									key={entry.tag}
									onPress={() => props.onTag(entry.tag)}
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
										{`#${entry.tag} ${entry.count}`}
									</Text>
								</Button>
							))}
						</HStack>
					</ScrollView>
				)}
				{String.isEmpty(props.search) &&
					Array.map(pending, item => (
						<HStack key={item.id} alignment="top" spacing={12} modifiers={row}>
							<Placeholder symbol="arrow.up" />
							<VStack alignment="leading" spacing={4} modifiers={[frame({alignment: 'leading', maxWidth: Infinity})]}>
								<Text modifiers={[mono('subheadline', 13), foregroundStyle(colors.mutedForeground), lineLimit(1)]}>
									{item.text}
								</Text>
								<Spinner />
							</VStack>
						</HStack>
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
				// iOS 26's own search: a button at the bottom that opens the field above the keyboard.
				searchable(props.query, {onChange: props.onSearch, prompt: 'search or #tag'}),
				searchToolbarBehavior('minimize'),
				background(colors.background)
			]}
		>
			{view}
		</Toolbar>
	)
}

// Marks a capture the server is still reading, in place of its author and tags.
function Spinner() {
	return <ProgressView modifiers={[controlSize('mini'), tint(colors.mutedForeground)]} />
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
				{props.note.status === 'organizing' ? (
					<Spinner />
				) : (
					<HStack spacing={6}>
						<Text modifiers={[mono('caption', 11), foregroundStyle(colors.mutedForeground), lineLimit(1)]}>
							{String.toLowerCase(String.isNonEmpty(props.note.author) ? props.note.author : props.note.source)}
						</Text>
						<Text modifiers={[mono('caption', 11), foregroundStyle(colors.primary), lineLimit(1)]}>
							{pipe(
								props.note.tags,
								Array.map(tag => `#${tag}`),
								Array.join(' ')
							)}
						</Text>
					</HStack>
				)}
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
							<Button label="Open Link" systemImage="arrow.up.right" onPress={() => Linking.openURL(url)} />
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
