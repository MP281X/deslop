import {useAtomSuspense, useAtomValue} from '@effect/atom-react'

import {Array, Match, Option, String, pipe} from 'effect'

import {Button, ContentUnavailableView, HStack, Image, Link, ScrollView, Text, VStack} from '@expo/ui/swift-ui'
import {
	aspectRatio,
	background,
	border,
	buttonStyle,
	clipped,
	fixedSize,
	foregroundStyle,
	frame,
	lineLimit,
	navigationBarTitleDisplayMode,
	navigationTitle,
	padding,
	resizable,
	textSelection
} from '@expo/ui/swift-ui/modifiers'
import {AsyncResult} from 'effect/reactivity'

import {colors, mono} from '#lib/theme.ts'
import {imageAtom, notesAtom} from '#lib/utils.ts'
import type {Note} from '#services/notes/schema.ts'

const page = [navigationTitle(''), navigationBarTitleDisplayMode('inline'), background(colors.background)]

export function NoteRoute(props: {id: Note['id']; onTag: (tag: string) => void}) {
	return Option.match(
		Array.findFirst(useAtomSuspense(notesAtom).value.notes, note => note.id === props.id),
		{
			onNone: () => (
				<ContentUnavailableView
					title="gone"
					description="deleted, or joined to an earlier save of the same post"
					modifiers={[...page, mono('body', 14), foregroundStyle(colors.mutedForeground)]}
				/>
			),
			onSome: note => <Detail note={note} onTag={props.onTag} />
		}
	)
}

// Mounted only once the server has kept the preview, so the download never runs before the file exists.
function Cover(props: {note: Note}) {
	const image = useAtomValue(imageAtom(props.note.id))
	if (!AsyncResult.isSuccess(image)) return undefined
	return (
		<Image
			uiImage={image.value}
			modifiers={[
				resizable(),
				aspectRatio({contentMode: 'fill'}),
				frame({maxWidth: Infinity}),
				frame({height: props.note.source === 'TikTok' ? 420 : 220}),
				clipped()
			]}
		/>
	)
}

function Detail(props: {note: Note; onTag: (tag: string) => void}) {
	// iOS opens the app when it is installed and claims the link; other links open in the default browser.
	const destination = pipe(
		Match.value(props.note.source),
		Match.when('TikTok', () => 'open in tiktok'),
		Match.when('X', () => 'open in x'),
		Match.orElse(() =>
			pipe(
				Option.fromNullishOr(props.note.url),
				Option.flatMap(url => String.match(/^https?:\/\/(?:[\w-]+\.)*(?:youtube\.com|youtu\.be)\//u)(url)),
				Option.match({onNone: () => 'open link', onSome: () => 'open in youtube'})
			)
		)
	)
	return (
		<ScrollView modifiers={page}>
			<VStack alignment="leading" spacing={14} modifiers={[padding({all: 16})]}>
				{props.note.image !== undefined && <Cover note={props.note} />}
				<Text modifiers={[mono('headline', 18), foregroundStyle(colors.foreground), textSelection(true)]}>
					{props.note.title}
				</Text>
				{String.isNonEmpty(props.note.summary) && (
					<Text modifiers={[mono('body', 14), foregroundStyle(colors.mutedForeground), textSelection(true)]}>
						{props.note.summary}
					</Text>
				)}
				{!Array.isReadonlyArrayEmpty(props.note.tags) && (
					// One scrolling line of tags, so a tag never breaks across two lines.
					<ScrollView axes="horizontal" showsIndicators={false}>
						<HStack spacing={8}>
							{Array.map(props.note.tags, tag => (
								<Button
									key={tag}
									onPress={() => props.onTag(tag)}
									modifiers={[buttonStyle('plain'), border({color: colors.border, width: 1})]}
								>
									<Text
										modifiers={[
											mono('caption', 12),
											foregroundStyle(colors.primary),
											lineLimit(1),
											fixedSize(),
											padding({horizontal: 8, vertical: 4})
										]}
									>
										{`#${tag}`}
									</Text>
								</Button>
							))}
						</HStack>
					</ScrollView>
				)}
				{Option.match(Option.fromNullishOr(props.note.url), {
					onNone: () => undefined,
					onSome: url => (
						<Link destination={url} modifiers={[frame({maxWidth: Infinity})]}>
							<Text
								modifiers={[
									mono('body', 14),
									foregroundStyle(colors.primary),
									frame({maxWidth: Infinity}),
									padding({all: 10}),
									border({color: colors.border, width: 1})
								]}
							>
								{destination}
							</Text>
						</Link>
					)
				})}
				{String.isNonEmpty(props.note.issue) && (
					<Text modifiers={[mono('caption', 12), foregroundStyle(colors.mutedForeground)]}>{props.note.issue}</Text>
				)}
			</VStack>
		</ScrollView>
	)
}
