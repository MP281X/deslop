import {useAtomSet, useAtomSuspense, useAtomValue} from '@effect/atom-react'

import {Array, HashSet, Match, Option, String, pipe} from 'effect'

import {
	Button,
	ContentUnavailableView,
	ContextMenu,
	HStack,
	Image,
	List,
	Menu,
	ScrollView,
	SwipeActions,
	Text,
	Toolbar,
	ToolbarItem,
	VStack,
	ZStack
} from '@expo/ui/swift-ui'
import type {useNativeState} from '@expo/ui/swift-ui'
import {
	alignmentGuide,
	aspectRatio,
	background,
	border,
	clipped,
	contentShape,
	cornerRadius,
	foregroundStyle,
	frame,
	labelStyle,
	lineLimit,
	listRowBackground,
	listRowInsets,
	listRowSeparator,
	listRowSeparatorTint,
	listStyle,
	navigationBarTitleDisplayMode,
	navigationTitle,
	onAppear,
	onTapGesture,
	redacted,
	resizable,
	scrollContentBackground,
	searchable,
	shapes,
	tag,
	tint
} from '@expo/ui/swift-ui/modifiers'
import {AsyncResult} from 'effect/reactivity'
import {useState} from 'react'
import {Linking} from 'react-native'

import {assetAtom, imageAtom, notesAtom, pendingAtom, removeAtom, searchAtom} from '#lib/utils.ts'
import {Brand, MenuAction, brandOf, kindOf, kinds} from '#routes/brand.tsx'
import type {Kind} from '#routes/brand.tsx'
import {Chip} from '#routes/chip.tsx'
import logo from '#routes/logo.png'
import {tagCounts} from '#services/notes/lib/utils.ts'
import type {Note, NoteItem} from '#services/notes/schema.ts'
import {colors, mono} from '@deslop/components/mobile/theme'

const row = [
	listRowBackground(colors.background),
	listRowSeparatorTint(colors.border),
	listRowInsets({bottom: 10, leading: 16, top: 10, trailing: 16})
]

// Separators run under the thumbnails too, from the row's leading edge.
const fullSeparator = alignmentGuide('listRowSeparatorLeading', 0)

// Every list thumbnail has this size, so rows line up whatever the shape of the preview.
const thumbnail = 56

// The list follows iOS Mail: tag chips that filter apart from search, the filter menu, search field and write
// button at the bottom, and the system menu on a long press.
export function NotesRoute(props: {
	kind: Kind | ''
	onCompose: () => void
	onKind: (kind: Kind | '') => void
	onOpen: (id: Note['id']) => void
	onSearch: (text: string) => void
	onTag: (name: string) => void
	query: ReturnType<typeof useNativeState<string>>
	search: string
	tag: string
}) {
	const state = useAtomSuspense(notesAtom).value
	const pending = useAtomSuspense(pendingAtom).value
	const remove = useAtomSet(removeAtom)
	const query = String.trim(props.search)
	const found = useAtomValue(searchAtom(query))
	// The server searches transcripts and pages; until it answers, titles, summaries and tags narrow the list.
	const words = pipe(query, String.toLowerCase, String.split(/\s+/u), Array.filter(String.isNonEmpty))
	const searched = Array.filter(state.items, item => {
		if (Array.isReadonlyArrayEmpty(words)) return true
		if (AsyncResult.isSuccess(found)) return HashSet.has(found.value, item.id)
		const haystack = String.toLowerCase(
			Array.join([item.title, item.summary, item.author, item.topics ?? '', ...item.tags], ' ')
		)
		return Array.every(words, word => String.includes(word)(haystack))
	})
	const notes = Array.filter(
		searched,
		note =>
			(String.isEmpty(props.tag) || Array.contains(note.tags, props.tag)) &&
			(props.kind === '' || kindOf(note) === props.kind)
	)
	const tags = Array.map(tagCounts(state.items), entry => entry.tag)
	// Rows mount in pages as the list scrolls, so thousands of notes never build at once.
	const [limit, setLimit] = useState(80)
	const filtered = String.isNonEmpty(props.search) || String.isNonEmpty(props.tag) || props.kind !== ''

	const list = (
		<List modifiers={[listStyle('plain'), scrollContentBackground('hidden'), background(colors.background)]}>
			{Array.isReadonlyArrayNonEmpty(tags) && (
				<ScrollView
					axes="horizontal"
					showsIndicators={false}
					modifiers={[
						...row,
						listRowSeparator('hidden'),
						listRowInsets({bottom: 6, leading: 16, top: 4, trailing: 16})
					]}
				>
					<HStack spacing={8}>
						<Chip label="all" systemImage="tray" active={String.isEmpty(props.tag)} onPress={() => props.onTag('')} />
						{Array.map(tags, name => (
							<Chip
								key={name}
								label={name}
								active={props.tag === name}
								onPress={() => props.onTag(props.tag === name ? '' : name)}
							/>
						))}
					</HStack>
				</ScrollView>
			)}
			{filtered && Array.isReadonlyArrayEmpty(notes) && (
				<Text
					modifiers={[...row, listRowSeparator('hidden'), mono('body', 13), foregroundStyle(colors.mutedForeground)]}
				>
					no matches
				</Text>
			)}
			{!filtered &&
				Array.map(pending, item => (
					<HStack key={item.id} alignment="top" spacing={12} modifiers={[...row, fullSeparator]}>
						<Placeholder symbol="arrow.up" />
						<Skeleton />
					</HStack>
				))}
			{/* Plain rows, not List.ForEach: its row wrapper hides the row background and swipe actions from the list. */}
			{Array.map(Array.take(notes, limit), (note, position) => (
				<Row
					key={note.id}
					note={note}
					onAppear={() => {
						if (position === limit - 1) setLimit(limit + 80)
					}}
					onOpen={props.onOpen}
					onRemove={id => remove(id)}
				/>
			))}
		</List>
	)

	return (
		<Toolbar
			modifiers={[
				navigationTitle('stash'),
				navigationBarTitleDisplayMode('inline'),
				searchable(props.query, {onChange: props.onSearch, prompt: 'Search'}),
				background(colors.background)
			]}
		>
			{Array.isReadonlyArrayEmpty(state.items) && Array.isReadonlyArrayEmpty(pending) ? (
				<ContentUnavailableView
					title="nothing saved"
					description="share a link to stash, or copy one and open the app"
					modifiers={[mono('body', 14), foregroundStyle(colors.mutedForeground)]}
				/>
			) : (
				list
			)}
			<Toolbar.Content>
				<ToolbarItem placement="principal">
					<Title />
				</ToolbarItem>
				{/* Fixed spacers part the filter, the search field and write into separate glass shapes, as in Mail. */}
				<>
					<ToolbarItem placement="bottomBar">
						<Filter kind={props.kind} onKind={props.onKind} />
					</ToolbarItem>
					<ToolbarItem placement="bottomBar" kind="fixed-spacer" />
					<ToolbarItem placement="bottomBar" kind="search" />
					<ToolbarItem placement="bottomBar" kind="fixed-spacer" />
					<ToolbarItem placement="bottomBar">
						<Button
							label="Write"
							systemImage="square.and.pencil"
							onPress={props.onCompose}
							modifiers={[labelStyle('iconOnly')]}
						/>
					</ToolbarItem>
				</>
			</Toolbar.Content>
		</Toolbar>
	)
}

