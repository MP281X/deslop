import {useAtomMount, useAtomRefresh, useAtomSet, useAtomSuspense, useAtomValue} from '@effect/atom-react'

import {Array, Boolean, HashSet, Match, Option, Result, Schema, String, pipe} from 'effect'

import {
	Button,
	Divider,
	HStack,
	Image,
	Label,
	Menu,
	Overlay,
	Picker,
	SwipeActions,
	Text,
	Toggle,
	ZStack,
	Toolbar,
	ToolbarItem,
	VStack
} from '@expo/ui/swift-ui'
import type {useNativeState} from '@expo/ui/swift-ui'
import {
	accessibilityAddTraits,
	accessibilityElement,
	accessibilityHidden,
	alignmentGuide,
	aspectRatio,
	background,
	buttonBorderShape,
	buttonStyle,
	clipShape,
	controlSize,
	foregroundStyle,
	frame,
	labelStyle,
	lineLimit,
	listRowInsets,
	listRowSeparator,
	menuOrder,
	navigationBarTitleDisplayMode,
	navigationTitle,
	onAppear,
	pickerStyle,
	padding,
	resizable,
	searchable,
	tag,
	tint
} from '@expo/ui/swift-ui/modifiers'
import {useMachineResult} from '@typeonce/effect-machine-react'
import {AtomMachine} from '@typeonce/effect-machine/reactivity'
import {AsyncResult} from 'effect/reactivity'
import {useState} from 'react'
import type {ReactNode} from 'react'
import {Linking} from 'react-native'

import {AccountMenu} from '@deslop/components-mobile/account'
import {ClipboardDialog} from '@deslop/components-mobile/clipboard-dialog'
import {BrandIcon, BrandLogo} from '@deslop/components-mobile/icons'
import {Problem} from '@deslop/components-mobile/problem'
import {FailureContent, shownOf} from '@deslop/components-mobile/screens'
import {colors, radius, space, text} from '@deslop/components-mobile/theme'
import {
	Empty,
	EmptyContent,
	EmptyDescription,
	EmptyHeader,
	EmptyMedia,
	EmptyTitle
} from '@deslop/components-mobile/ui/empty'
import {
	Item,
	ItemActions,
	ItemContent,
	ItemGroup,
	ItemMedia,
	ItemTitle,
	itemRow
} from '@deslop/components-mobile/ui/item'
import {ToggleGroup, ToggleGroupItem} from '@deslop/components-mobile/ui/toggle-group'
import {bottomBarSearch} from '@deslop/components-mobile/utils'
import {isDenied} from '@deslop/runtime/auth/utils'

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
	searchAtom,
	session
} from '#lib/utils.ts'
import {tagCounts} from '#services/notes/lib/utils.ts'
import type {Note, NoteItem} from '#services/notes/schema.ts'
import {Brand, Kind} from '#services/notes/schema.ts'

const OFFERS = {image: 'Save the copied image?', link: 'Save the copied link?', text: 'Save the copied link?'} as const

