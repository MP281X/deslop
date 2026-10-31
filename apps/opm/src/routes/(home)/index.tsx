import {useAtomSet} from '@effect/atom-react'

import {Array, Boolean, DateTime, Number, Option, Order, String, pipe} from 'effect'

import {Button, HStack, Menu, Picker, SwipeActions, Text, Toolbar, ToolbarItem, useNativeState} from '@expo/ui/swift-ui'
import {
	background,
	clipShape,
	disabled,
	foregroundStyle,
	frame,
	labelStyle,
	lineLimit,
	menuOrder,
	listRowSeparator,
	navigationBarTitleDisplayMode,
	navigationTitle,
	opacity,
	pickerStyle,
	searchable,
	tag,
	tint
} from '@expo/ui/swift-ui/modifiers'
import {useState} from 'react'

import {StatusDot} from '@deslop/components-mobile/status-dot'
import {colors, space, text} from '@deslop/components-mobile/theme'
import {AppTitle} from '@deslop/components-mobile/title'
import {Empty, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle} from '@deslop/components-mobile/ui/empty'
import {
	Item,
	ItemActions,
	ItemContent,
	ItemDescription,
	ItemGroup,
	ItemMedia,
	ItemTitle,
	itemRow
} from '@deslop/components-mobile/ui/item'
import {bottomBarSearch} from '@deslop/components-mobile/utils'

import {primary, readAtom} from '#lib/utils.ts'
import {ChapterProgress, Cover} from '#modules/native/index.ts'
import icon from '#routes/app.icon/Assets/icon.png'
import {byNumber, resumeOf, SERIES_NAMES} from '#services/chapters/lib/utils.ts'
import type {ChapterItem, ChapterList} from '#services/chapters/schema.ts'
import {Series} from '#services/chapters/schema.ts'

// "21 Oct" this year, "21 Oct 2025" before it.
function postedOn(postedAt: number) {
	if (postedAt <= 0) return ''
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
		<SwipeActions modifiers={[...itemRow, listRowSeparator('hidden')]}>
			<Item onPress={() => props.onOpen(props.chapter.number)}>
				<ItemMedia>
					<Cover
						url={Option.getOrElse(Array.head(props.chapter.pages), () => '')}
						modifiers={[
							frame({height: 68, width: 48}),
							clipShape('roundedRectangle', 6),
							opacity(Boolean.match(done, {onFalse: () => 1, onTrue: () => 0.55}))
						]}
					/>
				</ItemMedia>
				<ItemContent>
					<HStack spacing={space[2]}>
						{props.fresh && <StatusDot status="live" tint={primary} />}
						<ItemTitle
							modifiers={[
								Boolean.match(done, {onFalse: () => text.row, onTrue: () => text.body}),
								foregroundStyle(
									Boolean.match(done, {onFalse: () => colors.foreground, onTrue: () => colors.mutedForeground})
								),
								lineLimit(1)
							]}
						>
							{`Chapter ${props.chapter.number}`}
						</ItemTitle>
					</HStack>
					<ItemDescription modifiers={[lineLimit(1, {reservesSpace: true})]}>
						{Array.join(
							Array.filter([props.chapter.title, postedOn(props.chapter.postedAt)], String.isNonEmpty),
							' · '
						)}
					</ItemDescription>
				</ItemContent>
				<ItemActions>
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
						accent={primary}
						read={colors.foreground}
						modifiers={[frame({height: 14, width: 14})]}
					/>
				</ItemActions>
			</Item>
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
							page: Boolean.match(done, {
								onFalse: () => Number.max(props.chapter.pages.length - 1, 0),
								onTrue: () => 0
							}),
							series: props.chapter.series
						})
					}
					modifiers={[tint(primary)]}
				/>
			</SwipeActions.Actions>
		</SwipeActions>
	)
}

export function ChaptersRoute(props: {
	chapters: ChapterList
	onOpen: (number: number, page?: number) => void
	onSeries: (series: Series) => void
	series: Series
}) {
	const query = useNativeState('')
	const [searched, setSearched] = useState('')
	const needle = String.toLowerCase(String.trim(searched))
	// New means past the newest chapter ever opened, so the back catalogue carries no dots.
	const reached = pipe(
		Array.filter(props.chapters, chapter => (chapter.reading?.at ?? 0) > 0),
		Array.map(chapter => chapter.number),
		Array.match({onEmpty: Option.none<number>, onNonEmpty: numbers => Option.some(Array.max(numbers, Order.Number))})
	)
	const resume = resumeOf(props.chapters)
	// A query matches a chapter's number from its start, or any part of its name.
	const shown = pipe(
		Array.sort(props.chapters, Order.flip(byNumber)),
		Array.filter(
			chapter =>
				String.startsWith(needle)(`${chapter.number}`) || String.includes(needle)(String.toLowerCase(chapter.title))
		)
	)
	return (
		<Toolbar
			modifiers={[navigationTitle('opm'), navigationBarTitleDisplayMode('inline'), background(colors.background)]}
		>
			{/* Search and its explicit bottom-bar item share the same SwiftUI owner. */}
			<Toolbar
				modifiers={[
					searchable(query, {onChange: setSearched, prompt: `Search ${SERIES_NAMES[props.series]}`}),
					bottomBarSearch
				]}
			>
				{Array.match(shown, {
					onEmpty: () =>
						Boolean.match(String.isEmpty(needle), {
							onFalse: () => (
								<Empty>
									<EmptyHeader>
										<EmptyMedia systemImage="magnifyingglass" />
										<EmptyTitle>{`No Results for “${searched}”`}</EmptyTitle>
									</EmptyHeader>
								</Empty>
							),
							onTrue: () => (
								<Empty>
									<EmptyHeader>
										<EmptyMedia systemImage="book.closed" />
										<EmptyTitle>No Chapters Yet</EmptyTitle>
										<EmptyDescription>They appear here as soon as the server has read them.</EmptyDescription>
									</EmptyHeader>
								</Empty>
							)
						}),
					onNonEmpty: chapters => (
						<ItemGroup>
							{Array.map(chapters, chapter => (
								<ChapterRow
									key={chapter.number}
									chapter={chapter}
									fresh={Option.exists(reached, number => chapter.number > number)}
									onOpen={props.onOpen}
								/>
							))}
						</ItemGroup>
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
				<ToolbarItem placement="bottomBar">
					<Menu
						label={SERIES_NAMES[props.series]}
						systemImage="books.vertical"
						modifiers={[labelStyle('iconOnly'), menuOrder('fixed')]}
					>
						<Picker<Series>
							label="Series"
							selection={props.series}
							onSelectionChange={props.onSeries}
							modifiers={[pickerStyle('inline')]}
						>
							{Array.map(Series.literals, series => (
								<Text key={series} modifiers={[tag(series)]}>
									{SERIES_NAMES[series]}
								</Text>
							))}
						</Picker>
					</Menu>
				</ToolbarItem>
			</Toolbar.Content>
		</Toolbar>
	)
}
