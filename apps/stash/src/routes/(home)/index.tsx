import {useAtomRefresh, useAtomSet, useAtomValue} from '@effect/atom-react'

import {Array, Boolean, Function, HashSet, Match, Option, Schema, String, pipe} from 'effect'

import {
	Button as NativeButton,
	Divider,
	HStack,
	Image,
	Label,
	Menu,
	Overlay,
	Picker,
	Text,
	Toggle,
	ToolbarItem,
	VStack
} from '@expo/ui/swift-ui'
import {
	accessibilityElement,
	accessibilityHidden,
	accessibilityLabel,
	aspectRatio,
	foregroundStyle,
	frame,
	labelStyle,
	lineLimit,
	listRowInsets,
	listRowSeparator,
	menuOrder,
	pickerStyle,
	resizable,
	tag,
	tint
} from '@expo/ui/swift-ui/modifiers'
import {AsyncResult} from 'effect/reactivity'
import {Suspense} from 'react'
import {Linking} from 'react-native'

import {ItemGroupSkeleton} from '@deslop/components-mobile/blocks/item-group-skeleton'
import {ListToolbar} from '@deslop/components-mobile/blocks/list-toolbar'
import {FailureContent, Loaded} from '@deslop/components-mobile/blocks/loaded'
import {PasteSheet} from '@deslop/components-mobile/blocks/paste-sheet'
import {Problem} from '@deslop/components-mobile/blocks/problem'
import {RemovableRow} from '@deslop/components-mobile/blocks/removable-row'
import {StatusDot} from '@deslop/components-mobile/blocks/status-dot'
import {colors, space, text} from '@deslop/components-mobile/theme'
import {Button} from '@deslop/components-mobile/ui/button'
import {Empty, EmptyContent, EmptyMedia} from '@deslop/components-mobile/ui/empty'
import {ItemContent, ItemGroup, ItemMedia, ItemTitle} from '@deslop/components-mobile/ui/item'
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
import {Brand, Kind, TagName} from '#services/notes/schema.ts'

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
					<HStack spacing={space[2]} modifiers={[accessibilityElement('combine')]}>
						<StatusDot status="error" />
						<Text modifiers={[text.detail, foregroundStyle(colors.mutedForeground), lineLimit(1)]}>
							{`Couldn’t read this ${subjectOf(props.note)}`}
						</Text>
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
	return <Image uiImage={image.value} modifiers={[resizable(), aspectRatio({contentMode: 'fill'})]} />
}

function NoteMedia(props: {note: NoteItem}) {
	const kind = kindOf(props.note)
	return (
		<ItemMedia variant="image" modifiers={[accessibilityHidden(true)]}>
			{pipe(
				Match.value(kind),
				Match.when(Schema.is(Brand), brand => <BrandLogo brand={kinds[brand].logo} size={24} />),
				Match.orElse(other => (
					<Image systemName={kinds[other].symbol} size={24} modifiers={[foregroundStyle(colors.mutedForeground)]} />
				))
			)}
			{Option.isSome(props.note.image) && <Thumbnail id={props.note.id} />}
		</ItemMedia>
	)
}

