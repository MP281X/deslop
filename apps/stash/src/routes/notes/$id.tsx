import {useAtomRefresh, useAtomSet, useAtomSuspense, useAtomValue} from '@effect/atom-react'

import {Array, Boolean, Match, Option, Result, Schema, String, pipe} from 'effect'

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
import {FailureContent, shownOf} from '@deslop/components-mobile/screens'
import {colors, radius, space, text} from '@deslop/components-mobile/theme'
import {Empty} from '@deslop/components-mobile/ui/empty'
import {Skeleton} from '@deslop/components-mobile/ui/skeleton'
import {ToggleGroup, ToggleGroupItem} from '@deslop/components-mobile/ui/toggle-group'
import {AuthError} from '@deslop/runtime/auth/schema'

import {Byline} from '#lib/components.tsx'
import {BrandLogo} from '#lib/icons.tsx'
import {appOf, brandOf, kinds} from '#lib/kinds.ts'
import {imageAtom, noteAtom, notesAtom, regenerateAtom, removeAtom} from '#lib/notes.ts'
import {primary} from '#lib/session.ts'
import type {Note, NoteItem} from '#services/notes/schema.ts'

const prose = [text.body, lineSpacing(space[1]), foregroundStyle(colors.foreground), textSelection(true)]

const lede = [text.body, lineSpacing(space[1]), foregroundStyle(colors.mutedForeground), textSelection(true)]

function Cover(props: {note: NoteItem}) {
	const image = useAtomValue(imageAtom(props.note.id))
	if (!AsyncResult.isSuccess(image)) return undefined
	return (
		<Image
			uiImage={image.value}
			modifiers={[
				resizable(),
				aspectRatio({contentMode: 'fit'}),
				frame({maxHeight: 280, maxWidth: Infinity}),
				clipShape('roundedRectangle', radius),
				accessibilityHidden(true)
			]}
		/>
	)
}

