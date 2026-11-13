import {useAtomRefresh, useAtomSet, useAtomValue} from '@effect/atom-react'

import {Array, Boolean, DateTime, Number, Option, Order, String, pipe} from 'effect'

import {
	Button,
	Menu,
	Picker,
	Section,
	SwipeActions,
	Text,
	Toolbar,
	ToolbarItem,
	useNativeState
} from '@expo/ui/swift-ui'
import {
	accessibilityHidden,
	accessibilityLabel,
	clipShape,
	font,
	foregroundStyle,
	frame,
	labelStyle,
	menuOrder,
	navigationBarTitleDisplayMode,
	navigationTitle,
	opacity,
	pickerStyle,
	searchable,
	tag,
	tint
} from '@expo/ui/swift-ui/modifiers'
import {AsyncResult} from 'effect/reactivity'
import {Suspense, useState} from 'react'

import {AccountMenu} from '@deslop/components-mobile/account'
import {shortDate} from '@deslop/components-mobile/dates'
import {Problem} from '@deslop/components-mobile/problem'
import {Loaded} from '@deslop/components-mobile/screens'
import {colors, radius} from '@deslop/components-mobile/theme'
import {bottomBarSearch} from '@deslop/components-mobile/toolbar'
import {Empty} from '@deslop/components-mobile/ui/empty'
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
import {ItemGroupSkeleton} from '@deslop/components-mobile/ui/skeleton'
import {blockingFailure} from '@deslop/runtime/client/live-stream'

import {chaptersAtom, primary, readAtom, session} from '#lib/chapters.ts'
import {ChapterProgress, Cover} from '#modules/native/index.ts'
import {byNumber, SERIES_NAMES} from '#services/chapters/lib/utils.ts'
import type {ChapterItem, ChapterNumber} from '#services/chapters/schema.ts'
import {Series} from '#services/chapters/schema.ts'

// Every prop keeps its identity while the chapter is unchanged, so a page turn in the reader re-renders one row.
function ChapterRow(props: {chapter: ChapterItem; onOpen: (number: ChapterNumber) => void}) {
	const read = useAtomSet(readAtom)
	const done = Option.exists(props.chapter.reading, reading => reading.done)
	return (
		<SwipeActions modifiers={itemRow}>
			<Item onPress={() => props.onOpen(props.chapter.number)}>
				<ItemMedia>
					<Cover
						url={Option.getOrElse(Array.head(props.chapter.pages), () => '')}
						modifiers={[
							frame({height: 68, width: 48}),
							clipShape('roundedRectangle', radius),
							opacity(Boolean.match(done, {onFalse: () => 1, onTrue: () => 0.45})),
							accessibilityHidden(true)
						]}
					/>
				</ItemMedia>
				{/* Unread is bold, read recedes; the chapter number still leads the list. */}
				<ItemContent>
					<ItemTitle
						modifiers={Boolean.match(done, {
							onFalse: () => [font({textStyle: 'body', weight: 'bold'})],
							onTrue: () => [font({textStyle: 'body'}), foregroundStyle(colors.mutedForeground)]
						})}
					>{`Chapter ${props.chapter.number}`}</ItemTitle>
					<ItemDescription>
						{pipe(
							[
								props.chapter.title,
								Option.match(props.chapter.postedAt, {
									onNone: () => '',
									onSome: at => shortDate(DateTime.toEpochMillis(at))
								})
							],
							Array.filter(String.isNonEmpty),
							Array.join(' · ')
						)}
					</ItemDescription>
				</ItemContent>
				{/* Weight already says unread or read, so progress shows only for a chapter left part-way; the pages before the one on screen are read. */}
				{pipe(
					props.chapter.reading,
					Option.filter(reading => !reading.done && reading.page > 0),
					Option.match({
						onNone: () => null,
						onSome: reading => (
							<ItemActions>
								<ChapterProgress
									fraction={reading.page / Number.max(props.chapter.pages.length, 1)}
									accent={primary}
									read={colors.foreground}
									modifiers={[frame({height: 14, width: 14})]}
								/>
							</ItemActions>
						)
					})
				)}
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

function Chapters(props: {onOpen: (number: ChapterNumber, page?: number) => void; searched: string; series: Series}) {
	return (
		<Loaded atom={chaptersAtom} name="Chapters">
			{all => {
				const chapters = Array.filter(all, chapter => chapter.series === props.series)
				const needle = String.toLowerCase(String.trim(props.searched))
				return pipe(
					chapters,
					Array.sort(Order.flip(byNumber)),
					Array.filter(
						chapter =>
							String.startsWith(needle)(`${chapter.number}`) ||
							String.includes(needle)(String.toLowerCase(chapter.title))
					),
					Array.match({
						onEmpty: () =>
							Boolean.match(String.isEmpty(needle), {
								onFalse: () => <Empty systemImage="magnifyingglass" label="No chapters match" />,
								onTrue: () => <Empty systemImage="book.closed" label="No chapters yet" />
							}),
						onNonEmpty: matches => (
							<ItemGroup>
								<Section>
									{Array.map(matches, chapter => (
										<ChapterRow key={chapter.number} chapter={chapter} onOpen={props.onOpen} />
									))}
								</Section>
							</ItemGroup>
						)
					})
				)
			}}
		</Loaded>
	)
}

export function ChaptersRoute(props: {
	onOpen: (number: ChapterNumber, page?: number) => void
	onSeries: (series: Series) => void
	series: Series
}) {
	const query = useNativeState('')
	const loaded = useAtomValue(chaptersAtom)
	const refresh = useAtomRefresh(chaptersAtom)
	const [searched, setSearched] = useState('')
	return (
		<Toolbar
			modifiers={[
				navigationTitle(SERIES_NAMES[props.series]),
				navigationBarTitleDisplayMode('large'),
				searchable(query, {onChange: setSearched, prompt: `Search ${SERIES_NAMES[props.series]}`}),
				bottomBarSearch
			]}
		>
			<Suspense fallback={<ItemGroupSkeleton rows={10} />}>
				<Chapters onOpen={props.onOpen} searched={searched} series={props.series} />
			</Suspense>
			<Toolbar.Content>
				{/* The chapters on screen stay through an outage; a dot in the bar marks that they stopped updating. */}
				{AsyncResult.isFailure(loaded) && Option.isNone(blockingFailure(loaded)) && (
					<ToolbarItem placement="topBarLeading">
						<Problem label="Chapters not updating" onRetry={refresh} />
					</ToolbarItem>
				)}
				<ToolbarItem placement="topBarTrailing">
					<AccountMenu session={session} />
				</ToolbarItem>
				<ToolbarItem placement="bottomBar">
					<Menu
						label={SERIES_NAMES[props.series]}
						systemImage="books.vertical"
						modifiers={[
							labelStyle('iconOnly'),
							menuOrder('fixed'),
							accessibilityLabel(`Series: ${SERIES_NAMES[props.series]}`)
						]}
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
