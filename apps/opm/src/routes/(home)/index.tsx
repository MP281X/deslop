import {useAtomSet} from '@effect/atom-react'

import {Array, Boolean, DateTime, Number, Option, Order, pipe} from 'effect'

import {
	Button,
	Circle,
	ContentUnavailableView,
	HStack,
	List,
	SwipeActions,
	Text,
	Toolbar,
	ToolbarItem,
	VStack
} from '@expo/ui/swift-ui'
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
	listRowSeparator,
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
import {ChapterProgress, Cover, Title} from '#modules/native/index.ts'
import {byNumber, nameOf} from '#services/chapters/lib/utils.ts'
import type {ChapterItem, ChapterList} from '#services/chapters/schema.ts'

// The series name as its covers letter it.
const SERIES = 'ONEPUNCH-MAN'

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
	const name = nameOf(props.chapter.title)
	return (
		<SwipeActions
			modifiers={[
				listRowBackground(colors.background),
				listRowSeparator('hidden'),
				listRowInsets({bottom: 8, leading: 16, top: 8, trailing: 16})
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
				<Cover
					url={Option.getOrElse(Array.head(props.chapter.pages), () => '')}
					modifiers={[
						frame({height: 68, width: 48}),
						clipShape('roundedRectangle', 6),
						opacity(Boolean.match(done, {onFalse: () => 1, onTrue: () => 0.55}))
					]}
				/>
				<VStack alignment="leading" spacing={4} modifiers={[frame({alignment: 'leading', maxWidth: Infinity})]}>
					<HStack spacing={6}>
						{props.fresh && <Circle modifiers={[foregroundStyle(colors.primary), frame({height: 8, width: 8})]} />}
						<Text
							modifiers={[
								mono(Boolean.match(done, {onFalse: () => 'headline' as const, onTrue: () => 'body' as const}), 15),
								foregroundStyle(
									Boolean.match(done, {onFalse: () => colors.foreground, onTrue: () => colors.mutedForeground})
								),
								lineLimit(1)
							]}
						>
							{`Chapter ${props.chapter.number}`}
						</Text>
					</HStack>
					<Text modifiers={[mono('subheadline', 13), foregroundStyle(colors.mutedForeground), lineLimit(1)]}>
						{Array.join(
							Array.filter([name, postedOn(props.chapter.postedAt)], part => part !== ''),
							' · '
						)}
					</Text>
				</VStack>
				{/* The pages before the one on screen are read, so a chapter marked unread at its first page is empty. */}
				<ChapterProgress
					fraction={Option.match(Option.fromUndefinedOr(props.chapter.reading), {
						onNone: () => 0,
						onSome: reading =>
							Boolean.match(reading.done, {
								onFalse: () => reading.page / Number.max(props.chapter.pages.length, 1),
								onTrue: () => 1
							})
					})}
					accent={colors.primary}
					read={colors.foreground}
					modifiers={[frame({height: 14, width: 14})]}
				/>
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
				modifiers={[navigationTitle(SERIES), background(colors.background)]}
			/>
		),
		onNonEmpty: chapters => (
			<Toolbar>
				<List
					modifiers={[
						navigationTitle(SERIES),
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
				<Toolbar.Content>
					{/* The cover's lettering with the app icon stands in for the large title. */}
					<ToolbarItem placement="largeTitle">
						<Title />
					</ToolbarItem>
				</Toolbar.Content>
			</Toolbar>
		)
	})
}
