import {useAtomSet, useAtomSuspense, useAtomValue} from '@effect/atom-react'

import {Array, Option, String, pipe} from 'effect'

import {
	Button,
	ContentUnavailableView,
	HStack,
	Image,
	ScrollView,
	Text,
	Toolbar,
	ToolbarItem,
	VStack
} from '@expo/ui/swift-ui'
import {
	aspectRatio,
	background,
	foregroundStyle,
	frame,
	labelStyle,
	navigationBarTitleDisplayMode,
	navigationTitle,
	padding,
	redacted,
	refreshable,
	resizable,
	textSelection
} from '@expo/ui/swift-ui/modifiers'
import {AsyncResult} from 'effect/reactivity'
import {Linking} from 'react-native'

import {brandOf, imageAtom, noteAtom, notesAtom, regenerateAtom} from '#lib/utils.ts'
import type {Note, NoteItem} from '#services/notes/schema.ts'
import {Chip} from '@deslop/components-mobile/chip'
import {BrandLogo} from '@deslop/components-mobile/icons'
import {colors, mono} from '@deslop/components-mobile/theme'

export function NoteRoute(props: {id: Note['id']; onTag: (tag: string) => void}) {
	return Option.match(
		Array.findFirst(useAtomSuspense(notesAtom).value, item => item.id === props.id),
		{
			onNone: () => (
				<ContentUnavailableView
					title="gone"
					description="this note was deleted"
					modifiers={[
						navigationTitle(''),
						navigationBarTitleDisplayMode('inline'),
						background(colors.background),
						mono('body', 14),
						foregroundStyle(colors.mutedForeground)
					]}
				/>
			),
			onSome: item => (
				<Toolbar
					modifiers={[
						navigationTitle(item.status === 'organizing' ? '' : item.title),
						navigationBarTitleDisplayMode('inline'),
						background(colors.background)
					]}
				>
					<Detail note={item} onTag={props.onTag} />
					{Option.match(Option.fromNullishOr(item.url), {
						onNone: () => undefined,
						onSome: url => (
							<Toolbar.Content>
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
											<Button onPress={() => Linking.openURL(url)}>
												<BrandLogo brand={brand} size={20} />
											</Button>
										)
									})}
								</ToolbarItem>
							</Toolbar.Content>
						)
					})}
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
			modifiers={[resizable(), aspectRatio({contentMode: 'fit'}), frame({maxHeight: 280, maxWidth: Infinity})]}
		/>
	)
}

function Body(props: {text: string}) {
	return (
		<VStack alignment="leading" spacing={8} modifiers={[frame({alignment: 'leading', maxWidth: Infinity})]}>
			{pipe(
				props.text,
				String.split('\n'),
				Array.map(String.trim),
				Array.filter(String.isNonEmpty),
				Array.map(line =>
					String.startsWith('- ')(line) ? (
						<HStack key={line} alignment="top" spacing={8}>
							<Text modifiers={[mono('body', 14), foregroundStyle(colors.mutedForeground)]}>•</Text>
							<Text
								modifiers={[
									mono('body', 14),
									foregroundStyle(colors.foreground),
									textSelection(true),
									frame({alignment: 'leading', maxWidth: Infinity})
								]}
							>
								{String.slice(2)(line)}
							</Text>
						</HStack>
					) : (
						<Text key={line} modifiers={[mono('body', 14), foregroundStyle(colors.foreground), textSelection(true)]}>
							{line}
						</Text>
					)
				)
			)}
		</VStack>
	)
}

function Detail(props: {note: NoteItem; onTag: (tag: string) => void}) {
	const note = props.note
	const regenerate = useAtomSet(regenerateAtom, {mode: 'promise'})
	const full = pipe(
		useAtomValue(noteAtom(note)),
		AsyncResult.getOrElse(() => undefined),
		Option.fromNullishOr
	)
	return (
		<ScrollView
			modifiers={[
				background(colors.background),
				refreshable(async () => {
					await regenerate(note.id)
				})
			]}
		>
			<VStack
				alignment="leading"
				spacing={14}
				modifiers={[padding({all: 16}), frame({alignment: 'leading', maxWidth: Infinity})]}
			>
				{note.image !== undefined && <Cover note={note} />}
				{note.status === 'organizing' && (
					<VStack alignment="leading" spacing={14} modifiers={[redacted('placeholder')]}>
						<HStack spacing={8}>
							<Chip label="placeholder" active={false} onPress={() => undefined} />
							<Chip label="tag" active={false} onPress={() => undefined} />
						</HStack>
						<Body
							text={
								'- The point of the post, in one line.\n- A takeaway a developer keeps from it.\n- Another takeaway with a tool and what it does.'
							}
						/>
					</VStack>
				)}
				{note.status === 'ready' && !Array.isReadonlyArrayEmpty(note.tags) && (
					<ScrollView axes="horizontal" showsIndicators={false}>
						<HStack spacing={8}>
							{Array.map(note.tags, tag => (
								<Chip key={tag} label={tag} active={false} onPress={() => props.onTag(tag)} />
							))}
						</HStack>
					</ScrollView>
				)}
				{note.status === 'failed' && (
					<ContentUnavailableView
						title="Couldn’t Read This Note"
						systemImage="exclamationmark.triangle"
						description={`${note.issue} Pull down to try again.`}
					/>
				)}
				{note.status === 'ready' &&
					Option.match(
						Option.flatMap(full, loaded => Option.liftPredicate(loaded.body ?? '', String.isNonEmpty)),
						{
							onNone: () => (
								<Text modifiers={[mono('body', 14), foregroundStyle(colors.foreground), textSelection(true)]}>
									{note.summary}
								</Text>
							),
							onSome: body => <Body text={body} />
						}
					)}
			</VStack>
		</ScrollView>
	)
}
