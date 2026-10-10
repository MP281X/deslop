import {useAtomSet, useAtomSuspense, useAtomValue} from '@effect/atom-react'

import {Array, Match, Option, String, pipe} from 'effect'

import {
	Button,
	ContentUnavailableView,
	ContextMenu,
	HStack,
	Image,
	List,
	Menu,
	ProgressView,
	ScrollView,
	ShareLink,
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
	controlSize,
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
	onTapGesture,
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

import {assetAtom, imageAtom, notesAtom, pendingAtom, removeAtom} from '#lib/utils.ts'
import {Brand, brandOf, kindOf, kinds} from '#routes/brand.tsx'
import type {Kind} from '#routes/brand.tsx'
import {Chip, tagColor} from '#routes/chip.tsx'
import logo from '#routes/logo.png'
import {findNotes, tagCounts} from '#services/notes/lib/utils.ts'
import type {Note} from '#services/notes/schema.ts'
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

// The list follows iOS Mail: colored tag chips that filter apart from search, the filter menu, search field and write
// button at the bottom, the system menu on a long press, and two fingers dragged down the list to select notes.
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
	const [selecting, setSelecting] = useState(false)
	const [selection, setSelection] = useState<Note['id'][]>([])
	const notes = Array.filter(
		findNotes(state.notes, props.search),
		note =>
			(String.isEmpty(props.tag) || Array.contains(note.tags, props.tag)) &&
			(props.kind === '' || kindOf(note) === props.kind)
	)
	const tags = Array.map(tagCounts(state.notes), entry => entry.tag)
	const filtered = String.isNonEmpty(props.search) || String.isNonEmpty(props.tag) || props.kind !== ''

	function finish() {
		setSelection([])
		setSelecting(false)
	}

	const list = (
		<List
			selection={selection}
			editing={selecting}
			onEditingChange={editing => (editing ? setSelecting(true) : finish())}
			onSelectionChange={next => {
				const ids = Array.filter(next, String.isString)
				if (selecting) {
					setSelection(ids)
					return
				}
				// Outside selecting, a row the list selects on a tap opens instead.
				Option.match(Array.head(ids), {onNone: () => undefined, onSome: props.onOpen})
				setSelection([])
			}}
			modifiers={[listStyle('plain'), scrollContentBackground('hidden'), background(colors.background)]}
		>
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
						<Chip
							label="all"
							systemImage="tray"
							active={String.isEmpty(props.tag)}
							color={{fill: colors.foreground, text: colors.background}}
							onPress={() => props.onTag('')}
						/>
						{Array.map(tags, name => (
							<Chip
								key={name}
								label={name}
								active={props.tag === name}
								color={tagColor(name)}
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
						<VStack alignment="leading" spacing={4} modifiers={[frame({alignment: 'leading', maxWidth: Infinity})]}>
							<Text modifiers={[mono('subheadline', 13), foregroundStyle(colors.mutedForeground), lineLimit(1)]}>
								{Option.match(Option.fromNullishOr(item.file), {
									onNone: () => item.text,
									onSome: file => (String.startsWith('image/')(file.type) ? 'image' : 'video')
								})}
							</Text>
							<Spinner />
						</VStack>
					</HStack>
				))}
			{/* Plain rows, not List.ForEach: its row wrapper hides the row background and swipe actions from the list. */}
			{Array.map(notes, note => (
				<Row
					key={note.id}
					note={note}
					selecting={selecting}
					onOpen={props.onOpen}
					onRemove={id => remove(id)}
					onSelect={id => {
						setSelection([id])
						setSelecting(true)
					}}
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
			{Array.isReadonlyArrayEmpty(state.notes) && Array.isReadonlyArrayEmpty(pending) ? (
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
					{selecting ? (
						<Text modifiers={[mono('headline', 15), foregroundStyle(colors.foreground)]}>
							{`${selection.length} selected`}
						</Text>
					) : (
						<Title />
					)}
				</ToolbarItem>
				{selecting ? (
					<>
						<ToolbarItem placement="topBarLeading">
							<Button label="Select All" onPress={() => setSelection(Array.map(notes, note => note.id))} />
						</ToolbarItem>
						<ToolbarItem placement="confirmationAction">
							<Button label="Done" systemImage="checkmark" onPress={finish} modifiers={[labelStyle('iconOnly')]} />
						</ToolbarItem>
						<ToolbarItem placement="bottomBar" kind="spacer" />
						<ToolbarItem placement="bottomBar">
							<Button
								label="Delete"
								systemImage="trash"
								onPress={() => {
									for (const id of selection) remove(id)
									finish()
								}}
								modifiers={[labelStyle('iconOnly')]}
							/>
						</ToolbarItem>
					</>
				) : (
					<>
						<ToolbarItem placement="bottomBar">
							<Filter kind={props.kind} onKind={props.onKind} />
						</ToolbarItem>
						<ToolbarItem placement="bottomBar" kind="search" />
						<ToolbarItem placement="bottomBar">
							<Button
								label="Write"
								systemImage="square.and.pencil"
								onPress={props.onCompose}
								modifiers={[labelStyle('iconOnly')]}
							/>
						</ToolbarItem>
					</>
				)}
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
				<Button
					key={entry.kind}
					label={entry.label}
					systemImage={props.kind === entry.kind ? 'checkmark' : entry.symbol}
					onPress={() => props.onKind(props.kind === entry.kind ? '' : entry.kind)}
				/>
			))}
		</Menu>
	)
}

// The app's bolt and name in the middle of the bar.
function Title() {
	const uri = useAtomValue(assetAtom(logo))
	return (
		<HStack spacing={8}>
			{AsyncResult.isSuccess(uri) && (
				<Image uiImage={uri.value} modifiers={[resizable(), frame({height: 22, width: 22}), cornerRadius(5)]} />
			)}
			<Text modifiers={[mono('headline', 16), foregroundStyle(colors.foreground)]}>stash</Text>
		</HStack>
	)
}

// Marks a capture the server is still reading, in place of its author and tags.
function Spinner() {
	return <ProgressView modifiers={[controlSize('mini'), tint(colors.mutedForeground)]} />
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
function Preview(props: {note: Note}) {
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
function Thumbnail(props: {note: Note; symbol: Parameters<typeof Placeholder>[0]['symbol']}) {
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
	note: Note
	onOpen: (id: Note['id']) => void
	onRemove: (id: Note['id']) => void
	onSelect: (id: Note['id']) => void
	selecting: boolean
}) {
	const note = props.note
	// No button around the row: a button would take the two-finger drag that starts selecting.
	const content = (
		<HStack
			alignment="top"
			spacing={12}
			modifiers={[
				fullSeparator,
				contentShape(shapes.rectangle()),
				...(props.selecting ? [] : [onTapGesture(() => props.onOpen(note.id))])
			]}
		>
			<Preview note={note} />
			<VStack alignment="leading" spacing={3} modifiers={[frame({alignment: 'leading', maxWidth: Infinity})]}>
				<Text modifiers={[mono('headline', 14), foregroundStyle(colors.foreground), lineLimit(1)]}>{note.title}</Text>
				{String.isNonEmpty(note.summary) && (
					<Text modifiers={[mono('subheadline', 12), foregroundStyle(colors.mutedForeground), lineLimit(1)]}>
						{note.summary}
					</Text>
				)}
				{note.status === 'organizing' ? (
					<Spinner />
				) : (
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
				)}
			</VStack>
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
							<>
								<Button
									label={pipe(
										kinds,
										Array.findFirst(entry => entry.kind === kindOf(note) && entry.kind !== 'web'),
										Option.match({onNone: () => 'Open Link', onSome: entry => `Open in ${entry.label}`})
									)}
									systemImage="arrow.up.right"
									onPress={() => Linking.openURL(url)}
								/>
								<ShareLink item={url} />
							</>
						)
					})}
					<Button label="Select" systemImage="checkmark.circle" onPress={() => props.onSelect(note.id)} />
					<Button label="Delete" systemImage="trash" role="destructive" onPress={() => props.onRemove(note.id)} />
				</ContextMenu.Items>
			</ContextMenu>
			<SwipeActions.Actions edge="trailing">
				<Button label="Delete" systemImage="trash" role="destructive" onPress={() => props.onRemove(note.id)} />
			</SwipeActions.Actions>
		</SwipeActions>
	)
}