function Body(props: {text: string}) {
	return (
		<VStack
			alignment="leading"
			spacing={space[3]}
			modifiers={[frame({alignment: 'leading', maxWidth: Infinity}), tint(primary)]}
		>
			{Array.map(
				Array.filter(Array.map(String.split(props.text, '\n'), String.trim), String.isNonEmpty),
				(line, index) =>
					pipe(
						Match.value(line),
						// A heading's hashes are followed by a space; a line opening with a #hashtag is text.
						Match.when(
							candidate => Option.isSome(String.match(/^#+\s/u)(candidate)),
							() => (
								<Text
									key={index}
									modifiers={[text.title, foregroundStyle(colors.foreground), padding({top: space[3]})]}
								>
									{String.replace(/^#+\s*/u, '')(line)}
								</Text>
							)
						),
						Match.when(
							candidate => Option.isSome(String.match(/^(?:[-*•]|\d+\.)\s/u)(candidate)),
							() => (
								<HStack key={index} alignment="firstTextBaseline" spacing={space[2]}>
									<Text modifiers={[text.body, foregroundStyle(colors.mutedForeground)]}>
										{Boolean.match(String.startsWith('- ')(line), {
											onFalse: () => String.replace(/\s.*$/u, '')(line),
											onTrue: () => '•'
										})}
									</Text>
									<Text markdownEnabled modifiers={[...prose, frame({alignment: 'leading', maxWidth: Infinity})]}>
										{String.replace(/^\S+\s/u, '')(line)}
									</Text>
								</HStack>
							)
						),
						Match.when(String.startsWith('> '), () => (
							<Text
								key={index}
								markdownEnabled
								modifiers={[...prose, foregroundStyle(colors.mutedForeground), padding({leading: space[3]})]}
							>
								{String.slice(2)(line)}
							</Text>
						)),
						Match.orElse(() => (
							<Text key={index} markdownEnabled modifiers={prose}>
								{line}
							</Text>
						))
					)
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
function Reading() {
	return (
		<VStack
			alignment="leading"
			spacing={space[4]}
			modifiers={[
				frame({alignment: 'leading', maxWidth: Infinity}),
				accessibilityElement('ignore'),
				accessibilityLabel('Reading this link')
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
						saved={Option.exists(AsyncResult.value(full), note => note.body !== undefined)}
						onRetry={reload}
					/>
				</HStack>
			)}
			{!Option.exists(AsyncResult.error(full), Schema.is(AuthError)) &&
				Option.match(AsyncResult.value(full), {
					onNone: () => undefined,
					onSome: note => note.body !== undefined && <Body text={note.body} />
				})}
		</VStack>
	)
}

function Detail(props: {note: NoteItem; onRetry: () => void; onTag: (tag: string) => void}) {
	const full = useAtomValue(noteAtom(props.note))
	const reload = useAtomRefresh(noteAtom(props.note))
	if (AsyncResult.isFailure(full) && Option.exists(AsyncResult.error(full), Schema.is(AuthError))) {
		return <FailureContent cause={full.cause} name="Note" onRetry={reload} />
	}
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
				{props.note.image !== undefined && <Cover note={props.note} />}
				{pipe(
					Match.value(props.note.status),
					Match.when('organizing', () => <Reading />),
					Match.when('failed', () => (
						<Empty>
							<Button
								label="Can’t Read This Link"
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
					)),
					Match.orElse(() => (
						<VStack alignment="leading" spacing={space[4]}>
							{String.isNonEmpty(props.note.summary) && <Text modifiers={lede}>{props.note.summary}</Text>}
							<Suspense fallback={<Placeholder />}>
								<FullBody note={props.note} />
							</Suspense>
						</VStack>
					))
				)}
				<Divider />
				<Byline note={props.note} />
				{!Array.isReadonlyArrayEmpty(props.note.tags) && (
					<ToggleGroup value="" onValueChange={props.onTag} tint={primary}>
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

export function NoteRoute(props: {id: Note['id']; onClose: () => void; onTag: (tag: string) => void}) {
	const remove = useAtomSet(removeAtom)
	const regenerate = useAtomSet(regenerateAtom)
	const loaded = useAtomSuspense(notesAtom, {includeFailure: true})
	const refresh = useAtomRefresh(notesAtom)
	const shown = shownOf(loaded)
	if (Result.isFailure(shown)) {
		return <FailureContent cause={shown.failure} name="Notes" onRetry={refresh} />
	}
	return Option.match(
		Array.findFirst(shown.success, item => item.id === props.id),
		{
			onNone: () => <Empty systemImage="trash" label="Note Deleted" />,
			onSome: item => (
				<Toolbar>
					<Detail note={item} onRetry={() => regenerate(item.id)} onTag={props.onTag} />
					<Toolbar.Content>
						{Option.match(Option.fromNullishOr(item.url), {
							onNone: () => undefined,
							onSome: url => (
								<ToolbarItem placement="topBarTrailing">
									{Option.match(brandOf(item), {
										onNone: () => (
											<Button
												label="Open Link"
												systemImage="arrow.up.right"
												onPress={() => Linking.openURL(url)}
												modifiers={[labelStyle('iconOnly')]}
											/>
										),
										onSome: brand => (
											<Button
												onPress={() => Linking.openURL(url)}
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
								{Option.match(Option.fromNullishOr(item.url), {
									onNone: () => undefined,
									onSome: url => <ShareLink item={url} />
								})}
								<Button label="Regenerate" systemImage="arrow.clockwise" onPress={() => regenerate(item.id)} />
								<Button
									label="Delete"
									systemImage="trash"
									role="destructive"
									onPress={() => {
										remove(item.id)
										props.onClose()
									}}
									modifiers={[tint(colors.destructive)]}
								/>
							</Menu>
						</ToolbarItem>
					</Toolbar.Content>
				</Toolbar>
			)
		}
	)
}
