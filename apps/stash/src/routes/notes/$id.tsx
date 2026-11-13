import {useAtomRefresh, useAtomSet, useAtomSuspense, useAtomValue} from '@effect/atom-react'

import {Array, Boolean, Match, Option, Schema, String, pipe} from 'effect'

import {
	Button,
	Divider,
	HStack,
	Image,
	Menu,
	ScrollView,
	ShareLink,
	Text,
	Toolbar,
	ToolbarItem,
	VStack
} from '@expo/ui/swift-ui'
import {
	accessibilityAddTraits,
	accessibilityElement,
	accessibilityHidden,
	accessibilityLabel,
	aspectRatio,
	buttonBorderShape,
	buttonStyle,
	clipShape,
	controlSize,
	foregroundStyle,
	frame,
	labelStyle,
	lineSpacing,
	padding,
	redacted,
	resizable,
	textSelection,
	tint
} from '@expo/ui/swift-ui/modifiers'
import {AsyncResult} from 'effect/reactivity'
import {Suspense} from 'react'
import {Linking} from 'react-native'

import {Problem} from '@deslop/components-mobile/problem'
import {FailureContent, Loaded} from '@deslop/components-mobile/screens'
import {colors, radius, space, text} from '@deslop/components-mobile/theme'
import {Empty} from '@deslop/components-mobile/ui/empty'
import {Skeleton} from '@deslop/components-mobile/ui/skeleton'
import {ToggleGroup, ToggleGroupItem} from '@deslop/components-mobile/ui/toggle-group'
import {AuthError} from '@deslop/runtime/shared/auth'

import {Byline} from '#lib/components.tsx'
import {BrandLogo} from '#lib/icons.tsx'
import {appOf, brandOf, kinds, subjectOf} from '#lib/kinds.ts'
import {imageAtom, noteAtom, notesAtom, regenerateAtom, removal} from '#lib/notes.ts'
import {primary} from '#lib/session.ts'
import type {NoteId, NoteItem} from '#services/notes/schema.ts'
import {TagName} from '#services/notes/schema.ts'

const prose = [text.body, lineSpacing(space[1]), foregroundStyle(colors.foreground), textSelection(true)]

const lede = [text.body, lineSpacing(space[1]), foregroundStyle(colors.mutedForeground), textSelection(true)]

// A fixed slot, so the title stays put while the cover loads or when it cannot.
const coverFrame = [frame({height: 280}), frame({maxWidth: Infinity})]