function NoteRow(props: {note: NoteItem; onOpen: (id: Note['id']) => void; onRegenerate: (id: Note['id']) => void}) {
	return (
		<RemovableRow
			id={props.note.id}
			removal={removal}
			modifiers={[tag(props.note.id)]}
			onOpen={() => props.onOpen(props.note.id)}
			menu={
				<>
					{Option.match(props.note.url, {
						onNone: Function.constUndefined,
						onSome: url => (
							<NativeButton
								onPress={() => {
									Linking.openURL(url)
								}}
							>
								<Label
									title={Option.match(appOf(props.note), {
										onNone: Function.constant('Open Link'),
										onSome: name => `Open in ${name}`
									})}
									{...Option.match(brandOf(props.note), {
										onNone: () => ({systemImage: 'arrow.up.right' as const}),
										onSome: brand => ({icon: <BrandIcon brand={kinds[brand].logo} />})
									})}
								/>
							</NativeButton>
						)
					})}
					<NativeButton
						label="Regenerate"
						systemImage="arrow.clockwise"
						onPress={() => props.onRegenerate(props.note.id)}
					/>
				</>
			}
		>
			{pending => (
				<>
					<NoteMedia note={props.note} />
					<Lines muted={pending} note={props.note} />
				</>
			)}
		</RemovableRow>
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
		<Menu
			label="Filter"
			systemImage={Boolean.match(props.kind === undefined, {
				onFalse: Function.constant('line.3.horizontal.decrease.circle.fill'),
				onTrue: Function.constant('line.3.horizontal.decrease')
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

function Notes(props: {kind?: Kind; onOpen: (id: Note['id']) => void; onTag: (name?: TagName) => void; tag?: TagName}) {
	const regenerate = useAtomSet(regenerateAtom)
	const paste = useAtomSet(clipboard.atom.send)
	const query = String.trim(useAtomValue(queryAtom))
	const search = useAtomValue(searchAtom)
	const refreshSearch = useAtomRefresh(searchAtom)
	const found = pipe(search, AsyncResult.value, Option.flatten)
	return (
		<Loaded atom={notesAtom}>
			{all => {
				if (AsyncResult.isFailure(search) && Option.exists(AsyncResult.error(search), isDenied)) {
					return <FailureContent cause={search.cause} onRetry={refreshSearch} />
				}
				const notes = Array.filter(
					all,
					note =>
						Option.match(found, {onNone: Function.constTrue, onSome: ids => HashSet.has(ids, note.id)}) &&
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
									<EmptyContent>
										<Button
											size="lg"
											systemImage="link"
											onPress={() => paste(clipboard.events.Returned())}
											modifiers={[tint(primary)]}
										>
											Paste Link
										</Button>
									</EmptyContent>
								</Empty>
							),
							onNonEmpty: () => (
								// The empty state sits over the list, centered on the screen, as SwiftUI's own apps show it.
								<Overlay>
									<ItemGroup>
										{/* "all" clears the tag, and choosing the chosen tag again does too. */}
										<ToggleGroup
											value={[props.tag ?? 'all']}
											variant="outline"
											onValueChange={value =>
												pipe(
													value,
													Array.head,
													Option.filter(name => name !== 'all'),
													Option.match({onNone: () => props.onTag(), onSome: name => props.onTag(TagName.make(name))})
												)
											}
											modifiers={[
												tint(primary),
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
										{Array.map(notes, note => (
											<NoteRow key={note.id} note={note} onOpen={props.onOpen} onRegenerate={id => regenerate(id)} />
										))}
									</ItemGroup>
									{filtered && Array.isReadonlyArrayEmpty(notes) && (
										<Overlay.Content>
											<Empty>
												<EmptyMedia>
													<Image systemName="magnifyingglass" modifiers={[accessibilityLabel('No notes match')]} />
												</EmptyMedia>
											</Empty>
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
	onTag: (name?: TagName) => void
	tag?: TagName
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
		<ListToolbar
			title="Stash"
			session={session}
			onSearch={props.onSearch}
			problem={Boolean.match(saved && (AsyncResult.isFailure(notes) || AsyncResult.isFailure(search)), {
				onFalse: Function.constUndefined,
				onTrue: () => (
					<Problem
						label={Boolean.match(AsyncResult.isFailure(notes), {
							onFalse: Function.constant('Search unavailable'),
							onTrue: Function.constant('Out of date')
						})}
						onRetry={() => {
							refreshNotes()
							refreshSearch()
						}}
					/>
				)
			})}
			bottomBar={
				<>
					<ToolbarItem placement="bottomBar">
						<NativeButton
							label="Write"
							systemImage="square.and.pencil"
							onPress={props.onCompose}
							modifiers={[labelStyle('iconOnly')]}
						/>
					</ToolbarItem>
					<ToolbarItem placement="bottomBar">
						<FilterMenu kind={props.kind} onKind={props.onKind} />
					</ToolbarItem>
				</>
			}
		>
			<PasteSheet clipboard={clipboard}>
				<Suspense fallback={<ItemGroupSkeleton rows={10} descriptionLines={1} media={<ItemMedia variant="image" />} />}>
					<Notes kind={props.kind} onOpen={props.onOpen} onTag={props.onTag} tag={props.tag} />
				</Suspense>
			</PasteSheet>
		</ListToolbar>
	)
}
