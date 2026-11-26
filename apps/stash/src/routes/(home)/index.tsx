import {useAtomMount, useAtomRefresh, useAtomSet, useAtomValue} from '@effect/atom-react'

import {Array, Boolean, DateTime, Duration, Function, Match, Option, Schema, String, pipe} from 'effect'

import {
	Button as NativeButton,
	Divider,
	Image,
	Label,
	Menu,
	Overlay,
	Picker,
	Toggle,
	ToolbarItem,
	VStack
} from '@expo/ui/swift-ui'
import {
	accessibilityLabel,
	frame,
	labelStyle,
	listRowInsets,
	listRowSeparator,
	menuOrder,
	pickerStyle,
	tag,
	tint
} from '@expo/ui/swift-ui/modifiers'
import {AsyncResult} from 'effect/reactivity'
import {Suspense} from 'react'
import {Linking} from 'react-native'

import {ItemGroupSkeleton} from '@deslop/components-mobile/blocks/item-group-skeleton'
import {ListToolbar} from '@deslop/components-mobile/blocks/list-toolbar'
import {FailureContent, Loaded} from '@deslop/components-mobile/blocks/loaded'
import {Problem} from '@deslop/components-mobile/blocks/problem'
import {RemovableRow} from '@deslop/components-mobile/blocks/removable-row'
import {Row} from '@deslop/components-mobile/blocks/row'
import type {RowProblem} from '@deslop/components-mobile/blocks/row'
import {space} from '@deslop/components-mobile/theme'
import {Button} from '@deslop/components-mobile/ui/button'
import {Empty, EmptyContent, EmptyMedia} from '@deslop/components-mobile/ui/empty'
import {ItemGroup} from '@deslop/components-mobile/ui/item'
import {ToggleGroup, ToggleGroupItem} from '@deslop/components-mobile/ui/toggle-group'
import {clockAtom} from '@deslop/runtime/client/clock'
import {blockingFailure} from '@deslop/runtime/client/live-stream'
import {problemSinceAtom} from '@deslop/runtime/client/problem'
import {isDenied} from '@deslop/runtime/shared/auth'
import {ageOf, dayOf} from '@deslop/runtime/shared/format'

import {clipboard} from '#lib/clipboard.ts'
import {BrandIcon} from '#lib/icons.tsx'
import {appOf, brandOf, kindOf, kinds, siteOf, subjectOf} from '#lib/kinds.ts'
import {foundAtom, notesAtom, queryAtom, queueOf, regenerateAtom, removal, searchAtom} from '#lib/notes.ts'
import {primary, session} from '#lib/session.ts'
import {tagCounts} from '#services/notes/lib/utils.ts'
import type {Note, NoteItem} from '#services/notes/schema.ts'
import {BrandedKind, Kind, TagName} from '#services/notes/schema.ts'

// When the note was saved: hours ago within the day, then its date.
function savedOf(note: NoteItem, now: DateTime.Utc) {
	if (pipe(note.createdAt, DateTime.distance(now), Duration.isLessThan(Duration.days(1)))) {
		return ageOf(note.createdAt, now)
	}
	return dayOf(note.createdAt, now)
}

// The source and the summary on the muted line, or what the note is waiting on; a failed note's reason takes that line with its dot.
function NoteLines(props: {muted: boolean; note: NoteItem}) {
	const now = useAtomValue(clockAtom('1 minute'))
	return (
		<Row
			title={props.note.title}
			muted={props.muted}
			line={Option.some(
				pipe(
					Match.value(props.note.status),
					Match.when('organizing', () => `Reading this ${subjectOf(props.note)}`),
					Match.orElse(() =>
						pipe(
							[
								pipe(
									props.note.author,
									Option.orElse(() => siteOf(props.note)),
									Option.getOrElse(() => kinds[kindOf(props.note)].label)
								),
								props.note.summary
							],
							Array.filter(String.isNonEmpty),
							Array.join(' · ')
						)
					)
				)
			)}
			problem={Option.liftPredicate<RowProblem>(
				{reason: `Couldn’t read this ${subjectOf(props.note)}`, status: 'error'},
				() => props.note.status === 'failed'
			)}
			trailing={Option.some(savedOf(props.note, now))}
		/>
	)
}

