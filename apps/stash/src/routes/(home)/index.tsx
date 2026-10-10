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
	ToolbarItem,
	VStack,
	ZStack
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
	cornerRadius,
	environment,
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
	padding,
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
import {Brand, brandOf} from '#routes/brand.tsx'
import {Chip} from '#routes/chip.tsx'
import logo from '#routes/logo.png'
import {Cover} from '#routes/note.tsx'
import {findNotes, tagCounts} from '#services/notes/lib/utils.ts'
import type {Note} from '#services/notes/schema.ts'
import {colors, mono} from '@deslop/components/mobile/theme'

const row = [
	listRowBackground(colors.background),
	listRowSeparatorTint(colors.border),
	listRowInsets({bottom: 10, leading: 16, top: 10, trailing: 16})
]

// Every list thumbnail has this size, so rows line up whatever the shape of the preview.
const thumbnail = 56

// The list works like iOS Mail: tag chips on top, the search field between the select and write buttons at the bottom,
// a long press shows the note, and two fingers dragged down the list select several notes.
export function NotesRoute(props: {
	onClear: () => void
	onCompose: () => void
	onOpen: (id: Note['id']) => void
	onSearch: (text: string) => void
	onTag: (name: string) => void
	query: ReturnType<typeof useNativeState<string>>
	search: string
}) {
	const state = useAtomSuspense(notesAtom).value
	const pending = useAtomSuspense(pendingAtom).value
	const remove = useAtomSet(removeAtom)
	const [selecting, setSelecting] = useState(false)
	const [selection, setSelection] = useState<Note['id'][]>([])
	const notes = findNotes(state.notes, props.search)
	// The tags as chips, the most used first, narrowed to those that start with a typed #; the active one clears the
	// filter when tapped again.
	const active = String.trim(props.search)
	const tags = pipe(
		tagCounts(state.notes),
		Array.map(entry => entry.tag),
		Array.filter(name =>
			String.startsWith('#')(active) ? String.startsWith(String.slice(1)(active))(name) : String.isEmpty(active)
		)
	)

	function select(ids: Note['id'][]) {
		setSelection(ids)
		setSelecting(true)
	}

	function finish() {
		setSelection([])
		setSelecting(false)
	}

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
			<List
				selection={selection}
				// A tap outside selecting opens the note; two fingers dragged down the list select several and start selecting.
				onSelectionChange={next => {
					const ids = Array.filter(next, String.isString)
					if (selecting || ids.length > 1) {
						select(ids)
						return
					}
					Option.match(Array.head(ids), {onNone: () => undefined, onSome: props.onOpen})
					setSelection([])
				}}
				modifiers={[
					listStyle('plain'),
					scrollContentBackground('hidden'),
					background(colors.background),
					...(selecting ? [environment('editMode', 'active')] : [])
				]}
			>
				{!selecting && Array.isReadonlyArrayNonEmpty(state.notes) && (
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
							<Chip label="all" systemImage="tray" active={String.isEmpty(active)} onPress={props.onClear} />
							{Array.map(tags, name => (
								<Chip key={name} label={name} active={active === `#${name}`} onPress={() => props.onTag(name)} />
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
						onSelect={id => select([id])}
					/>
				))}
			</List>
		))
	)

	return (
		<Toolbar
			modifiers={[
				navigationTitle('stash'),
				navigationBarTitleDisplayMode('inline'),
				searchable(props.query, {onChange: props.onSearch, prompt: 'search or #tag'}),
				background(colors.background)
			]}
		>
			{view}
			<Toolbar.Content>
				<ToolbarItem placement="principal">
					<Title />
				</ToolbarItem>
				{selecting ? (
					<>
						<ToolbarItem placement="bottomBar">
							<Button label="Done" systemImage="checkmark" onPress={finish} modifiers={[labelStyle('iconOnly')]} />
						</ToolbarItem>
						<ToolbarItem placement="bottomBar" kind="spacer" />
						<ToolbarItem placement="bottomBar">
							<Text modifiers={[mono('subheadline', 13), foregroundStyle(colors.mutedForeground)]}>
								{`${selection.length} selected`}
							</Text>
						</ToolbarItem>
						<ToolbarItem placement="bottomBar" kind="spacer" />
						<ToolbarItem placement="bottomBar">
							<Button
								label="Delete"
								systemImage="trash"
								role="destructive"
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
							<Button
								label="Select"
								systemImage="checklist"
								onPress={() => select([])}
								modifiers={[labelStyle('iconOnly')]}
							/>
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
		Match.value(props.note),
		Match.when({source: 'TikTok'}, () => 'play.rectangle' as const),
		Match.when({source: 'X'}, () => 'xmark' as const),
		Match.when({source: 'Website'}, () => 'globe' as const),
		Match.when(
			note => note.file !== undefined,
			() => 'photo' as const
		),
		Match.orElse(() => 'text.alignleft' as const)
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

// The note as a long press shows it above its menu: the whole preview, the summary and the start of the AI's notes.
function Peek(props: {note: Note}) {
	return (
		<VStack
			alignment="leading"
			spacing={10}
			modifiers={[padding({all: 16}), frame({width: 340}), background(colors.background)]}
		>
			{props.note.image !== undefined && <Cover note={props.note} height={160} />}
			<Text modifiers={[mono('headline', 15), foregroundStyle(colors.foreground)]}>{props.note.title}</Text>
			{String.isNonEmpty(props.note.summary) && (
				<Text modifiers={[mono('body', 13), foregroundStyle(colors.mutedForeground)]}>{props.note.summary}</Text>
			)}
			{Option.match(Option.liftPredicate(props.note.body ?? '', String.isNonEmpty), {
				onNone: () => undefined,
				onSome: body => (
					<Text modifiers={[mono('body', 12), foregroundStyle(colors.foreground), lineLimit(10)]}>{body}</Text>
				)
			})}
		</VStack>
	)
}

function Row(props: {
	note: Note
	onOpen: (id: Note['id']) => void
	onRemove: (id: Note['id']) => void
	onSelect: (id: Note['id']) => void
	selecting: boolean
}) {
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
					// The source and tags in the secondary color, as iOS lists show details.
					<Text modifiers={[mono('caption', 11), foregroundStyle(colors.mutedForeground), lineLimit(1)]}>
						{pipe(
							[
								String.toLowerCase(String.isNonEmpty(props.note.author) ? props.note.author : props.note.source),
								...Array.map(props.note.tags, name => `#${name}`)
							],
							Array.join('  ')
						)}
					</Text>
				)}
			</VStack>
		</HStack>
	)
	// While selecting, a tap selects the row, so it is no button.
	if (props.selecting) return <HStack modifiers={[...row, tag(props.note.id)]}>{content}</HStack>
	return (
		<SwipeActions modifiers={[...row, tag(props.note.id)]}>
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
				<ContextMenu.Preview>
					<Peek note={props.note} />
				</ContextMenu.Preview>
				<ContextMenu.Items>
					{Option.match(Option.fromNullishOr(props.note.url), {
						onNone: () => undefined,
						onSome: url => (
							<Button label="Open Link" systemImage="arrow.up.right" onPress={() => Linking.openURL(url)} />
						)
					})}
					<Button label="Select" systemImage="checkmark.circle" onPress={() => props.onSelect(props.note.id)} />
					<Button label="Delete" systemImage="trash" role="destructive" onPress={() => props.onRemove(props.note.id)} />
				</ContextMenu.Items>
			</ContextMenu>
			<SwipeActions.Actions edge="trailing">
				<Button label="Delete" systemImage="trash" role="destructive" onPress={() => props.onRemove(props.note.id)} />
			</SwipeActions.Actions>
		</SwipeActions>
	)
}
