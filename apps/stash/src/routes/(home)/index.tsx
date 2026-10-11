import {useAtomSet, useAtomSuspense, useAtomValue} from '@effect/atom-react'

import {Array, HashSet, Match, Option, String, pipe} from 'effect'

import {
	BottomSheet,
	Button,
	ContentUnavailableView,
	ContextMenu,
	Divider,
	HStack,
	Image,
	Label,
	List,
	Menu,
	Picker,
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
	buttonStyle,
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
	menuOrder,
	navigationBarTitleDisplayMode,
	navigationTitle,
	onAppear,
	onTapGesture,
	padding,
	pickerStyle,
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

import {
	answerAtom,
	brandOf,
	imageAtom,
	kindOf,
	kinds,
	notesAtom,
	offerAtom,
	regenerateAtom,
	removeAtom,
	searchAtom
} from '#lib/utils.ts'
import type {Kind} from '#lib/utils.ts'
import {bottomBarSearch} from '#modules/native/index.ts'
import logo from '#routes/logo.png'
import {tagCounts} from '#services/notes/lib/utils.ts'
import type {Note, NoteItem} from '#services/notes/schema.ts'
import {Chip} from '@deslop/components-mobile/chip'
import {BrandIcon, BrandLogo} from '@deslop/components-mobile/icons'
import {colors, mono} from '@deslop/components-mobile/theme'
import {assetAtom} from '@deslop/components-mobile/utils'

const row = [
	listRowBackground(colors.background),
	listRowSeparatorTint(colors.border),
	listRowInsets({bottom: 10, leading: 16, top: 10, trailing: 16})
]

const thumbnail = 56

const caption = [mono('caption', 11), foregroundStyle(colors.mutedForeground), lineLimit(1)]

function Placeholder(props: {symbol: 'globe' | 'photo' | 'play.rectangle' | 'text.alignleft' | 'xmark'}) {
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

// Mounted only once the server has kept the preview, so the download never runs before the file exists.
function Thumbnail(props: {id: Note['id']; symbol: Parameters<typeof Placeholder>[0]['symbol']}) {
	const image = useAtomValue(imageAtom(props.id))
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

function Preview(props: {note: NoteItem}) {
	const symbol = pipe(
		Match.value(kindOf(props.note)),
		Match.when('tiktok', () => 'play.rectangle' as const),
		Match.when('x', () => 'xmark' as const),
		Match.when('file', () => 'photo' as const),
		Match.when('note', () => 'text.alignleft' as const),
		Match.orElse(() => 'globe' as const)
	)
	if (props.note.image !== undefined) return <Thumbnail id={props.note.id} symbol={symbol} />
	return Option.match(brandOf(props.note), {
		onNone: () => <Placeholder symbol={symbol} />,
		onSome: brand => (
			<ZStack modifiers={[frame({height: thumbnail, width: thumbnail}), border({color: colors.border, width: 1})]}>
				<BrandLogo brand={brand} size={22} />
			</ZStack>
		)
	})
}

function Lines(props: {note: NoteItem}) {
	const note = props.note
	return pipe(
		Match.value(note.status),
		Match.when('organizing', () => (
			<VStack alignment="leading" spacing={3} modifiers={[redacted('placeholder')]}>
				<Text modifiers={[mono('headline', 14), lineLimit(1)]}>Reading the link and writing</Text>
				<Text modifiers={[mono('subheadline', 12), lineLimit(1)]}>The summary arrives once tagged</Text>
				<Text modifiers={caption}>author</Text>
			</VStack>
		)),
		Match.when('failed', () => (
			<VStack alignment="leading" spacing={3}>
				<Text modifiers={[mono('headline', 14), foregroundStyle(colors.foreground), lineLimit(1)]}>{note.title}</Text>
				<Label
					title="Couldn’t read · tap to retry"
					systemImage="exclamationmark.triangle.fill"
					modifiers={[mono('subheadline', 12), foregroundStyle(colors.destructive), lineLimit(1)]}
				/>
				<Text modifiers={caption}>{note.issue}</Text>
			</VStack>
		)),
		Match.orElse(() => (
			<VStack alignment="leading" spacing={3}>
				<Text modifiers={[mono('headline', 14), foregroundStyle(colors.foreground), lineLimit(1)]}>{note.title}</Text>
				<Text modifiers={[mono('subheadline', 12), foregroundStyle(colors.mutedForeground), lineLimit(1)]}>
					{note.summary}
				</Text>
				<Text modifiers={caption}>
					{String.toLowerCase(String.isNonEmpty(note.author) ? note.author : note.source)}
				</Text>
				<Text modifiers={caption}>
					{pipe(
						note.tags,
						Array.map(name => `#${name}`),
						Array.join('  ')
					)}
				</Text>
			</VStack>
		))
	)
}

function NoteRow(props: {
	note: NoteItem
	onAppear: () => void
	onOpen: (id: Note['id']) => void
	onRegenerate: (id: Note['id']) => void
	onRemove: (id: Note['id']) => void
}) {
	const note = props.note
	const remove = (
		<Button
			label="Delete"
			systemImage="trash"
			role="destructive"
			onPress={() => props.onRemove(note.id)}
			modifiers={[tint(colors.destructive)]}
		/>
	)
	return (
		<SwipeActions modifiers={[...row, tag(note.id)]}>
			<ContextMenu>
				<ContextMenu.Trigger>
					<HStack
						alignment="top"
						spacing={12}
						modifiers={[
							alignmentGuide('listRowSeparatorLeading', 0),
							frame({alignment: 'leading', maxWidth: Infinity}),
							contentShape(shapes.rectangle()),
							onAppear(props.onAppear),
							onTapGesture(() => (note.status === 'failed' ? props.onRegenerate(note.id) : props.onOpen(note.id)))
						]}
					>
						<Preview note={note} />
						<Lines note={note} />
					</HStack>
				</ContextMenu.Trigger>
				<ContextMenu.Items>
					{Option.match(Option.fromNullishOr(note.url), {
						onNone: () => undefined,
						onSome: url => (
							<Button onPress={() => Linking.openURL(url)}>
								<Label
									title={pipe(
										Array.findFirst(kinds, entry => entry.kind === kindOf(note) && entry.kind !== 'web'),
										Option.match({onNone: () => 'Open Link', onSome: entry => `Open in ${entry.label}`})
									)}
									{...Option.match(brandOf(note), {
										onNone: () => ({systemImage: 'arrow.up.right' as const}),
										onSome: brand => ({icon: <BrandIcon brand={brand} />})
									})}
								/>
							</Button>
						)
					})}
					<Button label="Regenerate" systemImage="arrow.clockwise" onPress={() => props.onRegenerate(note.id)} />
					{remove}
				</ContextMenu.Items>
			</ContextMenu>
			<SwipeActions.Actions edge="trailing">{remove}</SwipeActions.Actions>
		</SwipeActions>
	)
}

function FilterMenu(props: {kind: Kind | ''; onKind: (kind: Kind | '') => void}) {
	return (
		// A menu opened from the bottom bar reverses its items unless the order is fixed.
		<Menu
			label="Filter"
			systemImage={props.kind === '' ? 'line.3.horizontal.decrease' : 'line.3.horizontal.decrease.circle.fill'}
			modifiers={[labelStyle('iconOnly'), menuOrder('fixed')]}
		>
			<Picker
				label="Show"
				selection={props.kind}
				onSelectionChange={(next: string) =>
					props.onKind(
						pipe(
							Array.findFirst(kinds, entry => entry.kind === next),
							Option.match({onNone: () => '' as const, onSome: entry => entry.kind})
						)
					)
				}
				modifiers={[pickerStyle('inline')]}
			>
				<Label title="All Notes" systemImage="tray" modifiers={[tag('')]} />
				<Divider />
				{Array.map(kinds, entry =>
					'brand' in entry ? (
						<Label
							key={entry.kind}
							title={entry.label}
							icon={<BrandIcon brand={entry.brand} />}
							modifiers={[tag(entry.kind)]}
						/>
					) : (
						<Label key={entry.kind} title={entry.label} systemImage={entry.symbol} modifiers={[tag(entry.kind)]} />
					)
				)}
			</Picker>
		</Menu>
	)
}

// The sheet hangs off the title in the bar, so it adds nothing to the layout.
function PasteSheet() {
	const offer = pipe(useAtomValue(offerAtom), AsyncResult.getOrElse(Option.none))
	const respond = useAtomSet(answerAtom)
	const logoUri = useAtomValue(assetAtom(logo))
	const kind = Option.match(offer, {onNone: () => 'link' as const, onSome: open => open.kind})
	function answer(save: boolean) {
		Option.match(offer, {onNone: () => undefined, onSome: open => respond({...open, save})})
	}
	return (
		<BottomSheet
			anchor={
				<HStack spacing={8}>
					{AsyncResult.isSuccess(logoUri) && (
						<Image uiImage={logoUri.value} modifiers={[resizable(), frame({height: 18, width: 18}), cornerRadius(4)]} />
					)}
					<Text modifiers={[mono('headline', 17), foregroundStyle(colors.foreground)]}>stash</Text>
				</HStack>
			}
			isPresented={Option.isSome(offer)}
			onIsPresentedChange={presented => {
				if (!presented) answer(false)
			}}
			fitToContents
		>
			<VStack
				spacing={14}
				modifiers={[
					padding({bottom: 8, leading: 24, top: 28, trailing: 24}),
					frame({maxWidth: Infinity}),
					background(colors.background)
				]}
			>
				<Image
					systemName={kind === 'image' ? 'photo' : 'link'}
					size={24}
					modifiers={[foregroundStyle(colors.foreground)]}
				/>
				<Text modifiers={[mono('headline', 17), foregroundStyle(colors.foreground)]}>
					{kind === 'image' ? 'save the copied image?' : 'save the copied link?'}
				</Text>
				<VStack spacing={4} modifiers={[padding({top: 6})]}>
					<Button
						onPress={() => answer(true)}
						modifiers={[
							buttonStyle('glassProminent'),
							controlSize('large'),
							tint(colors.primary),
							foregroundStyle(colors.primaryForeground)
						]}
					>
						<Text modifiers={[mono('headline', 16), frame({maxWidth: Infinity})]}>Save</Text>
					</Button>
					<Button onPress={() => answer(false)} modifiers={[buttonStyle('plain'), controlSize('large')]}>
						<Text
							modifiers={[
								mono('body', 15),
								foregroundStyle(colors.mutedForeground),
								padding({vertical: 12}),
								frame({maxWidth: Infinity})
							]}
						>
							Not Now
						</Text>
					</Button>
				</VStack>
			</VStack>
		</BottomSheet>
	)
}

export function HomeRoute(props: {
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
	const items = useAtomSuspense(notesAtom).value
	const remove = useAtomSet(removeAtom)
	const regenerate = useAtomSet(regenerateAtom)
	const query = String.trim(props.search)
	const found = pipe(useAtomValue(searchAtom(query)), AsyncResult.getOrElse(Option.none))
	const notes = Array.filter(
		items,
		note =>
			Option.match(found, {onNone: () => true, onSome: ids => HashSet.has(ids, note.id)}) &&
			(String.isEmpty(props.tag) || Array.contains(note.tags, props.tag)) &&
			(props.kind === '' || kindOf(note) === props.kind)
	)
	const tags = Array.map(tagCounts(items), entry => entry.tag)
	const [limit, setLimit] = useState(80)
	const filtered = String.isNonEmpty(query) || String.isNonEmpty(props.tag) || props.kind !== ''

	return (
		<Toolbar
			modifiers={[
				navigationTitle('stash'),
				navigationBarTitleDisplayMode('inline'),
				searchable(props.query, {onChange: props.onSearch, prompt: 'Search'}),
				background(colors.background)
			]}
		>
			{/* SwiftUI shows the outermost toolbar's items first: the filter, the search field, then write. */}
			<Toolbar modifiers={[bottomBarSearch]}>
				{Array.isReadonlyArrayEmpty(items) ? (
					<ContentUnavailableView
						title="Nothing Saved"
						systemImage="tray"
						description="Share a link to stash, or copy one and open the app."
					/>
				) : (
					<List modifiers={[listStyle('plain'), scrollContentBackground('hidden'), background(colors.background)]}>
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
									onPress={() => props.onTag('')}
								/>
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
						{filtered && Array.isReadonlyArrayEmpty(notes) && (
							<ContentUnavailableView
								title={String.isEmpty(query) ? 'No Notes' : `No Results for “${query}”`}
								systemImage={String.isEmpty(query) ? 'tray' : 'magnifyingglass'}
								modifiers={[...row, listRowSeparator('hidden')]}
							/>
						)}
						{/* Plain rows, not List.ForEach: its row wrapper hides the row background and swipe actions. */}
						{Array.map(Array.take(notes, limit), (note, position) => (
							<NoteRow
								key={note.id}
								note={note}
								onAppear={() => {
									if (position === limit - 1) setLimit(limit + 80)
								}}
								onOpen={props.onOpen}
								onRegenerate={id => regenerate(id)}
								onRemove={id => remove(id)}
							/>
						))}
					</List>
				)}
				<Toolbar.Content>
					<ToolbarItem placement="bottomBar">
						<Button
							label="Write"
							systemImage="square.and.pencil"
							onPress={props.onCompose}
							modifiers={[labelStyle('iconOnly')]}
						/>
					</ToolbarItem>
				</Toolbar.Content>
			</Toolbar>
			<Toolbar.Content>
				<ToolbarItem placement="principal">
					<PasteSheet />
				</ToolbarItem>
				<ToolbarItem placement="bottomBar">
					<FilterMenu kind={props.kind} onKind={props.onKind} />
				</ToolbarItem>
			</Toolbar.Content>
		</Toolbar>
	)
}