function Cover(props: {note: NoteItem}) {
	const image = useAtomValue(imageAtom(props.note.id))
	if (AsyncResult.isFailure(image)) return <VStack modifiers={coverFrame}>{null}</VStack>
	if (!AsyncResult.isSuccess(image)) return <Skeleton modifiers={coverFrame} />
	return (
		<Image
			uiImage={image.value}
			modifiers={[
				resizable(),
				aspectRatio({contentMode: 'fit'}),
				...coverFrame,
				clipShape('roundedRectangle', radius),
				accessibilityHidden(true)
			]}
		/>
	)
}

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
							onTrue: () => '•'
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
			modifiers={[frame({alignment: 'leading', maxWidth: Infinity}), tint(primary)]}
		>
			{pipe(
				props.text,
				String.split('\n'),
				Array.map(String.trim),
				Array.filter(String.isNonEmpty),
				Array.map((line, index) => (
					// oxlint-disable-next-line react/no-array-index-key -- Note lines have no identity beyond their position; editing text replaces that position's contents.
					<BodyLine key={index} line={line} />
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
			<Skeleton modifiers={[frame({height: 28}), frame({maxWidth: 320})]} />
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

function FullBody(props: {note: NoteItem}) {
	const full = useAtomSuspense(noteAtom(props.note), {includeFailure: true})
	const reload = useAtomRefresh(noteAtom(props.note))
	return (
		<VStack alignment="leading" spacing={space[4]}>
			{AsyncResult.isFailure(full) && (
				<HStack modifiers={[frame({alignment: 'trailing', maxWidth: Infinity})]}>
					<Problem
						label="Note body unavailable"
						saved={Option.exists(AsyncResult.value(full), note => Option.isSome(note.body))}
						onRetry={reload}
					/>
				</HStack>
			)}
			{!Option.exists(AsyncResult.error(full), Schema.is(AuthError)) &&
				Option.match(AsyncResult.value(full), {
					onNone: () => undefined,
					onSome: note => Option.match(note.body, {onNone: () => undefined, onSome: body => <Body text={body} />})
				})}
		</VStack>
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

function Detail(props: {note: NoteItem; onRetry: () => void; onTag: (tag: TagName) => void}) {
	const full = useAtomValue(noteAtom(props.note))
	const reload = useAtomRefresh(noteAtom(props.note))
	if (AsyncResult.isFailure(full) && Option.exists(AsyncResult.error(full), Schema.is(AuthError))) {
		return <FailureContent cause={full.cause} onRetry={reload} />
	}
	const issue = Option.getOrElse(props.note.issue, () => 'Can’t Read This Link')
	const kept =
		String.isNonEmpty(props.note.summary) || Option.exists(AsyncResult.value(full), note => Option.isSome(note.body))
	return (
		<ScrollView>
			<VStack
				alignment="leading"
				spacing={space[4]}
				modifiers={[
					padding({bottom: space[8], horizontal: space[4], top: space[2]}),
					frame({alignment: 'leading', maxWidth: Infinity})
				]}
			>
				<Text
					modifiers={[
						text.display,
						accessibilityAddTraits(['isHeader']),
						foregroundStyle(colors.foreground),
						textSelection(true)
					]}
				>
					{props.note.title}
				</Text>
				{Option.isSome(props.note.image) && <Cover note={props.note} />}
				{pipe(
					Match.value(props.note.status),
					Match.when('organizing', () => <Reading note={props.note} />),
					Match.when('failed', () =>
						Boolean.match(kept, {
							onFalse: () => (
								<Empty>
									<Button
										label={issue}
										systemImage="arrow.clockwise"
										role="destructive"
										onPress={props.onRetry}
										modifiers={[
											buttonStyle('glassProminent'),
											buttonBorderShape('capsule'),
											controlSize('large'),
											tint(colors.destructive)
										]}
									/>
								</Empty>
							),
							onTrue: () => (
								<VStack alignment="leading" spacing={space[4]}>
									<HStack modifiers={[frame({alignment: 'trailing', maxWidth: Infinity})]}>
										<Problem label={issue} onRetry={props.onRetry} />
									</HStack>
									<NoteContent note={props.note} />
								</VStack>
							)
						})
					),
					Match.orElse(() => <NoteContent note={props.note} />)
				)}
				<Divider />
				<Byline note={props.note} />
				{!Array.isReadonlyArrayEmpty(props.note.tags) && (
					<ToggleGroup value="" onValueChange={value => props.onTag(TagName.make(value))} tint={primary}>
						{Array.map(props.note.tags, tag => (
							<ToggleGroupItem key={tag} value={tag}>
								{tag}
							</ToggleGroupItem>
						))}
					</ToggleGroup>
				)}
			</VStack>
		</ScrollView>
	)
}

// The navigation path names the note by its id.
function NoteScreen(props: {
	id: NoteId
	notes: readonly NoteItem[]
	onClose: () => void
	onTag: (tag: TagName) => void
}) {
	const remove = useAtomSet(removal.removeAtom)
	const regenerate = useAtomSet(regenerateAtom)
	return pipe(
		props.notes,
		Array.findFirst(item => item.id === props.id),
		Option.match({
			onNone: () => <Empty systemImage="trash" label="Note Deleted" />,
			onSome: item => (
				<Toolbar>
					<Detail note={item} onRetry={() => regenerate(item.id)} onTag={props.onTag} />
					<Toolbar.Content>
						{Option.match(item.url, {
							onNone: () => undefined,
							onSome: url => (
								<ToolbarItem placement="topBarTrailing">
									{Option.match(brandOf(item), {
										onNone: () => (
											<Button
												label="Open Link"
												systemImage="arrow.up.right"
												onPress={() => {
													Linking.openURL(url)
												}}
												modifiers={[labelStyle('iconOnly')]}
											/>
										),
										onSome: brand => (
											<Button
												onPress={() => {
													Linking.openURL(url)
												}}
												modifiers={[
													accessibilityLabel(
														Option.match(appOf(item), {onNone: () => 'Open Link', onSome: name => `Open in ${name}`})
													)
												]}
											>
												<BrandLogo brand={kinds[brand].logo} size={20} />
											</Button>
										)
									})}
								</ToolbarItem>
							)
						})}
						<ToolbarItem placement="topBarTrailing">
							<Menu label="More" systemImage="ellipsis" modifiers={[labelStyle('iconOnly')]}>
								{Option.match(item.url, {onNone: () => undefined, onSome: url => <ShareLink item={url} />})}
								<Button label="Regenerate" systemImage="arrow.clockwise" onPress={() => regenerate(item.id)} />
								<Button
									label="Delete"
									systemImage="trash"
									role="destructive"
									onPress={() => {
										remove(props.id)
										props.onClose()
									}}
									modifiers={[tint(colors.destructive)]}
								/>
							</Menu>
						</ToolbarItem>
					</Toolbar.Content>
				</Toolbar>
			)
		})
	)
}

export function NoteRoute(props: {id: NoteId; onClose: () => void; onTag: (tag: TagName) => void}) {
	return (
		<Loaded atom={notesAtom}>
			{notes => <NoteScreen id={props.id} notes={notes} onClose={props.onClose} onTag={props.onTag} />}
		</Loaded>
	)
}