// Mail's filter button: a menu of note kinds, the active one checked; the symbol fills while a filter is on.
function Filter(props: {kind: Kind | ''; onKind: (kind: Kind | '') => void}) {
	return (
		<Menu
			label="Filter"
			systemImage={props.kind === '' ? 'line.3.horizontal.decrease' : 'line.3.horizontal.decrease.circle.fill'}
			modifiers={[labelStyle('iconOnly')]}
		>
			<Button
				label="All Notes"
				systemImage={props.kind === '' ? 'checkmark' : 'tray'}
				onPress={() => props.onKind('')}
			/>
			{Array.map(kinds, entry => (
				<MenuAction
					key={entry.kind}
					label={entry.label}
					brand={pipe(
						Option.fromNullishOr('brand' in entry ? entry.brand : undefined),
						Option.filter(() => props.kind !== entry.kind)
					)}
					symbol={props.kind === entry.kind ? 'checkmark' : entry.symbol}
					onPress={() => props.onKind(props.kind === entry.kind ? '' : entry.kind)}
				/>
			))}
		</Menu>
	)
}

// The app's bolt and name in the middle of the bar, the icon as tall as the name's capitals and descenders.
function Title() {
	const uri = useAtomValue(assetAtom(logo))
	return (
		<HStack spacing={8}>
			{AsyncResult.isSuccess(uri) && (
				<Image uiImage={uri.value} modifiers={[resizable(), frame({height: 18, width: 18}), cornerRadius(4)]} />
			)}
			<Text modifiers={[mono('headline', 17), foregroundStyle(colors.foreground)]}>stash</Text>
		</HStack>
	)
}

// A note the server is still reading: the row's own lines as the system's gray placeholder bars, so the list keeps its
// shape and the row fills in place once the note is ready.
function Skeleton() {
	return (
		<VStack
			alignment="leading"
			spacing={3}
			modifiers={[frame({alignment: 'leading', maxWidth: Infinity}), redacted('placeholder')]}
		>
			<Text modifiers={[mono('headline', 14), foregroundStyle(colors.foreground), lineLimit(1)]}>
				Reading the link and writing
			</Text>
			<Text modifiers={[mono('subheadline', 12), foregroundStyle(colors.mutedForeground), lineLimit(1)]}>
				The summary arrives in a moment once tagged
			</Text>
			<Text modifiers={[mono('caption', 11), foregroundStyle(colors.mutedForeground), lineLimit(1)]}>author</Text>
			<Text modifiers={[mono('caption', 11), foregroundStyle(colors.mutedForeground), lineLimit(1)]}>#tag #tag</Text>
		</VStack>
	)
}

