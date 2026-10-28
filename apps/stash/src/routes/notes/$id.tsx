import {useAtomRefresh, useAtomSet, useAtomSuspense, useAtomValue} from '@effect/atom-react'

import {Array, Boolean, Match, Option, String, pipe} from 'effect'

import {
	Button,
	ContentUnavailableView,
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

import {Chip} from '@deslop/components-mobile/chip'
import {BrandLogo} from '@deslop/components-mobile/icons'
import {colors, mono} from '@deslop/components-mobile/theme'

import {Byline} from '#lib/components.tsx'
import {appOf, brandOf, imageAtom, kinds, noteAtom, notesAtom, regenerateAtom, removeAtom} from '#lib/utils.ts'
import type {Note, NoteItem} from '#services/notes/schema.ts'

const prose = [font({textStyle: 'body'}), lineSpacing(4), foregroundStyle(colors.foreground), textSelection(true)]

export function NoteRoute(props: {id: Note['id']; onClose: () => void; onTag: (tag: string) => void}) {
	const remove = useAtomSet(removeAtom)
	const regenerate = useAtomSet(regenerateAtom)
	return Option.match(
		Array.findFirst(useAtomSuspense(notesAtom).value, item => item.id === props.id),
		{
			onNone: () => (
				<ContentUnavailableView
					title="Note Deleted"
					systemImage="trash"
					modifiers={[navigationTitle(''), navigationBarTitleDisplayMode('inline'), background(colors.background)]}
				/>
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
			spacing={10}
			modifiers={[frame({alignment: 'leading', maxWidth: Infinity}), tint(colors.primary)]}
		>
			{Array.map(
				Array.filter(Array.map(String.split(props.text, '\n'), String.trim), String.isNonEmpty),
				(line, index) =>
					pipe(
						Match.value(line),
						// A heading's hashes are followed by a space; a line opening with a #hashtag is text.
						Match.when(
							text => Option.isSome(String.match(/^#+\s/u)(text)),
							() => (
								<Text
									key={index}
									modifiers={[mono('headline', 17), foregroundStyle(colors.foreground), padding({top: 10})]}
								>
									{String.replace(/^#+\s*/u, '')(line)}
								</Text>
							)
						),
						Match.when(
							text => Option.isSome(String.match(/^(?:[-*•]|\d+\.)\s/u)(text)),
							() => (
								<HStack key={index} alignment="firstTextBaseline" spacing={8}>
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
								modifiers={[...prose, foregroundStyle(colors.mutedForeground), padding({leading: 12})]}
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
		<VStack alignment="leading" spacing={10} modifiers={[redacted('placeholder')]}>
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
				spacing={16}
				modifiers={[padding({bottom: 32, horizontal: 20, top: 8}), frame({alignment: 'leading', maxWidth: Infinity})]}
			>
				<Text modifiers={[mono('headline', 18), foregroundStyle(colors.foreground), textSelection(true)]}>
					{props.note.title}
				</Text>
				{props.note.image !== undefined && <Cover note={props.note} />}
				{pipe(
					Match.value(props.note.status),
					Match.when('organizing', () => <Placeholder />),
					Match.when('failed', () => (
						<VStack spacing={12} modifiers={[frame({maxWidth: Infinity})]}>
							<ContentUnavailableView
								title="Couldn’t Read This Link"
								systemImage="exclamationmark.triangle"
								description={props.note.issue}
							/>
							<Button
								label="Try Again"
								systemImage="arrow.clockwise"
								onPress={props.onRetry}
								modifiers={[buttonStyle('glass')]}
							/>
						</VStack>
					)),
					Match.orElse(() => (
						<VStack alignment="leading" spacing={16}>
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
				{!Array.isReadonlyArrayEmpty(props.note.tags) && (
					<ScrollView axes="horizontal" showsIndicators={false}>
						<HStack spacing={8}>
							{Array.map(props.note.tags, tag => (
								<Chip key={tag} label={tag} active={false} onPress={() => props.onTag(tag)} />
							))}
						</HStack>
					</ScrollView>
				)}
			</VStack>
		</ScrollView>
	)
}
