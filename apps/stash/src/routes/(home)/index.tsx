import {useAtomRefresh, useAtomSet, useAtomValue} from '@effect/atom-react'

import {Array, Boolean, HashSet, Match, Option, Schema, String, pipe} from 'effect'

import {
	Button,
	ContextMenu,
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
	aspectRatio,
	background,
	clipShape,
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
	resizable,
	searchable,
	tag,
	tint
} from '@expo/ui/swift-ui/modifiers'
import {MachineState} from '@typeonce/effect-machine-react'
import {AsyncResult} from 'effect/reactivity'
import {Suspense, useState} from 'react'
import {Linking} from 'react-native'

import {AccountMenu} from '@deslop/components-mobile/account'
import {PasteSheet} from '@deslop/components-mobile/paste-sheet'
import {Problem} from '@deslop/components-mobile/problem'
import {FailureContent, Loaded} from '@deslop/components-mobile/screens'
import {colors, radius, space, text} from '@deslop/components-mobile/theme'
import {bottomBarSearch} from '@deslop/components-mobile/toolbar'
import {Empty, EmptyAction} from '@deslop/components-mobile/ui/empty'
import {
	Item,
	ItemActions,
	ItemContent,
	ItemGroup,
	ItemMedia,
	ItemTitle,
	itemRow
} from '@deslop/components-mobile/ui/item'
import {ItemGroupSkeleton, Skeleton} from '@deslop/components-mobile/ui/skeleton'
import {ToggleGroup, ToggleGroupItem} from '@deslop/components-mobile/ui/toggle-group'
import {blockingFailure} from '@deslop/runtime/client/live-stream'
import {isDenied} from '@deslop/runtime/shared/auth'

import {clipboard} from '#lib/clipboard.ts'
import {Byline} from '#lib/components.tsx'
import {BrandIcon, BrandLogo} from '#lib/icons.tsx'
import {appOf, brandOf, kindOf, kinds, subjectOf} from '#lib/kinds.ts'
import {imageAtom, notesAtom, queryAtom, regenerateAtom, removal, searchAtom} from '#lib/notes.ts'
import {primary, session} from '#lib/session.ts'
import {tagCounts} from '#services/notes/lib/utils.ts'
import type {Note, NoteItem} from '#services/notes/schema.ts'
import {Brand, Kind} from '#services/notes/schema.ts'