function Placeholder(props: {symbol: 'arrow.up' | 'globe' | 'photo' | 'play.rectangle' | 'text.alignleft' | 'xmark'}) {
	return (
		<Image
			systemName={props.symbol}
			size={18}
			modifiers={[
				foregroundStyle(colors.mutedForeground),
				frame({height: thumbnail, width: thumbnail}),
				border({color: colors.border, width: 1})
			]}
		/>
	)
}

// The kept preview, or a symbol for the source while it loads or when the note has none.
function Preview(props: {note: NoteItem}) {
	const symbol = pipe(
		Match.value(kindOf(props.note)),
		Match.when('tiktok', () => 'play.rectangle' as const),
		Match.when('x', () => 'xmark' as const),
		Match.when('file', () => 'photo' as const),
		Match.when('note', () => 'text.alignleft' as const),
		Match.orElse(() => 'globe' as const)
	)
	if (props.note.image !== undefined) return <Thumbnail note={props.note} symbol={symbol} />
	// Without a preview, the logo of the app the link opens in names the source.
	return Option.match(brandOf(props.note), {
		onNone: () => <Placeholder symbol={symbol} />,
		onSome: brand => (
			<ZStack modifiers={[frame({height: thumbnail, width: thumbnail}), border({color: colors.border, width: 1})]}>
				<Brand brand={brand} size={22} />
			</ZStack>
		)
	})
}

// Mounted only once the server has kept the preview, so the download never runs before the file exists. The square
// crop keeps every row the same height.
function Thumbnail(props: {note: NoteItem; symbol: Parameters<typeof Placeholder>[0]['symbol']}) {
	const image = useAtomValue(imageAtom(props.note.id))
	if (!AsyncResult.isSuccess(image)) return <Placeholder symbol={props.symbol} />
	return (
		<Image
			uiImage={image.value}
			modifiers={[
				resizable(),
				aspectRatio({contentMode: 'fill'}),
				frame({height: thumbnail, width: thumbnail}),
				clipped()
			]}
		/>
	)
}

function Row(props: {
	note: NoteItem
	onOpen: (id: Note['id']) => void
	onRemove: (id: Note['id']) => void
	// Called when the row appears; the last mounted row mounts the next page.
	onAppear: () => void
}) {
	const note = props.note
	const content = (
		<HStack
			alignment="top"
			spacing={12}
			modifiers={[
				fullSeparator,
				contentShape(shapes.rectangle()),
				onAppear(props.onAppear),
				onTapGesture(() => props.onOpen(note.id))
			]}
		>
			<Preview note={note} />
			{note.status === 'organizing' ? (
				<Skeleton />
			) : (
				<VStack alignment="leading" spacing={3} modifiers={[frame({alignment: 'leading', maxWidth: Infinity})]}>
					<Text modifiers={[mono('headline', 14), foregroundStyle(colors.foreground), lineLimit(1)]}>{note.title}</Text>
					{String.isNonEmpty(note.summary) && (
						<Text modifiers={[mono('subheadline', 12), foregroundStyle(colors.mutedForeground), lineLimit(1)]}>
							{note.summary}
						</Text>
					)}
					<VStack alignment="leading" spacing={3}>
						<Text modifiers={[mono('caption', 11), foregroundStyle(colors.mutedForeground), lineLimit(1)]}>
							{String.toLowerCase(String.isNonEmpty(note.author) ? note.author : note.source)}
						</Text>
						{Array.isReadonlyArrayNonEmpty(note.tags) && (
							<Text modifiers={[mono('caption', 11), foregroundStyle(colors.mutedForeground), lineLimit(1)]}>
								{pipe(
									note.tags,
									Array.map(name => `#${name}`),
									Array.join('  ')
								)}
							</Text>
						)}
					</VStack>
				</VStack>
			)}
		</HStack>
	)
	return (
		<SwipeActions modifiers={[...row, tag(note.id)]}>
			<ContextMenu>
				<ContextMenu.Trigger>{content}</ContextMenu.Trigger>
				<ContextMenu.Items>
					{/* The open action names the app the link opens in. */}
					{Option.match(Option.fromNullishOr(note.url), {
						onNone: () => undefined,
						onSome: url => (
							<MenuAction
								label={pipe(
									kinds,
									Array.findFirst(entry => entry.kind === kindOf(note) && entry.kind !== 'web'),
									Option.match({onNone: () => 'Open Link', onSome: entry => `Open in ${entry.label}`})
								)}
								brand={brandOf(note)}
								symbol="arrow.up.right"
								onPress={() => Linking.openURL(url)}
							/>
						)
					})}
					{/* The destructive red is set here, because the app tints its other controls with the text color. */}
					<Button
						label="Delete"
						systemImage="trash"
						role="destructive"
						onPress={() => props.onRemove(note.id)}
						modifiers={[tint(colors.destructive)]}
					/>
				</ContextMenu.Items>
			</ContextMenu>
			<SwipeActions.Actions edge="trailing">
				<Button
					label="Delete"
					systemImage="trash"
					role="destructive"
					onPress={() => props.onRemove(note.id)}
					modifiers={[tint(colors.destructive)]}
				/>
			</SwipeActions.Actions>
		</SwipeActions>
	)
}
