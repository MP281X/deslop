import {useAtom, useAtomMount, useAtomSet, useAtomSuspense, useAtomValue} from '@effect/atom-react'

import {Array, Boolean, HashSet, Match, Option, Schema, String, pipe} from 'effect'

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
	Overlay,
	Picker,
	ScrollView,
	SwipeActions,
	Text,
	Toggle,
	Toolbar,
	ToolbarItem,
	VStack
} from '@expo/ui/swift-ui'
import type {useNativeState} from '@expo/ui/swift-ui'
import {
	accessibilityElement,
	accessibilityHidden,
	accessibilityLabel,
	alignmentGuide,
	aspectRatio,
	background,
	buttonStyle,
	clipShape,
	contentShape,
	controlSize,
	font,
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

import {Chip} from '@deslop/components-mobile/chip'
import {BrandIcon} from '@deslop/components-mobile/icons'
import {colors, mono} from '@deslop/components-mobile/theme'
import {AppTitle} from '@deslop/components-mobile/title'
import {bottomBarSearch} from '@deslop/components-mobile/utils'
import {updateAtom} from '@deslop/runtime/mobile'

import {Byline} from '#lib/components.tsx'
import {
	answerAtom,
	appOf,
	brandOf,
	imageAtom,
	kindOf,
	kinds,
	notesAtom,
	offerAtom,
	queryAtom,
	regenerateAtom,
	removeAtom,
	searchAtom
} from '#lib/utils.ts'
import logo from '#routes/logo.png'
import {tagCounts} from '#services/notes/lib/utils.ts'
import type {Note, NoteItem} from '#services/notes/schema.ts'
import {Brand, Kind} from '#services/notes/schema.ts'

const OFFERS = {
	image: {question: 'Save the copied image?', symbol: 'photo'},
	link: {question: 'Save the copied link?', symbol: 'link'}
} as const

function Lines(props: {note: NoteItem}) {
	return (
		<VStack alignment="leading" spacing={4} modifiers={[frame({alignment: 'leading', maxWidth: Infinity})]}>
			<Text modifiers={[mono('headline', 16), foregroundStyle(colors.foreground), lineLimit(2)]}>
				{props.note.title}
			</Text>
			{pipe(
				Match.value(props.note.status),
				Match.when('organizing', () => (
					<Text
						modifiers={[
							font({textStyle: 'subheadline'}),
							foregroundStyle(colors.mutedForeground),
							lineLimit(2),
							redacted('placeholder'),
							accessibilityLabel('Reading')
						]}
					>
						The main point of this entry, in one or two plain sentences that fill the row.
					</Text>
				)),
				Match.when('failed', () => (
					<Label
						title="Couldn’t read this link"
						systemImage="exclamationmark.triangle.fill"
						modifiers={[font({textStyle: 'subheadline'}), foregroundStyle(colors.destructive), lineLimit(1)]}
					/>
				)),
				Match.orElse(() => (
					<Text modifiers={[font({textStyle: 'subheadline'}), foregroundStyle(colors.mutedForeground), lineLimit(2)]}>
						{props.note.summary}
					</Text>
				))
			)}
			<Byline note={props.note} />
		</VStack>
	)
}

// Mounted only once the server has kept the preview, so the download never runs before the file exists.
function Thumbnail(props: {id: Note['id']}) {
	const image = useAtomValue(imageAtom(props.id))
	if (!AsyncResult.isSuccess(image)) return undefined
	return (
		<Image
			uiImage={image.value}
			modifiers={[
				resizable(),
				aspectRatio({contentMode: 'fill'}),
				frame({height: 64, width: 64}),
				clipShape('roundedRectangle', 10),
				accessibilityHidden(true)
			]}
		/>
	)
}

function NoteRow(props: {
	note: NoteItem
	onAppear: () => void
	onOpen: (id: Note['id']) => void
	onRegenerate: (id: Note['id']) => void
	onRemove: (id: Note['id']) => void
}) {
	return (
		<SwipeActions
			modifiers={[
				listRowBackground(colors.background),
				listRowSeparatorTint(colors.border),
				listRowInsets({bottom: 10, leading: 16, top: 10, trailing: 16}),
				tag(props.note.id)
			]}
		>
			<ContextMenu>
				<ContextMenu.Trigger>
					<HStack
						alignment="center"
						spacing={12}
						modifiers={[
							alignmentGuide('listRowSeparatorLeading', 0),
							frame({alignment: 'leading', maxWidth: Infinity}),
							contentShape(shapes.rectangle()),
							onAppear(props.onAppear),
							onTapGesture(() => props.onOpen(props.note.id)),
							accessibilityElement('combine')
						]}
					>
						{props.note.image !== undefined && <Thumbnail id={props.note.id} />}
						<Lines note={props.note} />
					</HStack>
				</ContextMenu.Trigger>
				<ContextMenu.Items>
					{Option.match(Option.fromNullishOr(props.note.url), {
						onNone: () => undefined,
						onSome: url => (
							<Button onPress={() => Linking.openURL(url)}>
								<Label
									title={Option.match(appOf(props.note), {
										onNone: () => 'Open Link',
										onSome: name => `Open in ${name}`
									})}
									{...Option.match(brandOf(props.note), {
										onNone: () => ({systemImage: 'arrow.up.right' as const}),
										onSome: brand => ({icon: <BrandIcon brand={kinds[brand].logo} />})
									})}
								/>
							</Button>
						)
					})}
					<Button label="Regenerate" systemImage="arrow.clockwise" onPress={() => props.onRegenerate(props.note.id)} />
					<DeleteButton onPress={() => props.onRemove(props.note.id)} />
				</ContextMenu.Items>
			</ContextMenu>
			<SwipeActions.Actions edge="trailing">
				<DeleteButton onPress={() => props.onRemove(props.note.id)} />
			</SwipeActions.Actions>
		</SwipeActions>
	)
}

function DeleteButton(props: {onPress: () => void}) {
	return (
		<Button
			label="Delete"
			systemImage="trash"
			role="destructive"
			onPress={props.onPress}
			modifiers={[tint(colors.destructive)]}
		/>
	)
}

// A picker row's tag is a string or a number, so "All Notes", which clears the filter, is a toggle beside it.
function FilterMenu(props: {kind?: Kind; onKind: (kind?: Kind) => void}) {
	return (
		// A menu opened from the bottom bar reverses its items unless the order is fixed.
		<Menu
			label="Filter"
			systemImage={Boolean.match(props.kind === undefined, {
				onFalse: () => 'line.3.horizontal.decrease.circle.fill',
				onTrue: () => 'line.3.horizontal.decrease'
			})}
			modifiers={[labelStyle('iconOnly'), menuOrder('fixed')]}
		>
			<Toggle
				label="All Notes"
				systemImage="tray"
				isOn={props.kind === undefined}
				onIsOnChange={() => props.onKind()}
			/>
			<Divider />
			<Picker<Kind>
				label="Show"
				selection={props.kind}
				onSelectionChange={props.onKind}
				modifiers={[pickerStyle('inline')]}
			>
				{Array.map(Kind.literals, kind => (
					<KindLabel key={kind} kind={kind} />
				))}
			</Picker>
		</Menu>
	)
}

function KindLabel(props: {kind: Kind}) {
	if (Schema.is(Brand)(props.kind)) {
		return (
			<Label
				title={kinds[props.kind].label}
				icon={<BrandIcon brand={kinds[props.kind].logo} />}
				modifiers={[tag(props.kind)]}
			/>
		)
	}
	return <Label title={kinds[props.kind].label} systemImage={kinds[props.kind].symbol} modifiers={[tag(props.kind)]} />
}

// The sheet hangs off the title in the bar, so it adds nothing to the layout.
function PasteSheet() {
	const offer = pipe(useAtomValue(offerAtom), AsyncResult.getOrElse(Option.none))
	const [answered, respond] = useAtom(answerAtom)
	const kind = Option.match(offer, {onNone: () => 'link' as const, onSome: open => open.kind})
	const open = Option.filter(
		offer,
		current =>
			!AsyncResult.isWaiting(answered) && !Option.exists(AsyncResult.value(answered), count => count === current.count)
	)
	function answer(save: boolean) {
		Option.match(open, {onNone: () => undefined, onSome: current => respond({...current, save})})
	}
	return (
		<BottomSheet
			anchor={<AppTitle logo={logo} name="stash" />}
			isPresented={Option.isSome(open)}
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
				<Image systemName={OFFERS[kind].symbol} size={24} modifiers={[foregroundStyle(colors.foreground)]} />
				<Text modifiers={[mono('headline', 17), foregroundStyle(colors.foreground)]}>{OFFERS[kind].question}</Text>
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
	kind?: Kind
	onCompose: () => void
	onKind: (kind?: Kind) => void
	onOpen: (id: Note['id']) => void
	onSearch: (text: string) => void
	onTag: (name?: string) => void
	query: ReturnType<typeof useNativeState<string>>
	tag?: string
}) {
	useAtomMount(updateAtom)
	const items = useAtomSuspense(notesAtom).value
	const remove = useAtomSet(removeAtom)
	const regenerate = useAtomSet(regenerateAtom)
	const query = String.trim(useAtomValue(queryAtom))
	const found = pipe(useAtomValue(searchAtom), AsyncResult.getOrElse(Option.none))
	const notes = Array.filter(
		items,
		note =>
			Option.match(found, {onNone: () => true, onSome: ids => HashSet.has(ids, note.id)}) &&
			(props.tag === undefined || Array.contains(note.tags, props.tag)) &&
			(props.kind === undefined || kindOf(note) === props.kind)
	)
	const tags = Array.map(tagCounts(items), entry => entry.tag)
	const [limit, setLimit] = useState(80)
	const filtered = String.isNonEmpty(query) || props.tag !== undefined || props.kind !== undefined

	return (
		<Toolbar
			modifiers={[navigationTitle('stash'), navigationBarTitleDisplayMode('inline'), background(colors.background)]}
		>
			{/* SwiftUI shows the outermost toolbar's items first: the filter, the search field, then write. */}
			<Toolbar modifiers={[searchable(props.query, {onChange: props.onSearch, prompt: 'Search'}), bottomBarSearch]}>
				{Array.match(items, {
					onEmpty: () => (
						<ContentUnavailableView
							title="Nothing Saved"
							systemImage="tray"
							description="Share a link to stash, or copy one and open the app."
						/>
					),
					onNonEmpty: () => (
						// The empty state sits over the list, centered on the screen, as SwiftUI's own apps show it.
						<Overlay>
							<List modifiers={[listStyle('plain'), scrollContentBackground('hidden'), background(colors.background)]}>
								<ScrollView
									axes="horizontal"
									showsIndicators={false}
									modifiers={[
										listRowBackground(colors.background),
										listRowSeparatorTint(colors.border),
										listRowInsets({bottom: 10, leading: 16, top: 10, trailing: 16}),
										listRowSeparator('hidden'),
										listRowInsets({bottom: 6, leading: 16, top: 4, trailing: 16})
									]}
								>
									<HStack spacing={8}>
										<Chip
											label="all"
											systemImage="tray"
											active={props.tag === undefined}
											onPress={() => props.onTag()}
										/>
										{Array.map(tags, name => (
											<Chip
												key={name}
												label={name}
												active={props.tag === name}
												onPress={() =>
													Boolean.match(props.tag === name, {
														onFalse: () => props.onTag(name),
														onTrue: () => props.onTag()
													})
												}
											/>
										))}
									</HStack>
								</ScrollView>
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
							{filtered && Array.isReadonlyArrayEmpty(notes) && (
								<Overlay.Content>
									<ContentUnavailableView
										{...Boolean.match(String.isEmpty(query), {
											onFalse: () => ({systemImage: 'magnifyingglass' as const, title: `No Results for “${query}”`}),
											onTrue: () => ({systemImage: 'tray' as const, title: 'No Notes'})
										})}
									/>
								</Overlay.Content>
							)}
						</Overlay>
					)
				})}
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
