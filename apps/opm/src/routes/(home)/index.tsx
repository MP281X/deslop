import {useAtomSet} from '@effect/atom-react'

import {Array, Boolean, DateTime, Number, Option, Order, pipe} from 'effect'

import {Button, Circle, ContentUnavailableView, HStack, List, SwipeActions, Text, VStack} from '@expo/ui/swift-ui'
import {
	accessibilityElement,
	background,
	contentShape,
	foregroundStyle,
	frame,
	lineLimit,
	listRowBackground,
	listRowInsets,
	listRowSeparatorTint,
	listStyle,
	navigationBarTitleDisplayMode,
	navigationTitle,
	onTapGesture,
	scrollContentBackground,
	shapes,
	tint
} from '@expo/ui/swift-ui/modifiers'

import {colors, mono} from '@deslop/components-mobile/theme'

import {readAtom} from '#lib/utils.ts'
import {byNumber} from '#services/chapters/lib/utils.ts'
import type {ChapterItem, ChapterList} from '#services/chapters/schema.ts'

// Every prop keeps its identity while the chapter is unchanged, so a page turn in the reader re-renders one row.
function ChapterRow(props: {chapter: ChapterItem; fresh: boolean; onOpen: (number: number) => void}) {
	const read = useAtomSet(readAtom)
	const done = props.chapter.reading?.done === true
	const tone = Boolean.match(done, {onFalse: () => colors.foreground, onTrue: () => colors.mutedForeground})
	return (
		<SwipeActions
			modifiers={[
				listRowBackground(colors.background),
				listRowSeparatorTint(colors.border),
				listRowInsets({bottom: 10, leading: 16, top: 10, trailing: 16})
			]}
		>
			<HStack
				spacing={14}
				modifiers={[
					frame({alignment: 'leading', maxWidth: Infinity}),
					contentShape(shapes.rectangle()),
					onTapGesture(() => props.onOpen(props.chapter.number)),
					accessibilityElement('combine')
				]}
			>
				<Text modifiers={[mono('headline', 17), foregroundStyle(tone), frame({alignment: 'leading', width: 52})]}>
					{`${props.chapter.number}`}
				</Text>
				<VStack alignment="leading" spacing={2} modifiers={[frame({alignment: 'leading', maxWidth: Infinity})]}>
					<Text modifiers={[mono('body', 15), foregroundStyle(tone), lineLimit(1)]}>
						{Boolean.match(props.chapter.title === '', {
							onFalse: () => props.chapter.title,
							onTrue: () => `Chapter ${props.chapter.number}`
						})}
					</Text>
					<Text modifiers={[mono('caption', 12), foregroundStyle(colors.mutedForeground), lineLimit(1)]}>
						{pipe(
							Option.fromUndefinedOr(props.chapter.reading),
							Option.filter(reading => !reading.done),
							Option.match({
								onNone: () =>
									DateTime.formatLocal(DateTime.makeUnsafe(props.chapter.postedAt), {
										day: 'numeric',
										month: 'short',
										year: 'numeric'
									}),
								onSome: reading => `Page ${reading.page + 1} of ${props.chapter.pages.length}`
							})
						)}
					</Text>
				</VStack>
				{props.fresh && <Circle modifiers={[foregroundStyle(colors.primary), frame({height: 9, width: 9})]} />}
			</HStack>
			<SwipeActions.Actions edge="leading">
				<Button
					label={Boolean.match(done, {onFalse: () => 'Read', onTrue: () => 'Unread'})}
					systemImage={Boolean.match(done, {
						onFalse: () => 'checkmark.circle' as const,
						onTrue: () => 'circle' as const
					})}
					onPress={() =>
						read({
							done: !done,
							number: props.chapter.number,
							page: Boolean.match(done, {onFalse: () => Number.max(props.chapter.pages.length - 1, 0), onTrue: () => 0})
						})
					}
					modifiers={[tint(colors.primary)]}
				/>
			</SwipeActions.Actions>
		</SwipeActions>
	)
}

export function ChaptersRoute(props: {chapters: ChapterList; onOpen: (number: number) => void}) {
	// New means past the newest chapter ever opened, so the back catalogue carries no dots.
	const reached = pipe(
		Array.filter(props.chapters, chapter => chapter.reading !== undefined),
		Array.map(chapter => chapter.number),
		Array.match({onEmpty: Option.none<number>, onNonEmpty: numbers => Option.some(Array.max(numbers, Order.Number))})
	)
	return Array.match(props.chapters, {
		onEmpty: () => (
			<ContentUnavailableView
				title="No Chapters Yet"
				systemImage="book.closed"
				description="They appear here as soon as the server has read them."
				modifiers={[navigationTitle('One Punch-Man'), background(colors.background)]}
			/>
		),
		onNonEmpty: chapters => (
			<List
				modifiers={[
					navigationTitle('One Punch-Man'),
					navigationBarTitleDisplayMode('large'),
					listStyle('plain'),
					scrollContentBackground('hidden'),
					background(colors.background)
				]}
			>
				{Array.map(Array.sort(chapters, Order.flip(byNumber)), chapter => (
					<ChapterRow
						key={chapter.number}
						chapter={chapter}
						fresh={Option.exists(reached, number => chapter.number > number)}
						onOpen={props.onOpen}
					/>
				))}
			</List>
		)
	})
}
