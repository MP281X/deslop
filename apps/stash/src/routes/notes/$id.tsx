import {
	RegistryContext,
	useAtomMount,
	useAtomRefresh,
	useAtomSet,
	useAtomSubscribe,
	useAtomSuspense,
	useAtomValue
} from '@effect/atom-react'

import {Array, Boolean, Function, Match, Option, Schema, String, pipe} from 'effect'

import {
	Button as NativeButton,
	Divider,
	Group,
	HStack,
	Image,
	Menu,
	ScrollView,
	ShareLink,
	Text,
	Toolbar,
	ToolbarItem,
	VStack,
	useNativeState
} from '@expo/ui/swift-ui'
import {
	accessibilityElement,
	accessibilityLabel,
	foregroundStyle,
	frame,
	id,
	labelStyle,
	lineSpacing,
	navigationBarTitleDisplayMode,
	navigationTitle,
	onGeometryChange,
	onScrollPhaseChange,
	padding,
	redacted,
	scrollPosition,
	scrollTargetLayout,
	textSelection,
	tint
} from '@expo/ui/swift-ui/modifiers'
import {AsyncResult, Atom} from 'effect/reactivity'
import {Suspense, useContext, useRef} from 'react'
import {Linking} from 'react-native'

import {useListBeside, useListShow} from '@deslop/components-mobile/blocks/list-detail'
import {FailureContent, Loaded} from '@deslop/components-mobile/blocks/loaded'
import {Problem} from '@deslop/components-mobile/blocks/problem'
import {barNeverMinimizes} from '@deslop/components-mobile/lib/toolbar'
import {colors, space, text} from '@deslop/components-mobile/theme'
import {Button} from '@deslop/components-mobile/ui/button'
import {Empty, EmptyContent, EmptyMedia} from '@deslop/components-mobile/ui/empty'
import {Skeleton} from '@deslop/components-mobile/ui/skeleton'
import {ToggleGroup, ToggleGroupItem} from '@deslop/components-mobile/ui/toggle-group'
import {problemSinceAtom} from '@deslop/runtime/client/problem'
import {AuthError} from '@deslop/runtime/shared/auth'

import {Byline} from '#lib/components.tsx'
import {BrandLogo} from '#lib/icons.tsx'
import {appOf, brandOf, kinds, subjectOf} from '#lib/kinds.ts'
import {webLinksOnly} from '#lib/markdown.ts'
import {foundAtom, noteAtom, notesAtom, queueOf, regenerateAtom, removal} from '#lib/notes.ts'
import {Pager} from '#lib/pager.tsx'
import {primary} from '#lib/session.ts'
import type {Kind, NoteId, NoteItem} from '#services/notes/schema.ts'
import {TagName} from '#services/notes/schema.ts'

const prose = [text.body, lineSpacing(space[1]), foregroundStyle(colors.foreground), textSelection(true)]

const lede = [text.body, lineSpacing(space[1]), foregroundStyle(colors.mutedForeground), textSelection(true)]

