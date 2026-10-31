import {useAtomRefresh, useAtomSet, useAtomSuspense, useAtomValue} from '@effect/atom-react'

import {Array, Boolean, Match, Option, String, pipe} from 'effect'

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
	accessibilityHidden,
	accessibilityLabel,
	aspectRatio,
	background,
	buttonStyle,
	clipShape,
	font,
	foregroundStyle,
	frame,
	labelStyle,
	lineSpacing,
	navigationBarTitleDisplayMode,
	navigationTitle,
	padding,
	redacted,
	resizable,
	textSelection,
	tint
} from '@expo/ui/swift-ui/modifiers'
import {AsyncResult} from 'effect/reactivity'
import {Linking} from 'react-native'

import {BrandLogo} from '@deslop/components-mobile/icons'
import {colors, space, text} from '@deslop/components-mobile/theme'
import {
	Empty,
	EmptyContent,
	EmptyDescription,
	EmptyHeader,
	EmptyMedia,
	EmptyTitle
} from '@deslop/components-mobile/ui/empty'
import {ToggleGroup, ToggleGroupItem} from '@deslop/components-mobile/ui/toggle-group'

import {Byline} from '#lib/components.tsx'
import {appOf, brandOf, imageAtom, kinds, noteAtom, notesAtom, primary, regenerateAtom, removeAtom} from '#lib/utils.ts'
import type {Note, NoteItem} from '#services/notes/schema.ts'

const prose = [
	font({textStyle: 'body'}),
	lineSpacing(space[1]),
	foregroundStyle(colors.foreground),
	textSelection(true)
]

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
				clipShape('roundedRectangle', 12),
				accessibilityHidden(true)
			]}
		/>
	)
}

// The AI writes Markdown lines: "## " headings, "- " facts, "1. " steps and "> " quotes, with inline bold, code and links.
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
									<Text modifiers={[font({textStyle: 'body'}), foregroundStyle(colors.mutedForeground)]}>
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
		<VStack alignment="leading" spacing={space[3]} modifiers={[redacted('placeholder')]}>
			<Body
				text={
					'The main point of the entry, in one or two plain sentences.\n- A takeaway a developer keeps from it.\n- Another takeaway with a tool and what it does.\n- A number that matters.'
				}
			/>
		</VStack>
	)
}

function Detail(props: {note: NoteItem; onRetry: () => void; onTag: (tag: string) => void}) {
	const full = useAtomValue(noteAtom(props.note))
	const reload = useAtomRefresh(noteAtom(props.note))
	return (
		<ScrollView modifiers={[background(colors.background)]}>
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
						font({textStyle: 'title3', weight: 'semibold'}),
						foregroundStyle(colors.foreground),
						textSelection(true)
					]}
				>
					{props.note.title}
				</Text>
				{props.note.image !== undefined && <Cover note={props.note} />}
				{pipe(
					Match.value(props.note.status),
					Match.when('organizing', () => <Placeholder />),
					Match.when('failed', () => (
						<Empty>
							<EmptyHeader>
								<EmptyMedia systemImage="exclamationmark.triangle" />
								<EmptyTitle>Couldn’t Read This Link</EmptyTitle>
								{props.note.issue !== undefined && <EmptyDescription>{props.note.issue}</EmptyDescription>}
							</EmptyHeader>
							<EmptyContent>
								<Button
									label="Try Again"
									systemImage="arrow.clockwise"
									onPress={props.onRetry}
									modifiers={[buttonStyle('glass')]}
								/>
							</EmptyContent>
						</Empty>
					)),
					Match.orElse(() => (
						<VStack alignment="leading" spacing={space[4]}>
							<Text modifiers={prose}>{props.note.summary}</Text>
							{AsyncResult.match(full, {
								onFailure: () => (
									<Button
										label="Load the Notes Again"
										systemImage="arrow.clockwise"
										onPress={reload}
										modifiers={[buttonStyle('glass')]}
									/>
								),
								onInitial: () => <Placeholder />,
								onSuccess: loaded => loaded.value.body !== undefined && <Body text={loaded.value.body} />
							})}
						</VStack>
					))
				)}
				<Divider />
				<Byline note={props.note} />
				{/* No tag is chosen here: choosing one opens the list filtered to it. */}
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
	return Option.match(
		Array.findFirst(useAtomSuspense(notesAtom).value, item => item.id === props.id),
		{
			onNone: () => (
				<Empty
					modifiers={[navigationTitle(''), navigationBarTitleDisplayMode('inline'), background(colors.background)]}
				>
					<EmptyHeader>
						<EmptyMedia systemImage="trash" />
						<EmptyTitle>Note Deleted</EmptyTitle>
					</EmptyHeader>
				</Empty>
			),
			onSome: item => (
				<Toolbar
					modifiers={[navigationTitle(''), navigationBarTitleDisplayMode('inline'), background(colors.background)]}
				>
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