function NoteRow(props: {note: NoteItem; onOpen: (id: Note['id']) => void; onRegenerate: (id: Note['id']) => void}) {
	return (
		<RemovableRow
			id={props.note.id}
			removal={removal}
			size="xs"
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
			{pending => <NoteLines muted={pending} note={props.note} />}
		</RemovableRow>
	)
}

function KindLabel(props: {kind: Kind}) {
	if (Schema.is(BrandedKind)(props.kind)) {
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
function FilterMenu(props: {kind: Option.Option<Kind>; onKind: (kind: Option.Option<Kind>) => void}) {
	return (
		<Menu
			label="Filter"
			systemImage={Boolean.match(Option.isNone(props.kind), {
				onFalse: Function.constant('line.3.horizontal.decrease.circle.fill'),
				onTrue: Function.constant('line.3.horizontal.decrease')
			})}
			modifiers={[labelStyle('iconOnly'), menuOrder('fixed')]}
		>
			<Toggle
				label="All Notes"
				systemImage="tray"
				isOn={Option.isNone(props.kind)}
				onIsOnChange={() => props.onKind(Option.none())}
			/>
			<Divider />
			<Picker<Kind>
				label="Show"
				{...Option.match(props.kind, {onNone: () => ({}), onSome: selection => ({selection})})}
				onSelectionChange={kind => props.onKind(Option.some(kind))}
				modifiers={[pickerStyle('inline')]}
			>
				{Array.map(Kind.literals, kind => (
					<KindLabel key={kind} kind={kind} />
				))}
			</Picker>
		</Menu>
	)
}

// HomeRoute shows Search unavailable with retry for outages; denied searches render FailureContent instead of cached notes.
function Notes(props: {
	kind: Option.Option<Kind>
	onOpen: (id: Note['id']) => void
	onTag: (name: Option.Option<TagName>) => void
	tag: Option.Option<TagName>
}) {
	const regenerate = useAtomSet(regenerateAtom)
	const paste = useAtomSet(clipboard.atom.send)
	const query = String.trim(useAtomValue(queryAtom))
	const search = useAtomValue(searchAtom(query))
	const refreshSearch = useAtomRefresh(searchAtom(query))
	const found = useAtomValue(foundAtom)
	return (
		<Loaded atom={notesAtom}>
			{all => {
				if (AsyncResult.isFailure(search) && Option.exists(AsyncResult.error(search), isDenied)) {
					return <FailureContent cause={search.cause} onRetry={refreshSearch} />
				}
				const notes = queueOf(all, {found, kind: props.kind, tag: props.tag})
				const tags = Array.map(tagCounts(all), entry => entry.tag)
				const filtered = String.isNonEmpty(query) || Option.isSome(props.tag) || Option.isSome(props.kind)
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
											value={[Option.getOrElse(props.tag, Function.constant('all'))]}
											variant="outline"
											onValueChange={value =>
												props.onTag(
													pipe(
														value,
														Array.head,
														Option.filter(name => name !== 'all'),
														Option.map(name => TagName.make(name))
													)
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
	kind: Option.Option<Kind>
	onCompose: () => void
	onKind: (kind: Option.Option<Kind>) => void
	onOpen: (id: Note['id']) => void
	onSearch: (text: string) => void
	onTag: (name: Option.Option<TagName>) => void
	tag: Option.Option<TagName>
}) {
	const notes = useAtomValue(notesAtom)
	const query = String.trim(useAtomValue(queryAtom))
	useAtomMount(problemSinceAtom(notesAtom))
	useAtomMount(problemSinceAtom(searchAtom(query)))
	const refreshNotes = useAtomRefresh(notesAtom)
	const search = useAtomValue(searchAtom(query))
	const refreshSearch = useAtomRefresh(searchAtom(query))
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
				onFalse: () => Option.none(),
				onTrue: () =>
					Option.some(
						<Problem
							source={Boolean.match(AsyncResult.isFailure(notes), {
								onFalse: () => searchAtom(query),
								onTrue: () => notesAtom
							})}
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
			<Suspense fallback={<ItemGroupSkeleton rows={10} descriptionLines={1} />}>
				<Notes kind={props.kind} onOpen={props.onOpen} onTag={props.onTag} tag={props.tag} />
			</Suspense>
		</ListToolbar>
	)
}
