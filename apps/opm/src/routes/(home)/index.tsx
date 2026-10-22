import {useAtomSet} from '@effect/atom-react'

import {Array, Boolean, DateTime, Number, Option, Order, pipe} from 'effect'

import {Button, Circle, ContentUnavailableView, HStack, Image, List, SwipeActions, Text} from '@expo/ui/swift-ui'
import {
	accessibilityElement,
	background,
	clipShape,
	contentShape,
	foregroundStyle,
	frame,
	lineLimit,
	listRowBackground,
	listRowInsets,
	listRowSeparatorTint,
	listStyle,
	navigationTitle,
	onTapGesture,
	opacity,
	scrollContentBackground,
	shapes,
	tint,
	toolbarTitleDisplayMode
} from '@expo/ui/swift-ui/modifiers'

import {colors, mono} from '@deslop/components-mobile/theme'

import {readAtom} from '#lib/utils.ts'
import {Cover} from '#modules/native/index.ts'
import {byNumber, nameOf} from '#services/chapters/lib/utils.ts'
import type {ChapterItem, ChapterList} from '#services/chapters/schema.ts'

// "21 Oct" this year, "21 Oct 2025" before it.
function postedOn(postedAt: number) {
	const posted = DateTime.makeUnsafe(postedAt)
	return DateTime.formatLocal(
		posted,
		Boolean.match(DateTime.getPartUtc(posted, 'year') === DateTime.getPartUtc(DateTime.nowUnsafe(), 'year'), {
			onFalse: () => ({day: 'numeric', month: 'short', year: 'numeric'}) as const,
			onTrue: () => ({day: 'numeric', month: 'short'}) as const
		})
	)
}

// Every prop keeps its identity while the chapter is unchanged, so a page turn in the reader re-renders one row.
function ChapterRow(props: {chapter: ChapterItem; fresh: boolean; onOpen: (number: number) => void}) {
	const read = useAtomSet(readAtom)
	const done = props.chapter.reading?.done === true
	const reading = Option.filter(Option.fromUndefinedOr(props.chapter.reading), found => !found.done)
	const name = nameOf(props.chapter.title)
	return (
		<SwipeActions
			modifiers={[
				listRowBackground(colors.background),
				listRowSeparatorTint(colors.border),
				listRowInsets({bottom: 6, leading: 16, top: 6, trailing: 16})
			]}
		>
			<HStack
				spacing={12}
				modifiers={[
					frame({alignment: 'leading', maxWidth: Infinity}),
					contentShape(shapes.rectangle()),
					onTapGesture(() => props.onOpen(props.chapter.number)),
					accessibilityElement('combine')
				]}
			>
				<Cover
					url={Option.getOrElse(Array.head(props.chapter.pages), () => '')}
					modifiers={[
						frame({height: 44, width: 31}),
						clipShape('roundedRectangle', 4),
						opacity(Boolean.match(done, {onFalse: () => 1, onTrue: () => 0.45}))
					]}
				/>
				<Text modifiers={[mono('subheadline', 13), foregroundStyle(colors.mutedForeground), frame({width: 32})]}>
					{`${props.chapter.number}`}
				</Text>
				<Text
					modifiers={[
						mono('body', 15),
						foregroundStyle(
							Boolean.match(done, {onFalse: () => colors.foreground, onTrue: () => colors.mutedForeground})
						),
						lineLimit(1),
						frame({alignment: 'leading', maxWidth: Infinity})
					]}
				>
					{Boolean.match(name === '', {onFalse: () => name, onTrue: () => `Chapter ${props.chapter.number}`})}
				</Text>
				<Text modifiers={[mono('caption', 12), foregroundStyle(colors.mutedForeground), lineLimit(1)]}>
					{postedOn(props.chapter.postedAt)}
				</Text>
				{/* One fixed column, so the dates line up whether a row ends in a check, its progress, a dot or nothing. */}
				<HStack modifiers={[frame({alignment: 'trailing', width: 36})]}>
					{done && <Image systemName="checkmark" size={13} color={colors.mutedForeground} />}
					{Option.match(reading, {
						onNone: () =>
							props.fresh && <Circle modifiers={[foregroundStyle(colors.primary), frame({height: 9, width: 9})]} />,
						onSome: found => (
							<Text modifiers={[mono('caption', 12), foregroundStyle(colors.primary), lineLimit(1)]}>
								{`${found.page + 1}/${props.chapter.pages.length}`}
							</Text>
						)
					})}
				</HStack>
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
					// The large title sits in the bar's own row, without the empty one above it.
					toolbarTitleDisplayMode('inlineLarge'),
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