function BodyLine(props: {line: string}) {
	return pipe(
		Match.value(props.line),
		// A heading's hashes are followed by a space; a line opening with a #hashtag is text.
		Match.when(
			candidate => Option.isSome(String.match(/^#+\s/u)(candidate)),
			() => (
				<Text modifiers={[text.title, foregroundStyle(colors.foreground), padding({top: space[3]})]}>
					{String.replace(/^#+\s*/u, '')(props.line)}
				</Text>
			)
		),
		Match.when(
			candidate => Option.isSome(String.match(/^(?:[-*•]|\d+\.)\s/u)(candidate)),
			() => (
				<HStack alignment="firstTextBaseline" spacing={space[2]}>
					<Text modifiers={[text.body, foregroundStyle(colors.mutedForeground)]}>
						{Boolean.match(String.startsWith('- ')(props.line), {
							onFalse: () => String.replace(/\s.*$/u, '')(props.line),
							onTrue: Function.constant('•')
						})}
					</Text>
					<Text markdownEnabled modifiers={[...prose, frame({alignment: 'leading', maxWidth: Infinity})]}>
						{String.replace(/^\S+\s/u, '')(props.line)}
					</Text>
				</HStack>
			)
		),
		Match.when(String.startsWith('> '), () => (
			<Text
				markdownEnabled
				modifiers={[...prose, foregroundStyle(colors.mutedForeground), padding({leading: space[3]})]}
			>
				{String.slice(2)(props.line)}
			</Text>
		)),
		Match.orElse(() => (
			<Text markdownEnabled modifiers={prose}>
				{props.line}
			</Text>
		))
	)
}

function Body(props: {text: string}) {
	return (
		<VStack
			alignment="leading"
			spacing={space[3]}
			modifiers={[frame({alignment: 'leading', maxWidth: Infinity}), tint(primary), scrollTargetLayout()]}
		>
			{pipe(
				props.text,
				String.split('\n'),
				Array.map(String.trim),
				Array.filter(String.isNonEmpty),
				Array.map(webLinksOnly),
				Array.map((line, index) => (
					// oxlint-disable-next-line react/no-array-index-key -- Note lines have no identity beyond their position; editing text replaces that position's contents.
					<Group key={index} modifiers={[id(`${index}`)]}>
						<BodyLine line={line} />
					</Group>
				))
			)}
		</VStack>
	)
}

function Placeholder() {
	return (
		<VStack
			alignment="leading"
			spacing={space[3]}
			modifiers={[redacted('placeholder'), accessibilityElement('ignore'), accessibilityLabel('Loading the note body')]}
		>
			<Body
				text={
					'The main point of the entry, in one or two plain sentences.\n- A takeaway a developer keeps from it.\n- Another takeaway with a tool and what it does.\n- A number that matters.'
				}
			/>
		</VStack>
	)
}

export function NoteSkeleton() {
	return (
		<VStack
			alignment="leading"
			spacing={space[4]}
			modifiers={[
				padding({bottom: space[8], horizontal: space[4], top: space[2]}),
				frame({alignment: 'leading', maxHeight: Infinity, maxWidth: Infinity})
			]}
		>
			<Placeholder />
		</VStack>
	)
}

// The summary and body a note shows once Stash has read its link.
function Reading(props: {note: NoteItem}) {
	return (
		<VStack
			alignment="leading"
			spacing={space[4]}
			modifiers={[
				frame({alignment: 'leading', maxWidth: Infinity}),
				accessibilityElement('ignore'),
				accessibilityLabel(`Reading this ${subjectOf(props.note)}`)
			]}
		>
			<Skeleton modifiers={[frame({height: 14}), frame({maxWidth: 300})]} />
			<VStack alignment="leading" spacing={space[3]}>
				<Skeleton modifiers={[frame({height: 14}), frame({maxWidth: Infinity})]} />
				<Skeleton modifiers={[frame({height: 14}), frame({maxWidth: 320})]} />
				<HStack spacing={space[2]}>
					<Skeleton modifiers={[frame({height: 14, width: 6})]} />
					<Skeleton modifiers={[frame({height: 14}), frame({maxWidth: 280})]} />
				</HStack>
				<HStack spacing={space[2]}>
					<Skeleton modifiers={[frame({height: 14, width: 6})]} />
					<Skeleton modifiers={[frame({height: 14}), frame({maxWidth: 300})]} />
				</HStack>
				<HStack spacing={space[2]}>
					<Skeleton modifiers={[frame({height: 14, width: 6})]} />
					<Skeleton modifiers={[frame({height: 14}), frame({maxWidth: 240})]} />
				</HStack>
			</VStack>
		</VStack>
	)
}

// Detail owns authentication failures and its toolbar's NoteProblem owns body-load failures; this pane only retains the saved body under that shared error presentation.
function FullBody(props: {note: NoteItem}) {
	const full = useAtomSuspense(noteAtom(props.note), {includeFailure: true})
	if (Option.exists(AsyncResult.error(full), Schema.is(AuthError))) return undefined
	return pipe(
		AsyncResult.value(full),
		Option.flatMap(note => note.body),
		Option.match({onNone: Function.constUndefined, onSome: body => <Body text={body} />})
	)
}

function issueOf(note: NoteItem) {
	return Option.getOrElse(note.issue, () =>
		Boolean.match(Option.isSome(note.file), {
			onFalse: Function.constant('Can’t Read This Link'),
			onTrue: Function.constant('Can’t Read This File')
		})
	)
}

// The note's one problem mark, in the bar as on every screen: a failed read that kept content, else a body that stopped loading.
function NoteProblem(props: {note: NoteItem; onRetry: () => void}) {
	const full = useAtomValue(noteAtom(props.note))
	useAtomMount(problemSinceAtom(noteAtom(props.note)))
	const reload = useAtomRefresh(noteAtom(props.note))
	const body = Option.exists(AsyncResult.value(full), note => Option.isSome(note.body))
	if (props.note.status === 'failed' && (String.isNonEmpty(props.note.summary) || body)) {
		return (
			<ToolbarItem placement="topBarLeading">
				<Problem source={noteAtom(props.note)} label={issueOf(props.note)} onRetry={props.onRetry} />
			</ToolbarItem>
		)
	}
	if (!AsyncResult.isFailure(full) || Option.exists(AsyncResult.error(full), Schema.is(AuthError))) return undefined
	return (
		<ToolbarItem placement="topBarLeading">
			<Problem source={noteAtom(props.note)} label="Note body unavailable" saved={body} onRetry={reload} />
		</ToolbarItem>
	)
}

function NoteContent(props: {note: NoteItem}) {
	return (
		<VStack alignment="leading" spacing={space[4]}>
			{String.isNonEmpty(props.note.summary) && <Text modifiers={lede}>{props.note.summary}</Text>}
			<Suspense fallback={<Placeholder />}>
				<FullBody note={props.note} />
			</Suspense>
		</VStack>
	)
}

// The note's size, which every fold, unfold or turn changes, and whether its scrolling has come to rest.
const widthAtom = Atom.make(0)
const heightAtom = Atom.make(0)
const restingAtom = Atom.make(true)
// The frame after a fold, unfold or turn cleared a line from the top, in which the note whose place it is sets the line again. Only a mounted note hears it, so the write never outlives the note's place.
const restoringAtom = Atom.make(Option.none<{line: string; place: unknown}>())

// The scroll view's modifiers that keep the line the person left at the top there through every fold, unfold and turn.
function useReadingPlace() {
	// The line crossing the top edge of the screen.
	const place = useNativeState<string | null>(null)
	// The line the person left at the top when they last stopped scrolling. A fold or turn rewraps the text at the same scroll offset while still reporting that line, so the line is cleared and set again a frame later, which scrolls it back to the top.
	const reading = useRef<string>(null)
	const registry = useContext(RegistryContext)
	const setWidth = useAtomSet(widthAtom)
	const setHeight = useAtomSet(heightAtom)
	const setResting = useAtomSet(restingAtom)
	function restore() {
		const line = reading.current
		if (line === null) return
		place.set(null)
		requestAnimationFrame(() => registry.set(restoringAtom, Option.some({line, place})))
	}
	useAtomSubscribe(restoringAtom, restoring => {
		pipe(
			restoring,
			Option.filter(pending => pending.place === place),
			Option.map(pending => place.set(pending.line))
		)
	})
	useAtomSubscribe(restingAtom, resting => {
		if (resting) reading.current = place.get()
	})
	useAtomSubscribe(widthAtom, restore)
	// The bar shrinking while the person scrolls changes the height too, so only a height change at rest, as unfolding from laptop posture and back, restores the line; a note pushed past its end by a taller window would otherwise stay there once the window is short again.
	useAtomSubscribe(heightAtom, () => {
		if (registry.get(restingAtom)) restore()
	})
	return [
		scrollPosition(place, {anchor: 'top'}),
		onScrollPhaseChange(phase => setResting(phase === 'idle')),
		onGeometryChange(bounds => {
			setWidth(bounds.width)
			setHeight(bounds.height)
		})
	]
}

function Detail(props: {note: NoteItem; onRetry: () => void; onTag: (tag: TagName) => void}) {
	const reading = useReadingPlace()
	const full = useAtomValue(noteAtom(props.note))
	useAtomMount(problemSinceAtom(noteAtom(props.note)))
	const reload = useAtomRefresh(noteAtom(props.note))
	if (AsyncResult.isFailure(full) && Option.exists(AsyncResult.error(full), Schema.is(AuthError))) {
		return <FailureContent cause={full.cause} onRetry={reload} />
	}
	const issue = issueOf(props.note)
	const kept =
		String.isNonEmpty(props.note.summary) || Option.exists(AsyncResult.value(full), note => Option.isSome(note.body))
	return (
		<ScrollView modifiers={reading}>
			<VStack
				alignment="leading"
				spacing={space[4]}
				modifiers={[padding({bottom: space[8], top: space[2]}), frame({alignment: 'leading', maxWidth: Infinity})]}
			>
				<Pager note={props.note} />
				<VStack
					alignment="leading"
					spacing={space[4]}
					modifiers={[padding({horizontal: space[4]}), frame({alignment: 'leading', maxWidth: Infinity})]}
				>
					{pipe(
						Match.value(props.note.status),
						Match.when('organizing', () => <Reading note={props.note} />),
						Match.when('failed', () =>
							Boolean.match(kept, {
								onFalse: () => (
									<Empty>
										<EmptyContent>
											<Button variant="destructive" size="lg" systemImage="arrow.clockwise" onPress={props.onRetry}>
												{issue}
											</Button>
										</EmptyContent>
									</Empty>
								),
								onTrue: () => <NoteContent note={props.note} />
							})
						),
						Match.orElse(() => <NoteContent note={props.note} />)
					)}
					<Divider />
					<Byline note={props.note} />
					{!Array.isReadonlyArrayEmpty(props.note.tags) && (
						<ToggleGroup
							value={[]}
							variant="outline"
							onValueChange={value =>
								Option.match(Array.head(value), {
									onNone: Function.constUndefined,
									onSome: name => props.onTag(TagName.make(name))
								})
							}
							modifiers={[tint(primary)]}
						>
							{Array.map(props.note.tags, tag => (
								<ToggleGroupItem key={tag} value={tag}>
									{tag}
								</ToggleGroupItem>
							))}
						</ToggleGroup>
					)}
				</VStack>
			</VStack>
		</ScrollView>
	)
}

// The opened note, which stays when the queue's filter leaves it out, or with nothing opened the queue's first, shown only while the queue is beside it.
function NoteScreen(props: {
	id: Option.Option<NoteId>
	kind: Option.Option<Kind>
	notes: readonly NoteItem[]
	onClose: () => void
	onTag: (tag: TagName, note: NoteId) => void
	tag: Option.Option<TagName>
}) {
	const remove = useAtomSet(removal.removeAtom)
	const regenerate = useAtomSet(regenerateAtom)
	const found = useAtomValue(foundAtom)
	const beside = useListBeside()
	const show = useListShow()
	if (Option.isNone(props.id) && !beside) return undefined
	return pipe(
		props.id,
		Option.match({
			onNone: () => Array.head(queueOf(props.notes, {found, kind: props.kind, tag: props.tag})),
			onSome: opened => Array.findFirst(props.notes, item => item.id === opened)
		}),
		Option.match({
			onNone: () =>
				Option.match(props.id, {
					onNone: Function.constUndefined,
					onSome: () => (
						<Empty>
							<EmptyMedia>
								<Image systemName="trash" modifiers={[accessibilityLabel('Note Deleted')]} />
							</EmptyMedia>
						</Empty>
					)
				}),
			onSome: item => (
				<Toolbar
					modifiers={[
						navigationTitle(item.title),
						navigationBarTitleDisplayMode('inline'),
						// Beside the hidden queue, the bar's Show Sidebar is the only way back to it, so scrolling never minimizes it away.
						barNeverMinimizes(Option.isSome(show) && !beside)
					]}
				>
					<Detail
						key={item.id}
						note={item}
						onRetry={() => regenerate(item.id)}
						onTag={tag => {
							props.onTag(tag, item.id)
							Option.match(show, {onNone: props.onClose, onSome: reveal => reveal()})
						}}
					/>
					<Toolbar.Content>
						<NoteProblem note={item} onRetry={() => regenerate(item.id)} />
						{Option.match(item.url, {
							onNone: Function.constUndefined,
							onSome: url => (
								<ToolbarItem placement="topBarTrailing">
									{Option.match(brandOf(item), {
										onNone: () => (
											<NativeButton
												label="Open Link"
												systemImage="arrow.up.right"
												onPress={() => {
													Linking.openURL(url)
												}}
												modifiers={[labelStyle('iconOnly')]}
											/>
										),
										onSome: brand => (
											<NativeButton
												onPress={() => {
													Linking.openURL(url)
												}}
												modifiers={[
													accessibilityLabel(
														Option.match(appOf(item), {
															onNone: Function.constant('Open Link'),
															onSome: name => `Open in ${name}`
														})
													)
												]}
											>
												<BrandLogo brand={kinds[brand].logo} size={20} />
											</NativeButton>
										)
									})}
								</ToolbarItem>
							)
						})}
						<ToolbarItem placement="topBarTrailing">
							<Menu label="More" systemImage="ellipsis" modifiers={[labelStyle('iconOnly')]}>
								{Option.match(item.url, {onNone: Function.constUndefined, onSome: url => <ShareLink item={url} />})}
								<NativeButton label="Regenerate" systemImage="arrow.clockwise" onPress={() => regenerate(item.id)} />
								<NativeButton
									label="Delete"
									systemImage="trash"
									role="destructive"
									onPress={() => {
										remove(item.id)
										props.onClose()
									}}
								/>
							</Menu>
						</ToolbarItem>
					</Toolbar.Content>
				</Toolbar>
			)
		})
	)
}

export function NoteRoute(props: {
	id: Option.Option<NoteId>
	kind: Option.Option<Kind>
	onClose: () => void
	onTag: (tag: TagName, note: NoteId) => void
	tag: Option.Option<TagName>
}) {
	return (
		<Loaded atom={notesAtom}>
			{notes => (
				<NoteScreen
					id={props.id}
					kind={props.kind}
					notes={notes}
					onClose={props.onClose}
					onTag={props.onTag}
					tag={props.tag}
				/>
			)}
		</Loaded>
	)
}