// The summary waits in the note, so the list scans fast.
function Lines(props: {note: NoteItem}) {
	return (
		<ItemContent>
			<ItemTitle>{props.note.title}</ItemTitle>
			{pipe(
				Match.value(props.note.status),
				Match.when('organizing', () => (
					<HStack
						spacing={space[1]}
						modifiers={[accessibilityElement('combine'), foregroundStyle(colors.mutedForeground)]}
					>
						<Image systemName="sparkles" modifiers={[text.caption, accessibilityHidden(true)]} />
						<Text modifiers={[text.detail, lineLimit(1)]}>Reading the source</Text>
					</HStack>
				)),
				Match.when('failed', () => (
					<HStack spacing={space[1]} modifiers={[accessibilityElement('combine'), foregroundStyle(colors.destructive)]}>
						<Image systemName="exclamationmark.triangle.fill" modifiers={[text.caption, accessibilityHidden(true)]} />
						<Text modifiers={[text.detail, lineLimit(1)]}>Couldn’t read this link</Text>
					</HStack>
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
				clipShape('roundedRectangle', radius),
				accessibilityHidden(true)
			]}
		/>
	)
}

function NoteMedia(props: {note: NoteItem}) {
	const kind = kindOf(props.note)
	return (
		<ZStack
			modifiers={[
				frame({height: 64, width: 64}),
				background(colors.card),
				clipShape('roundedRectangle', radius),
				accessibilityHidden(true)
			]}
		>
			{pipe(
				Match.value(kind),
				Match.when(Schema.is(Brand), brand => <BrandLogo brand={kinds[brand].logo} size={24} />),
				Match.orElse(other => (
					<Image systemName={kinds[other].symbol} size={24} modifiers={[foregroundStyle(colors.mutedForeground)]} />
				))
			)}
			{props.note.image !== undefined && <Thumbnail id={props.note.id} />}
		</ZStack>
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

// One trash at the row's end; the rest of the note's actions sit behind the … menu.
function NoteRowActions(props: {
	note: NoteItem
	onRegenerate: (id: Note['id']) => void
	onRemove: (id: Note['id']) => void
}) {
	return (
		<ItemActions>
			<Menu label="More" systemImage="ellipsis" modifiers={[labelStyle('iconOnly')]}>
				{Option.match(Option.fromNullishOr(props.note.url), {
					onNone: () => undefined,
					onSome: url => (
						<Button onPress={() => Linking.openURL(url)}>
							<Label
								title={Option.match(appOf(props.note), {onNone: () => 'Open Link', onSome: name => `Open in ${name}`})}
								{...Option.match(brandOf(props.note), {
									onNone: () => ({systemImage: 'arrow.up.right' as const}),
									onSome: brand => ({icon: <BrandIcon brand={kinds[brand].logo} />})
								})}
							/>
						</Button>
					)
				})}
				<Button label="Regenerate" systemImage="arrow.clockwise" onPress={() => props.onRegenerate(props.note.id)} />
			</Menu>
			<Button
				label="Delete"
				systemImage="trash"
				role="destructive"
				onPress={() => props.onRemove(props.note.id)}
				modifiers={[labelStyle('iconOnly'), tint(colors.destructive)]}
			/>
		</ItemActions>
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
			<Item
				onPress={() => props.onOpen(props.note.id)}
				modifiers={[
					accessibilityAddTraits(['isButton']),
					alignmentGuide('listRowSeparatorLeading', 0),
					onAppear(props.onAppear)
				]}
			>
				<ItemMedia>
					<NoteMedia note={props.note} />
				</ItemMedia>
				<Lines note={props.note} />
				<NoteRowActions note={props.note} onRegenerate={props.onRegenerate} onRemove={props.onRemove} />
			</Item>
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

function PasteSheet(props: {children: ReactNode}) {
	useAtomMount(clipboardReturnsAtom)
	const offer = pipe(useMachineResult(AtomMachine.select(clipboardAtom, 'Offered')), AsyncResult.getOrElse(Option.none))
	const send = useAtomSet(clipboardAtom.send)
	const kind = Option.match(offer, {onNone: () => 'link' as const, onSome: open => open.kind})
	return (
		<ClipboardDialog
			confirm="Save"
			onAnswer={save => send({_tag: 'Answered', save})}
			open={Option.isSome(offer)}
			question={OFFERS[kind]}
		>
			{props.children}
		</ClipboardDialog>
	)
}

function Outages() {
	const notes = useAtomValue(notesAtom)
	const refresh = useAtomRefresh(notesAtom)
	const search = useAtomValue(searchAtom)
	const refreshSearch = useAtomRefresh(searchAtom)
	if (!AsyncResult.isFailure(notes) && !AsyncResult.isFailure(search)) return null
	return (
		<HStack modifiers={[frame({alignment: 'trailing', maxWidth: Infinity}), padding({horizontal: space[4]})]}>
			{AsyncResult.isFailure(notes) && <Problem label="Notes not updating" onRetry={refresh} />}
			{AsyncResult.isFailure(search) && (
				<Problem
					label="Search unavailable"
					saved={Option.isSome(pipe(search, AsyncResult.value, Option.flatten))}
					onRetry={refreshSearch}
				/>
			)}
		</HStack>
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
	const loaded = useAtomSuspense(notesAtom, {includeFailure: true})
	const refresh = useAtomRefresh(notesAtom)
	const remove = useAtomSet(removeAtom)
	const regenerate = useAtomSet(regenerateAtom)
	const query = String.trim(useAtomValue(queryAtom))
	const search = useAtomValue(searchAtom)
	const refreshSearch = useAtomRefresh(searchAtom)
	const found = pipe(search, AsyncResult.value, Option.flatten)
	const [limit, setLimit] = useState(80)
	const shown = shownOf(loaded)
	if (Result.isFailure(shown)) {
		return <FailureContent cause={shown.failure} name="Notes" onRetry={refresh} />
	}
	if (AsyncResult.isFailure(search) && Option.exists(AsyncResult.error(search), isDenied)) {
		return <FailureContent cause={search.cause} name="Search" onRetry={refreshSearch} />
	}
	const notes = Array.filter(
		shown.success,
		note =>
			Option.match(found, {onNone: () => true, onSome: ids => HashSet.has(ids, note.id)}) &&
			(props.tag === undefined || Array.contains(note.tags, props.tag)) &&
			(props.kind === undefined || kindOf(note) === props.kind)
	)
	const tags = Array.map(tagCounts(shown.success), entry => entry.tag)
	const filtered = String.isNonEmpty(query) || props.tag !== undefined || props.kind !== undefined

	return (
		<Toolbar modifiers={[navigationTitle('Stash'), navigationBarTitleDisplayMode('large')]}>
			{/* SwiftUI shows the outermost toolbar's items first: the filter, the search field, then write. */}
			<Toolbar modifiers={[searchable(props.query, {onChange: props.onSearch, prompt: 'Search'}), bottomBarSearch]}>
				<PasteSheet>
					<VStack spacing={0} modifiers={[frame({maxHeight: Infinity})]}>
						<Outages />
						{Array.match(shown.success, {
							onEmpty: () => (
								<Empty>
									<EmptyHeader>
										<EmptyMedia systemImage="tray" />
										<EmptyTitle>Nothing saved yet</EmptyTitle>
										<EmptyDescription>Share a link to Stash, or write a note.</EmptyDescription>
									</EmptyHeader>
									<EmptyContent>
										<Button
											label="Write a note"
											systemImage="square.and.pencil"
											onPress={props.onCompose}
											modifiers={[
												buttonStyle('glassProminent'),
												buttonBorderShape('capsule'),
												controlSize('large'),
												tint(primary)
											]}
										/>
									</EmptyContent>
								</Empty>
							),
							onNonEmpty: () => (
								<Overlay>
									<ItemGroup>
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
												<EmptyHeader>
													<EmptyMedia
														systemImage={Boolean.match(String.isEmpty(query), {
															onFalse: () => 'magnifyingglass',
															onTrue: () => 'tray'
														})}
													/>
													<EmptyTitle>No notes match</EmptyTitle>
													<EmptyDescription>Try another search or tag.</EmptyDescription>
												</EmptyHeader>
											</Empty>
										</Overlay.Content>
									)}
								</Overlay>
							)
						})}
					</VStack>
				</PasteSheet>
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
				<ToolbarItem placement="topBarTrailing">
					<AccountMenu session={session} />
				</ToolbarItem>
				<ToolbarItem placement="bottomBar">
					<FilterMenu kind={props.kind} onKind={props.onKind} />
				</ToolbarItem>
			</Toolbar.Content>
		</Toolbar>
	)
}
