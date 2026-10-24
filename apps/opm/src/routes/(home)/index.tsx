import {useAtomSet} from '@effect/atom-react'

import {Array, Boolean, DateTime, Number, Option, Order, String, pipe} from 'effect'

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
	VStack,
	useNativeState
} from '@expo/ui/swift-ui'
import {
	accessibilityElement,
	background,
	clipShape,
	contentShape,
	disabled,
	foregroundStyle,
	frame,
	labelStyle,
	lineLimit,
	listRowBackground,
	listRowInsets,
	listRowSeparator,
	listStyle,
	navigationBarTitleDisplayMode,
	navigationTitle,
	onTapGesture,
	opacity,
	scrollContentBackground,
	searchable,
	shapes,
	tint
} from '@expo/ui/swift-ui/modifiers'
import {useState} from 'react'

import {colors, mono} from '@deslop/components-mobile/theme'
import {AppTitle} from '@deslop/components-mobile/title'
import {bottomBarSearch} from '@deslop/components-mobile/utils'

import {readAtom} from '#lib/utils.ts'
import {ChapterProgress, Cover} from '#modules/native/index.ts'
import icon from '#routes/icon.png'
import {byNumber, nameOf, resumeOf} from '#services/chapters/lib/utils.ts'
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
							Array.filter([nameOf(props.chapter.title), postedOn(props.chapter.postedAt)], String.isNonEmpty),
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
							opened: false,
							page: Boolean.match(done, {onFalse: () => Number.max(props.chapter.pages.length - 1, 0), onTrue: () => 0})
						})
					}
					modifiers={[tint(colors.primary)]}
				/>
			</SwipeActions.Actions>
		</SwipeActions>
	)
}

// A query matches a chapter's number from its start, or any part of its name.
function matches(chapter: ChapterItem, query: string) {
	return (
		String.startsWith(query)(`${chapter.number}`) || String.includes(query)(String.toLowerCase(nameOf(chapter.title)))
	)
}

export function ChaptersRoute(props: {chapters: ChapterList; onOpen: (number: number, page?: number) => void}) {
	const query = useNativeState('')
	const [searched, setSearched] = useState('')
	const text = String.toLowerCase(String.trim(searched))
	// New means past the newest chapter ever opened, so the back catalogue carries no dots.
	const reached = pipe(
		Array.filter(props.chapters, chapter => (chapter.reading?.at ?? 0) > 0),
		Array.map(chapter => chapter.number),
		Array.match({onEmpty: Option.none<number>, onNonEmpty: numbers => Option.some(Array.max(numbers, Order.Number))})
	)
	const resume = resumeOf(props.chapters)
	const shown = pipe(
		Array.sort(props.chapters, Order.flip(byNumber)),
		Array.filter(chapter => matches(chapter, text))
	)
	return (
		<Toolbar
			modifiers={[navigationTitle('opm'), navigationBarTitleDisplayMode('inline'), background(colors.background)]}
		>
			{/* Search and its explicit bottom-bar item share the same SwiftUI owner. */}
			<Toolbar modifiers={[searchable(query, {onChange: setSearched, prompt: 'Search'}), bottomBarSearch]}>
				{Array.match(shown, {
					onEmpty: () =>
						Boolean.match(String.isEmpty(text), {
							onFalse: () => (
								<ContentUnavailableView title={`No Results for “${searched}”`} systemImage="magnifyingglass" />
							),
							onTrue: () => (
								<ContentUnavailableView
									title="No Chapters Yet"
									systemImage="book.closed"
									description="They appear here as soon as the server has read them."
								/>
							)
						}),
					onNonEmpty: chapters => (
						<List modifiers={[listStyle('plain'), scrollContentBackground('hidden'), background(colors.background)]}>
							{Array.map(chapters, chapter => (
								<ChapterRow
									key={chapter.number}
									chapter={chapter}
									fresh={Option.exists(reached, number => chapter.number > number)}
									onOpen={props.onOpen}
								/>
							))}
						</List>
					)
				})}
				<Toolbar.Content>
					<ToolbarItem placement="bottomBar">
						<Button
							label={Option.match(resume, {
								onNone: () => 'Resume Reading',
								onSome: found => `Resume Chapter ${found.number}`
							})}
							systemImage="book"
							onPress={() => Option.map(resume, found => props.onOpen(found.number, found.page))}
							modifiers={[labelStyle('iconOnly'), disabled(Option.isNone(resume))]}
						/>
					</ToolbarItem>
				</Toolbar.Content>
			</Toolbar>
			<Toolbar.Content>
				<ToolbarItem placement="principal">
					<AppTitle logo={icon} name="opm" />
				</ToolbarItem>
			</Toolbar.Content>
		</Toolbar>
	)
}
