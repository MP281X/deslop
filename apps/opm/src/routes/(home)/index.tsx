import {useAtomRefresh, useAtomSet, useAtomSuspense, useAtomValue} from '@effect/atom-react'

import {Array, Boolean, DateTime, Number, Option, Order, Result, String, pipe} from 'effect'

import {
	Button,
	HStack,
	Image,
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
	alignmentGuide,
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
import {Problem} from '@deslop/components-mobile/problem'
import {FailureContent, shownOf} from '@deslop/components-mobile/screens'
import {StatusDot} from '@deslop/components-mobile/status-dot'
import {colors, radius, space, text} from '@deslop/components-mobile/theme'
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
import {ItemGroupSkeleton} from '@deslop/components-mobile/ui/skeleton'
import {bottomBarSearch} from '@deslop/components-mobile/utils'

import {chaptersAtom, primary, readAtom, session} from '#lib/utils.ts'
import {ChapterProgress, Cover} from '#modules/native/index.ts'
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

// The last chapter read, with its place in the list so the top row can say what it resumes.
function resumingOf(chapters: ChapterList) {
	return pipe(
		resumeOf(chapters),
		Option.flatMap(found =>
			Option.map(
				Array.findFirst(chapters, chapter => chapter.number === found.number),
				chapter => ({chapter, page: found.page})
			)
		)
	)
}

// The one row above the list: where reading stopped, and how much of the chapter is left.
function ContinueRow(props: {chapter: ChapterItem; onOpen: (number: number, page?: number) => void; page: number}) {
	const pages = Number.max(props.chapter.pages.length, 1)
	const done = props.chapter.reading?.done === true
	const page = Number.clamp(props.page + 1, {maximum: pages, minimum: 1})
	return (
		<Item
			onPress={() => props.onOpen(props.chapter.number, props.page)}
			modifiers={[
				...itemRow,
				alignmentGuide('listRowSeparatorLeading', 0),
				accessibilityLabel(
					Boolean.match(done, {
						onFalse: () => `Continue reading Chapter ${props.chapter.number}, page ${page} of ${pages}`,
						onTrue: () => `Read again Chapter ${props.chapter.number}, finished`
					})
				)
			]}
		>
			<ItemMedia>
				<Image
					systemName={Boolean.match(done, {
						onFalse: () => 'book.pages.fill' as const,
						onTrue: () => 'arrow.counterclockwise' as const
					})}
					modifiers={[font({textStyle: 'title2'}), foregroundStyle(primary), accessibilityHidden(true)]}
				/>
			</ItemMedia>
			<ItemContent>
				<Text modifiers={[text.row, foregroundStyle(colors.foreground)]}>
					{Boolean.match(done, {onFalse: () => 'Continue Reading', onTrue: () => 'Read Again'})}
				</Text>
				<Text modifiers={[text.data, foregroundStyle(colors.mutedForeground)]}>
					{`Chapter ${props.chapter.number} · ${Boolean.match(done, {
						onFalse: () => `Page ${page} of ${pages}`,
						onTrue: () => 'Finished'
					})}`}
				</Text>
			</ItemContent>
			<ItemActions>
				<ChapterProgress
					fraction={Boolean.match(done, {onFalse: () => props.page / pages, onTrue: () => 1})}
					accent={primary}
					read={colors.foreground}
					modifiers={[frame({height: 18, width: 18})]}
				/>
			</ItemActions>
		</Item>
	)
}

// Every prop keeps its identity while the chapter is unchanged, so a page turn in the reader re-renders one row.
function ChapterRow(props: {chapter: ChapterItem; fresh: boolean; onOpen: (number: number) => void}) {
	const read = useAtomSet(readAtom)
	const done = props.chapter.reading?.done === true
	return (
		<SwipeActions modifiers={itemRow}>
			<Item
				onPress={() => props.onOpen(props.chapter.number)}
				modifiers={[alignmentGuide('listRowSeparatorLeading', 0)]}
			>
				<ItemMedia>
					<Cover
						url={Option.getOrElse(Array.head(props.chapter.pages), () => '')}
						modifiers={[
							frame({height: 40, width: 28}),
							clipShape('roundedRectangle', radius),
							opacity(Boolean.match(done, {onFalse: () => 1, onTrue: () => 0.45})),
							accessibilityHidden(true)
						]}
					/>
				</ItemMedia>
				{/* Read rows recede as a whole, so the chapter number still leads the list. */}
				<ItemContent modifiers={[opacity(Boolean.match(done, {onFalse: () => 1, onTrue: () => 0.6}))]}>
					<HStack spacing={space[2]}>
						{props.fresh && <StatusDot status="live" tint={primary} />}
						<ItemTitle>{`Chapter ${props.chapter.number}`}</ItemTitle>
					</HStack>
					<ItemDescription>
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

function Chapters(props: {onOpen: (number: number, page?: number) => void; searched: string; series: Series}) {
	const loaded = useAtomSuspense(chaptersAtom, {includeFailure: true})
	const refresh = useAtomRefresh(chaptersAtom)
	const result = shownOf(loaded)
	if (Result.isFailure(result)) {
		return <FailureContent cause={result.failure} name="Chapters" onRetry={refresh} />
	}
	const chapters = Array.filter(result.success, chapter => chapter.series === props.series)
	const needle = String.toLowerCase(String.trim(props.searched))
	// New means past the newest chapter ever opened, so the back catalogue carries no dots.
	const reached = pipe(
		Array.filter(chapters, chapter => (chapter.reading?.at ?? 0) > 0),
		Array.map(chapter => chapter.number),
		Array.match({onEmpty: Option.none<number>, onNonEmpty: numbers => Option.some(Array.max(numbers, Order.Number))})
	)
	const resume = resumingOf(chapters)
	// A query matches a chapter's number from its start, or any part of its name.
	return Array.match(
		pipe(
			Array.sort(chapters, Order.flip(byNumber)),
			Array.filter(
				chapter =>
					String.startsWith(needle)(`${chapter.number}`) || String.includes(needle)(String.toLowerCase(chapter.title))
			)
		),
		{
			onEmpty: () =>
				Boolean.match(String.isEmpty(needle), {
					onFalse: () => (
						<Empty>
							<EmptyHeader>
								<EmptyMedia systemImage="magnifyingglass" />
								<EmptyTitle>No chapters match</EmptyTitle>
								<EmptyDescription>Try another number or title.</EmptyDescription>
							</EmptyHeader>
						</Empty>
					),
					onTrue: () => (
						<Empty>
							<EmptyHeader>
								<EmptyMedia systemImage="book.closed" />
								<EmptyTitle>No chapters yet</EmptyTitle>
								<EmptyDescription>New chapters appear here when they are posted.</EmptyDescription>
							</EmptyHeader>
						</Empty>
					)
				}),
			onNonEmpty: matches => (
				<ItemGroup>
					{/* A search is about the query, so the resume row waits until the full list is back. */}
					{Boolean.match(String.isEmpty(needle), {
						onFalse: () => undefined,
						onTrue: () =>
							Option.match(resume, {
								onNone: () => undefined,
								onSome: found => (
									<Section>
										<ContinueRow chapter={found.chapter} page={found.page} onOpen={props.onOpen} />
									</Section>
								)
							})
					})}
					<Section>
						{Array.map(matches, chapter => (
							<ChapterRow
								key={chapter.number}
								chapter={chapter}
								fresh={Option.exists(reached, number => chapter.number > number)}
								onOpen={props.onOpen}
							/>
						))}
					</Section>
				</ItemGroup>
			)
		}
	)
}

export function ChaptersRoute(props: {
	onOpen: (number: number, page?: number) => void
	onSeries: (series: Series) => void
	series: Series
}) {
	const query = useNativeState('')
	const loaded = useAtomValue(chaptersAtom)
	const refresh = useAtomRefresh(chaptersAtom)
	const [searched, setSearched] = useState('')
	return (
		<Toolbar modifiers={[navigationTitle(SERIES_NAMES[props.series]), navigationBarTitleDisplayMode('large')]}>
			{/* Search and its explicit bottom-bar item share the same SwiftUI owner. */}
			<Toolbar
				modifiers={[
					searchable(query, {onChange: setSearched, prompt: `Search ${SERIES_NAMES[props.series]}`}),
					bottomBarSearch
				]}
			>
				<Suspense fallback={<ItemGroupSkeleton rows={10} />}>
					<Chapters onOpen={props.onOpen} searched={searched} series={props.series} />
				</Suspense>
			</Toolbar>
			<Toolbar.Content>
				{/* The chapters on screen stay through an outage; a dot in the bar marks that they stopped updating. */}
				{AsyncResult.isFailure(loaded) && Result.isSuccess(shownOf(loaded)) && (
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
