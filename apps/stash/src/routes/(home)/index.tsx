import {useAtomMount, useAtomSet, useAtomSuspense, useAtomValue} from '@effect/atom-react'

import {Array, Boolean, HashSet, Match, Option, Schema, String, pipe} from 'effect'

import {
	Button,
	ContextMenu,
	Divider,
	Image,
	Label,
	Menu,
	Overlay,
	Picker,
	SwipeActions,
	Toggle,
	Toolbar,
	ToolbarItem
} from '@expo/ui/swift-ui'
import type {useNativeState} from '@expo/ui/swift-ui'
import {
	accessibilityHidden,
	accessibilityLabel,
	alignmentGuide,
	aspectRatio,
	background,
	clipShape,
	foregroundStyle,
	frame,
	labelStyle,
	lineLimit,
	listRowBackground,
	listRowInsets,
	listRowSeparator,
	menuOrder,
	navigationBarTitleDisplayMode,
	navigationTitle,
	onAppear,
	pickerStyle,
	redacted,
	resizable,
	searchable,
	tag,
	tint
} from '@expo/ui/swift-ui/modifiers'
import {useMachineResult} from '@typeonce/effect-machine-react'
import {AtomMachine} from '@typeonce/effect-machine/reactivity'
import {AsyncResult} from 'effect/reactivity'
import {useState} from 'react'
import {Linking} from 'react-native'

import {BrandIcon} from '@deslop/components-mobile/icons'
import {ClipboardSheet} from '@deslop/components-mobile/sheet'
import {colors, space, text} from '@deslop/components-mobile/theme'
import {AppTitle} from '@deslop/components-mobile/title'
import {Empty, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle} from '@deslop/components-mobile/ui/empty'
import {
	Item,
	ItemContent,
	ItemDescription,
	ItemGroup,
	ItemMedia,
	ItemTitle,
	itemRow
} from '@deslop/components-mobile/ui/item'
import {ToggleGroup, ToggleGroupItem} from '@deslop/components-mobile/ui/toggle-group'
import {bottomBarSearch} from '@deslop/components-mobile/utils'

import {Byline} from '#lib/components.tsx'
import {
	appOf,
	brandOf,
	clipboardAtom,
	clipboardReturnsAtom,
	imageAtom,
	kindOf,
	kinds,
	notesAtom,
	primary,
	queryAtom,
	regenerateAtom,
	removeAtom,
	searchAtom
} from '#lib/utils.ts'
import logo from '#routes/icon.png'
import {tagCounts} from '#services/notes/lib/utils.ts'
import type {Note, NoteItem} from '#services/notes/schema.ts'
import {Brand, Kind} from '#services/notes/schema.ts'

// Stash detects a link where Trips takes any text.
const OFFERS = {
	image: {question: 'Save the copied image?', symbol: 'photo'},
	link: {question: 'Save the copied link?', symbol: 'link'},
	text: {question: 'Save the copied link?', symbol: 'link'}
} as const

// The title and one line of where it is from; the summary waits in the note, so the list scans fast.
function Lines(props: {note: NoteItem}) {
	return (
		<ItemContent>
			<ItemTitle>{props.note.title}</ItemTitle>
			{pipe(
				Match.value(props.note.status),
				Match.when('organizing', () => (
					<ItemDescription modifiers={[text.caption, redacted('placeholder'), accessibilityLabel('Reading')]}>
						Reading the source of this entry
					</ItemDescription>
				)),
				Match.when('failed', () => (
					<Label
						title="Couldn’t read this link"
						systemImage="exclamationmark.triangle.fill"
						modifiers={[text.caption, foregroundStyle(colors.destructive), lineLimit(1)]}
					/>
				)),
				Match.orElse(() => <Byline note={props.note} />)
			)}
		</ItemContent>
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

function NoteRow(props: {
	note: NoteItem
	onAppear: () => void
	onOpen: (id: Note['id']) => void
	onRegenerate: (id: Note['id']) => void
	onRemove: (id: Note['id']) => void
}) {
	return (
		<SwipeActions modifiers={[...itemRow, tag(props.note.id)]}>
			<ContextMenu>
				<ContextMenu.Trigger>
					<Item
						onPress={() => props.onOpen(props.note.id)}
						modifiers={[alignmentGuide('listRowSeparatorLeading', 0), onAppear(props.onAppear)]}
					>
						{props.note.image !== undefined && (
							<ItemMedia>
								<Thumbnail id={props.note.id} />
							</ItemMedia>
						)}
						<Lines note={props.note} />
					</Item>
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

function PasteSheet() {
	useAtomMount(clipboardReturnsAtom)
	const offer = pipe(useMachineResult(AtomMachine.select(clipboardAtom, 'Offered')), AsyncResult.getOrElse(Option.none))
	const send = useAtomSet(clipboardAtom.send)
	const kind = Option.match(offer, {onNone: () => 'link' as const, onSome: open => open.kind})
	return (
		<ClipboardSheet
			anchor={<AppTitle logo={logo} name="stash" />}
			confirm="Save"
			onAnswer={save => send({_tag: 'Answered', save})}
			open={Option.isSome(offer)}
			question={OFFERS[kind].question}
			symbol={OFFERS[kind].symbol}
			tint={primary}
		/>
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
						<Empty>
							<EmptyHeader>
								<EmptyMedia systemImage="tray" />
								<EmptyTitle>Nothing Saved</EmptyTitle>
								<EmptyDescription>Share a link to stash, or copy one and open the app.</EmptyDescription>
							</EmptyHeader>
						</Empty>
					),
					onNonEmpty: () => (
						// The empty state sits over the list, centered on the screen, as SwiftUI's own apps show it.
						<Overlay>
							<ItemGroup>
								{/* "all" clears the tag, and choosing the chosen tag again does too. */}
								<ToggleGroup
									value={props.tag ?? 'all'}
									onValueChange={value =>
										Boolean.match(value === 'all' || value === props.tag, {
											onFalse: () => props.onTag(value),
											onTrue: () => props.onTag()
										})
									}
									tint={primary}
									modifiers={[
										listRowBackground(colors.background),
										listRowSeparator('hidden'),
										listRowInsets({bottom: space[1], leading: space[4], top: space[1], trailing: space[4]})
									]}
								>
									<ToggleGroupItem value="all" systemImage="tray">
										all
									</ToggleGroupItem>
									{Array.map(tags, name => (
										<ToggleGroupItem key={name} value={name}>
											{name}
										</ToggleGroupItem>
									))}
								</ToggleGroup>
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
							</ItemGroup>
							{filtered && Array.isReadonlyArrayEmpty(notes) && (
								<Overlay.Content>
									<Empty>
										{Boolean.match(String.isEmpty(query), {
											onFalse: () => (
												<EmptyHeader>
													<EmptyMedia systemImage="magnifyingglass" />
													<EmptyTitle>{`No Results for “${query}”`}</EmptyTitle>
												</EmptyHeader>
											),
											onTrue: () => (
												<EmptyHeader>
													<EmptyMedia systemImage="tray" />
													<EmptyTitle>No Notes</EmptyTitle>
												</EmptyHeader>
											)
										})}
									</Empty>
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