// The summary waits in the note, so the list scans fast.
function Lines(props: {muted?: boolean; note: NoteItem}) {
	return (
		<ItemContent>
			<ItemTitle
				modifiers={Boolean.match(props.muted === true, {
					onFalse: () => [],
					onTrue: () => [foregroundStyle(colors.mutedForeground)]
				})}
			>
				{props.note.title}
			</ItemTitle>
			{pipe(
				Match.value(props.note.status),
				Match.when('organizing', () => (
					<HStack
						spacing={space[1]}
						modifiers={[accessibilityElement('combine'), foregroundStyle(colors.mutedForeground)]}
					>
						<Image systemName="sparkles" modifiers={[text.caption, accessibilityHidden(true)]} />
						<Text modifiers={[text.detail, lineLimit(1)]}>{`Reading this ${subjectOf(props.note)}`}</Text>
					</HStack>
				)),
				Match.when('failed', () => (
					<HStack
						spacing={space[1]}
						modifiers={[
							accessibilityElement('combine'),
							Boolean.match(props.muted === true, {
								onFalse: () => foregroundStyle(colors.destructive),
								onTrue: () => foregroundStyle(colors.mutedForeground)
							})
						]}
					>
						<Image systemName="exclamationmark.triangle.fill" modifiers={[text.caption, accessibilityHidden(true)]} />
						<Text modifiers={[text.detail, lineLimit(1)]}>{`Couldn’t read this ${subjectOf(props.note)}`}</Text>
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
			{Option.isSome(props.note.image) && <Thumbnail id={props.note.id} />}
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

function NoteRow(props: {
	note: NoteItem
	onAppear: () => void
	onOpen: (id: Note['id']) => void
	onRegenerate: (id: Note['id']) => void
}) {
	const machine = removal.machine(props.note.id)
	const remove = useAtomSet(removal.removeAtom)
	const send = useAtomSet(machine.send)
	return (
		<>
			<MachineState machine={machine} path="Idle">
				{() => (
					<SwipeActions modifiers={[...itemRow, tag(props.note.id)]}>
						<ContextMenu>
							<ContextMenu.Trigger>
								<Item
									onPress={() => props.onOpen(props.note.id)}
									modifiers={[accessibilityAddTraits(['isButton']), onAppear(props.onAppear)]}
								>
									<ItemMedia>
										<NoteMedia note={props.note} />
									</ItemMedia>
									<Lines note={props.note} />
								</Item>
							</ContextMenu.Trigger>
							<ContextMenu.Items>
								{Option.match(props.note.url, {
									onNone: () => undefined,
									onSome: url => (
										<Button
											onPress={() => {
												Linking.openURL(url)
											}}
										>
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
								<Button
									label="Regenerate"
									systemImage="arrow.clockwise"
									onPress={() => props.onRegenerate(props.note.id)}
								/>
								<DeleteButton onPress={() => remove(props.note.id)} />
							</ContextMenu.Items>
						</ContextMenu>
						<SwipeActions.Actions edge="trailing">
							<DeleteButton onPress={() => remove(props.note.id)} />
						</SwipeActions.Actions>
					</SwipeActions>
				)}
			</MachineState>
			<MachineState machine={machine} path="Pending">
				{() => (
					<Item modifiers={itemRow}>
						<ItemMedia>
							<NoteMedia note={props.note} />
						</ItemMedia>
						<Lines muted note={props.note} />
						<ItemActions>
							<Button
								label="Undo"
								systemImage="arrow.uturn.backward"
								onPress={() => send({_tag: 'Restored'})}
								modifiers={[labelStyle('iconOnly')]}
							/>
						</ItemActions>
					</Item>
				)}
			</MachineState>
		</>
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

function Notes(props: {kind?: Kind; onOpen: (id: Note['id']) => void; onTag: (name?: string) => void; tag?: string}) {
	const regenerate = useAtomSet(regenerateAtom)
	const paste = useAtomSet(clipboard.atom.send)
	const query = String.trim(useAtomValue(queryAtom))
	const search = useAtomValue(searchAtom)
	const refreshSearch = useAtomRefresh(searchAtom)
	const found = pipe(search, AsyncResult.value, Option.flatten)
	const [limit, setLimit] = useState(80)
	return (
		<Loaded atom={notesAtom} name="Notes">
			{all => {
				if (AsyncResult.isFailure(search) && Option.exists(AsyncResult.error(search), isDenied)) {
					return <FailureContent cause={search.cause} name="Search" onRetry={refreshSearch} />
				}
				const notes = Array.filter(
					all,
					note =>
						Option.match(found, {onNone: () => true, onSome: ids => HashSet.has(ids, note.id)}) &&
						(props.tag === undefined || Array.contains(note.tags, props.tag)) &&
						(props.kind === undefined || kindOf(note) === props.kind)
				)
				const tags = Array.map(tagCounts(all), entry => entry.tag)
				const filtered = String.isNonEmpty(query) || props.tag !== undefined || props.kind !== undefined
				return (
					<VStack spacing={0} modifiers={[frame({maxHeight: Infinity})]}>
						{Array.match(all, {
							onEmpty: () => (
								<Empty>
									<EmptyAction
										label="Paste Link"
										systemImage="link"
										onPress={() => paste({_tag: 'Returned'})}
										tint={primary}
									/>
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
										{pipe(
											notes,
											Array.take(limit),
											Array.map((note, position) => (
												<NoteRow
													key={note.id}
													note={note}
													onAppear={() => {
														if (position === limit - 1) setLimit(limit + 80)
													}}
													onOpen={props.onOpen}
													onRegenerate={id => regenerate(id)}
												/>
											))
										)}
									</ItemGroup>
									{filtered && Array.isReadonlyArrayEmpty(notes) && (
										<Overlay.Content>
											<Empty
												systemImage={Boolean.match(String.isEmpty(query), {
													onFalse: () => 'magnifyingglass',
													onTrue: () => 'tray'
												})}
												label="No notes match"
											/>
										</Overlay.Content>
									)}
								</Overlay>
							)
						})}
					</VStack>
				)
			}}
		</Loaded>
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
	const notes = useAtomValue(notesAtom)
	const refreshNotes = useAtomRefresh(notesAtom)
	const search = useAtomValue(searchAtom)
	const refreshSearch = useAtomRefresh(searchAtom)
	const saved =
		!(AsyncResult.isFailure(search) && Option.exists(AsyncResult.error(search), isDenied)) &&
		!AsyncResult.isInitial(notes) &&
		Option.isNone(blockingFailure(notes))
	return (
		<Toolbar
			modifiers={[
				navigationTitle('Stash'),
				navigationBarTitleDisplayMode('large'),
				searchable(props.query, {onChange: props.onSearch, prompt: 'Search'}),
				bottomBarSearch
			]}
		>
			<PasteSheet clipboard={clipboard}>
				<Suspense
					fallback={
						<ItemGroupSkeleton
							rows={10}
							descriptionLines={1}
							media={<Skeleton modifiers={[frame({height: 64, width: 64})]} />}
						/>
					}
				>
					<Notes kind={props.kind} onOpen={props.onOpen} onTag={props.onTag} tag={props.tag} />
				</Suspense>
			</PasteSheet>
			<Toolbar.Content>
				{saved && (AsyncResult.isFailure(notes) || AsyncResult.isFailure(search)) && (
					<ToolbarItem placement="topBarLeading">
						<Problem
							label={Boolean.match(AsyncResult.isFailure(notes), {
								onFalse: () => 'Search unavailable',
								onTrue: () => 'Notes not updating'
							})}
							onRetry={() => {
								refreshNotes()
								refreshSearch()
							}}
						/>
					</ToolbarItem>
				)}
				<ToolbarItem placement="topBarTrailing">
					<AccountMenu session={session} />
				</ToolbarItem>
				<ToolbarItem placement="bottomBar">
					<Button
						label="Write"
						systemImage="square.and.pencil"
						onPress={props.onCompose}
						modifiers={[labelStyle('iconOnly')]}
					/>
				</ToolbarItem>
				<ToolbarItem placement="bottomBar">
					<FilterMenu kind={props.kind} onKind={props.onKind} />
				</ToolbarItem>
			</Toolbar.Content>
		</Toolbar>
	)
}
